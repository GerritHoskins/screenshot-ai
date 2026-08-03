/**
 * Anthropic Provider - Workstream C
 * Anthropic Claude API integration with vision support.
 */

import type { AIResponse, ResponseMetadata } from '../types/ai-response';
import { createSuccessResponse, createErrorResponse, createAIError } from '../types/ai-response';
import {
  AIProvider,
  ProviderConfig,
  DEFAULT_PROVIDER_CONFIG,
  withRetry,
  withTimeout,
  mapError,
  ErrorMapping,
  parseJsonResponse,
} from './base';

// ============================================================================
// Anthropic Types
// ============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentPart[];
}

interface AnthropicContentPart {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  temperature?: number;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// Error Mappings
// ============================================================================

const ANTHROPIC_ERROR_MAPPINGS: ErrorMapping[] = [
  { pattern: /rate_limit/i, code: 'RATE_LIMIT', retryable: true },
  { pattern: /overloaded/i, code: 'RATE_LIMIT', retryable: true },
  { pattern: /timeout/i, code: 'TIMEOUT', retryable: true },
  { pattern: /529/i, code: 'RATE_LIMIT', retryable: true },
  { pattern: /401/i, code: 'AUTH_ERROR', retryable: false },
  { pattern: /403/i, code: 'AUTH_ERROR', retryable: false },
  { pattern: /404/i, code: 'INVALID_REQUEST', retryable: false },
  { pattern: /not_found|model.*not.*found/i, code: 'INVALID_REQUEST', retryable: false },
  { pattern: /invalid.*key/i, code: 'AUTH_ERROR', retryable: false },
  { pattern: /content.*block/i, code: 'CONTENT_FILTERED', retryable: false },
  { pattern: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i, code: 'NETWORK_ERROR', retryable: true },
  { pattern: /fetch failed/i, code: 'NETWORK_ERROR', retryable: true },
];

// ============================================================================
// Anthropic Provider Configuration
// ============================================================================

export interface AnthropicConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  anthropicVersion?: string;
}

export const DEFAULT_ANTHROPIC_CONFIG: Omit<AnthropicConfig, 'apiKey'> = {
  ...DEFAULT_PROVIDER_CONFIG,
  model: 'claude-sonnet-4-5-20250929', // Updated to Claude Sonnet 4.5 (latest stable)
  baseUrl: 'https://api.anthropic.com',
  anthropicVersion: '2023-06-01',
};

