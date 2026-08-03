/**
 * Base Provider - Workstream C
 * Abstract base class and interfaces for AI providers.
 */

import type { AIResponse, AIError, AIErrorCode, ResponseMetadata } from '../types/ai-response';
import { createAIError, createErrorResponse, RETRYABLE_ERROR_CODES } from '../types/ai-response';

// ============================================================================
// Provider Configuration
// ============================================================================

export interface ProviderConfig {
  /** Model identifier */
  model: string;
  /** Maximum tokens in response */
  maxTokens: number;
  /** Temperature (0-2, lower = more deterministic) */
  temperature: number;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  retryBaseDelay: number;
  /** Maximum delay between retries (ms) */
  retryMaxDelay: number;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  model: '',
  maxTokens: 4096,
  temperature: 0.1,
  timeout: 30000,
  maxRetries: 3,
  retryBaseDelay: 1000,
  retryMaxDelay: 10000,
};

// ============================================================================
// Provider Interface
// ============================================================================

export interface AIProvider {
  /** Provider name */
  readonly name: 'openai' | 'anthropic';
  
  /** Current configuration */
  readonly config: ProviderConfig;
  
  /**
   * Send a completion request to the AI provider.
   * @param prompt - The text prompt
   * @param image - Optional image buffer (for vision models)
   * @returns Normalized AIResponse
   */
  complete<T>(prompt: string, image?: Buffer): Promise<AIResponse<T>>;
  
  /**
   * Validate that the provider is properly configured.
   */
  validateConfig(): Promise<boolean>;
}

// ============================================================================
// Retry Logic
// ============================================================================

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  /** Optional callback for retry attempts */
  onRetry?: (attempt: number, error: AIError, delay: number) => void;
  /** Retry-After seconds from HTTP header (if available) */
  retryAfterSeconds?: number;
}

/**
 * Calculate delay with exponential backoff and jitter.
 * If retryAfterSeconds is provided (from Retry-After header), use that instead.
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  retryAfterSeconds?: number
): number {
  // If Retry-After header was provided, use that (convert to ms)
  if (retryAfterSeconds !== undefined) {
    const retryAfterMs = retryAfterSeconds * 1000;
    // Add small jitter (±10%) to avoid thundering herd
    const jitter = retryAfterMs * 0.1 * (Math.random() * 2 - 1);
    return Math.min(retryAfterMs + jitter, maxDelay);
  }
  
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  // Add jitter: ±25% randomization
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  const delay = exponentialDelay + jitter;
  // Clamp to maxDelay
  return Math.min(delay, maxDelay);
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<AIResponse<T>>,
  options: RetryOptions,
  createMetadata: (attempt: number, latencyMs: number) => ResponseMetadata
): Promise<AIResponse<T>> {
  let lastError: AIError | undefined;
  const startTime = Date.now();
  
  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt++) {
    const attemptStart = Date.now();
    
    try {
      const result = await fn();
      
      // If successful, return with updated metadata
      if (result.success) {
        return {
          ...result,
          metadata: {
            ...result.metadata,
            attemptNumber: attempt,
            latencyMs: Date.now() - startTime,
          },
        };
      }
      
      // Check if error is retryable
      if (result.error && !result.error.retryable) {
        return result;
      }
      
      lastError = result.error;
    } catch (error) {
      lastError = createAIError(
        'UNKNOWN_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        { cause: error instanceof Error ? error : undefined }
      );
    }
    
    // Don't retry after last attempt
    if (attempt > options.maxRetries) {
      break;
    }
    
    // Extract retryAfterSeconds from error if available
    const retryAfterSeconds = (lastError as any)?.retryAfterSeconds || options.retryAfterSeconds;
    
    // Calculate delay and wait
    const delay = calculateBackoffDelay(attempt, options.baseDelay, options.maxDelay, retryAfterSeconds);
    options.onRetry?.(attempt, lastError!, delay);
    await sleep(delay);
  }
  
  // All retries exhausted
  return createErrorResponse(
    lastError ?? createAIError('UNKNOWN_ERROR', 'All retry attempts failed'),
    createMetadata(options.maxRetries + 1, Date.now() - startTime)
  );
}

// ============================================================================
// Timeout Wrapper
// ============================================================================

/**
 * Wrap a promise with a timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: AIError
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(timeoutError);
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

// ============================================================================
// Error Mapping
// ============================================================================

export interface ErrorMapping {
  pattern: RegExp | string;
  code: AIErrorCode;
  retryable: boolean;
}

/**
 * Map a raw error to an AIError using error patterns.
 */
export function mapError(
  error: unknown,
  mappings: ErrorMapping[],
  defaultCode: AIErrorCode = 'UNKNOWN_ERROR'
): AIError {
  const message = error instanceof Error ? error.message : String(error);
  
  // Check for Retry-After header in error (from fetch responses)
  let retryAfterSeconds: number | undefined;
  if (error instanceof Error && 'retryAfterSeconds' in error) {
    retryAfterSeconds = (error as any).retryAfterSeconds;
  }
  
  for (const mapping of mappings) {
    const matches = typeof mapping.pattern === 'string'
      ? message.includes(mapping.pattern)
      : mapping.pattern.test(message);
    
    if (matches) {
      const aiError = createAIError(mapping.code, message, {
        cause: error instanceof Error ? error : undefined,
        details: retryAfterSeconds ? { retryAfterSeconds } : undefined,
      });
      
      // If Retry-After is present, use it for backoff calculation
      if (retryAfterSeconds && mapping.retryable) {
        // Override retryable delay with Retry-After value
        (aiError as any).retryAfterSeconds = retryAfterSeconds;
      }
      
      return aiError;
    }
  }
  
  return createAIError(defaultCode, message, {
    cause: error instanceof Error ? error : undefined,
  });
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract JSON from a response that may contain markdown code fences.
 * Handles responses like:
 * - ```json\n{...}\n```
 * - ```\n{...}\n```
 * - Pure JSON: {...}
 */
export function extractJsonFromResponse(text: string): string {
  // Trim whitespace
  let cleaned = text.trim();

  // Remove markdown code fences with optional language identifier
  // Matches: ```json, ```JSON, ```, etc.
  const codeBlockMatch = cleaned.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // If still wrapped in code fences (partial match), try again
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Find the first { and last } to extract JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

/**
 * Parse JSON from a response, handling markdown formatting.
 */
export function parseJsonResponse<T>(text: string): T {
  const cleaned = extractJsonFromResponse(text);
  return JSON.parse(cleaned) as T;
}
