/**
 * AIResponse Schema - Workstream B
 * Defines the unified response type for all AI provider interactions.
 */

/**
 * Error codes for AI operations.
 * Used for consistent error handling and retry logic.
 */
export type AIErrorCode =
  | 'PARSE_ERROR'        // JSON parsing failed
  | 'VALIDATION_ERROR'   // Schema validation failed
  | 'RATE_LIMIT'         // Rate limit exceeded (retryable)
  | 'TIMEOUT'            // Request timeout (retryable)
  | 'MODEL_ERROR'        // Model returned an error
  | 'INVALID_REQUEST'    // Invalid request (e.g., model not found, bad parameters)
  | 'CONTENT_FILTERED'   // Content was filtered by safety systems
  | 'INVALID_RESPONSE'   // Response structure invalid
  | 'AUTH_ERROR'         // Authentication failed
  | 'NETWORK_ERROR'      // Network connectivity issue (retryable)
  | 'UNKNOWN_ERROR';     // Unexpected error

/**
 * Error details for AI operations.
 */
export interface AIError {
  /** Error classification code */
  code: AIErrorCode;
  /** Human-readable error message */
  message: string;
  /** Whether this error can be retried */
  retryable: boolean;
  /** Provider retry delay in seconds, if supplied. */
  retryAfterSeconds?: number;
  /** Additional error context */
  details?: Record<string, unknown>;
  /** Original error if available */
  cause?: Error;
}

/**
 * Metadata about the AI request/response.
 */
export interface ResponseMetadata {
  /** Model identifier used */
  model: string;
  /** Provider name (openai, anthropic) */
  provider: 'openai' | 'anthropic';
  /** Number of tokens in the prompt */
  promptTokens: number;
  /** Number of tokens in the completion */
  completionTokens: number;
  /** Total request latency in milliseconds */
  latencyMs: number;
  /** Which attempt number this was (1-based) */
  attemptNumber: number;
  /** Request ID from provider (if available) */
  requestId?: string;
}

/**
 * Generic AI response wrapper.
 * All provider responses are normalized to this format.
 * 
 * @template T - The expected data type on success
 */
export interface AIResponse<T = unknown> {
  /** Whether the request was successful */
  success: boolean;
  /** Response data (present when success=true) */
  data?: T;
  /** Error details (present when success=false) */
  error?: AIError;
  /** Request/response metadata */
  metadata: ResponseMetadata;
}

/**
 * Screenshot analysis result from AI.
 */
export interface ScreenshotAnalysis {
  /** Answer to any question found in the screenshot */
  answer?: string;
  /** Optional fields supplied by structured/custom analysis prompts. */
  summary?: string | Array<string | { text?: string; content?: string }> | Record<string, unknown>;
  issues?: Array<{
    severity?: string;
    text?: string;
    type?: string;
    details?: string;
    suggestion?: string;
  }>;
  uxCritique?: Array<string | {
    area?: string;
    issue?: string;
    suggestion?: string;
    recommendation?: string;
    category?: string;
    problem?: string;
  }>;
  tags?: Record<string, string[]>;
  primary_tags?: string[];
  negative_tags?: string[];
  booru_format?: string;
  /** Extracted text content */
  text?: string;
  /** Code blocks found in the image */
  codeBlocks?: CodeBlock[];
  /** Structured data extracted */
  structuredData?: Record<string, unknown>;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Code block extracted from screenshot.
 */
export interface CodeBlock {
  /** Programming language (if detected) */
  language?: string;
  /** The code content */
  code: string;
  /** Line numbers if visible */
  startLine?: number;
  endLine?: number;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if response is successful.
 */
export function isSuccessResponse<T>(response: AIResponse<T>): response is AIResponse<T> & { success: true; data: T } {
  return response.success === true && response.data !== undefined;
}

/**
 * Type guard to check if response is an error.
 */
export function isErrorResponse<T>(response: AIResponse<T>): response is AIResponse<T> & { success: false; error: AIError } {
  return response.success === false && response.error !== undefined;
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(error: AIError): boolean {
  return error.retryable;
}

/**
 * Retryable error codes for quick checking.
 */
export const RETRYABLE_ERROR_CODES: AIErrorCode[] = [
  'RATE_LIMIT',
  'TIMEOUT',
  'NETWORK_ERROR',
];

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a successful AIResponse.
 */
export function createSuccessResponse<T>(
  data: T,
  metadata: ResponseMetadata
): AIResponse<T> {
  return {
    success: true,
    data,
    metadata,
  };
}

/**
 * Create an error AIResponse.
 */
export function createErrorResponse<T = never>(
  error: AIError,
  metadata: ResponseMetadata
): AIResponse<T> {
  return {
    success: false,
    error,
    metadata,
  };
}

/**
 * Create an AIError with defaults.
 */
export function createAIError(
  code: AIErrorCode,
  message: string,
  options?: { details?: Record<string, unknown>; cause?: Error; retryable?: boolean }
): AIError {
  return {
    code,
    message,
    retryable: options?.retryable ?? RETRYABLE_ERROR_CODES.includes(code),
    details: options?.details,
    cause: options?.cause,
  };
}