// ============================================================================
// Anthropic Provider Implementation
// ============================================================================

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  readonly config: AnthropicConfig;

  constructor(config: Partial<AnthropicConfig> & { apiKey: string }) {
    this.config = {
      ...DEFAULT_ANTHROPIC_CONFIG,
      ...config,
    };
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }
    if (!this.config.apiKey.startsWith('sk-ant-')) {
      return false;
    }
    return true;
  }

  async complete<T>(prompt: string, image?: Buffer): Promise<AIResponse<T>> {
    const createMetadata = (attempt: number, latencyMs: number): ResponseMetadata => ({
      model: this.config.model,
      provider: 'anthropic',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs,
      attemptNumber: attempt,
    });

    return withRetry(
      () => this.executeRequest<T>(prompt, image),
      {
        maxRetries: this.config.maxRetries,
        baseDelay: this.config.retryBaseDelay,
        maxDelay: this.config.retryMaxDelay,
        onRetry: (attempt, error, delay) => {
          console.log(`Anthropic retry ${attempt}: ${error.code} - waiting ${delay}ms`);
        },
      },
      createMetadata
    );
  }

  private async executeRequest<T>(prompt: string, image?: Buffer): Promise<AIResponse<T>> {
    const startTime = Date.now();

    try {
      // Build message content
      const content: AnthropicContentPart[] = [];

      if (image) {
        const base64Image = image.toString('base64');
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: base64Image,
          },
        });
      }

      content.push({ type: 'text', text: prompt });

      const request: AnthropicRequest = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        messages: [{ role: 'user', content }],
        temperature: this.config.temperature,
      };

      const response = await withTimeout(
        this.fetchCompletion(request),
        this.config.timeout,
        createAIError('TIMEOUT', `Request timed out after ${this.config.timeout}ms`)
      );

      const latencyMs = Date.now() - startTime;
      const metadata: ResponseMetadata = {
        model: this.config.model,
        provider: 'anthropic',
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        latencyMs,
        attemptNumber: 1,
        requestId: response.id,
      };

      // Extract text content from response
      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent?.text) {
        return createErrorResponse(
          createAIError('INVALID_RESPONSE', 'Empty response from Anthropic'),
          metadata
        );
      }

      try {
        // Parse JSON, handling markdown code fences
        const parsed = parseJsonResponse<T>(textContent.text);

        // Validation happens in analysis service if T is ScreenshotAnalysis
        return createSuccessResponse(parsed, metadata);
      } catch (parseError) {
        // Enhanced parse error handling
        let errorMessage = 'Failed to parse JSON response';
        let errorDetails: Record<string, unknown> = { rawContent: textContent.text.slice(0, 500) };
        
        if (parseError instanceof SyntaxError) {
          // Try to extract useful info from syntax error
          const match = parseError.message.match(/position (\d+)/);
          if (match) {
            const position = parseInt(match[1], 10);
            errorMessage = `JSON syntax error at position ${position}: ${parseError.message}`;
            errorDetails.position = position;
            errorDetails.context = textContent.text.slice(Math.max(0, position - 50), position + 50);
          } else {
            errorMessage = `JSON syntax error: ${parseError.message}`;
          }
        }
        
        return createErrorResponse(
          createAIError('PARSE_ERROR', errorMessage, {
            details: errorDetails,
            cause: parseError instanceof Error ? parseError : undefined,
          }),
          metadata
        );
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const aiError = error instanceof Error && 'code' in error && 'retryable' in error
        ? (error as unknown as import('../types/ai-response').AIError)
        : mapError(error, ANTHROPIC_ERROR_MAPPINGS);

      return createErrorResponse(aiError, {
        model: this.config.model,
        provider: 'anthropic',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs,
        attemptNumber: 1,
      });
    }
  }

  private async fetchCompletion(request: AnthropicRequest, retryCount = 0): Promise<AnthropicResponse> {
    const url = `${this.config.baseUrl}/v1/messages`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': this.config.anthropicVersion!,
          'Connection': 'close', // Disable keep-alive to avoid ECONNRESET
        },
        body: JSON.stringify(request),
        // @ts-ignore - keepalive is valid but not in all type definitions
        keepalive: false,
      });
    } catch (fetchError: any) {
      // Check if this is an ECONNRESET or similar network error
      const isConnectionReset = fetchError?.cause?.code === 'ECONNRESET' ||
        fetchError?.cause?.code === 'ECONNREFUSED' ||
        fetchError?.cause?.code === 'ETIMEDOUT' ||
        fetchError?.message?.includes('ECONNRESET');

      // Retry connection reset errors with increasing delay (up to 3 internal retries)
      if (isConnectionReset && retryCount < 3) {
        const delay = Math.min(2000 * Math.pow(2, retryCount), 10000); // 2s, 4s, 8s
        console.log(`[Anthropic] Connection reset, internal retry ${retryCount + 1}/3 after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchCompletion(request, retryCount + 1);
      }

      // Network-level error (DNS, connection refused, timeout, etc.)
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const cause = fetchError?.cause ? ` (cause: ${fetchError.cause.message || fetchError.cause})` : '';
      const code = fetchError?.code ? ` [${fetchError.code}]` : '';
      console.error('Anthropic fetch error:', fetchError);
      throw new Error(`Network error calling Anthropic API: ${message}${code}${cause}`);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `Anthropic API error ${response.status}: ${errorBody}`;
      
      // Parse error response for better error messages
      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
        if (errorJson.error?.type === 'not_found_error' && errorJson.error.message?.includes('model')) {
          errorMessage = `Model not found: ${this.config.model}. Please check the model name is correct. Available models: claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001, claude-opus-4-5-20251101`;
        }
      } catch {
        // Use raw error body if parsing fails
      }
      
      // Handle rate limits (429 = rate limit, 529 = overloaded)
      if (response.status === 429 || response.status === 529) {
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
        
        const error = new Error(errorMessage);
        
        if (retryAfterSeconds) {
          (error as any).retryAfterSeconds = retryAfterSeconds;
        }
        
        throw error;
      }
      
      // Handle 404 (model not found, invalid endpoint)
      if (response.status === 404) {
        const error = new Error(errorMessage);
        (error as any).statusCode = 404;
        throw error;
      }
      
      throw new Error(errorMessage);
    }

    return response.json() as Promise<AnthropicResponse>;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Anthropic provider with API key from keychain.
 */
export async function createAnthropicProvider(
  getApiKey: () => Promise<string | null>,
  config?: Partial<Omit<AnthropicConfig, 'apiKey'>>
): Promise<AnthropicProvider> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Anthropic API key not found');
  }

  return new AnthropicProvider({
    ...config,
    apiKey,
  });
}
