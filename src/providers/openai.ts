/**
 * OpenAI Provider - Workstream C
 * OpenAI API integration with vision support.
 */

import type { AIResponse, ResponseMetadata, AIErrorCode } from '../types/ai-response';
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
// OpenAI Types (Chat Completions API)
// ============================================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[];
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_completion_tokens: number;
  temperature: number;
  response_format?: {
    type: 'json_object';
  };
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ============================================================================
// Error Mappings
// ============================================================================

const OPENAI_ERROR_MAPPINGS: ErrorMapping[] = [
  { pattern: /rate_limit/i, code: 'RATE_LIMIT', retryable: true },
  { pattern: /timeout/i, code: 'TIMEOUT', retryable: true },
  { pattern: /429/i, code: 'RATE_LIMIT', retryable: true },
  { pattern: /401/i, code: 'AUTH_ERROR', retryable: false },
  { pattern: /403/i, code: 'AUTH_ERROR', retryable: false },
  { pattern: /invalid_api_key/i, code: 'AUTH_ERROR', retryable: false },
  { pattern: /content_policy/i, code: 'CONTENT_FILTERED', retryable: false },
  { pattern: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i, code: 'NETWORK_ERROR', retryable: true },
  { pattern: /fetch failed/i, code: 'NETWORK_ERROR', retryable: true },
];

// ============================================================================
// OpenAI Provider Configuration
// ============================================================================

export interface OpenAIConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
}

export const DEFAULT_OPENAI_CONFIG: Omit<OpenAIConfig, 'apiKey'> = {
  ...DEFAULT_PROVIDER_CONFIG,
  model: 'gpt-5.2',
  baseUrl: 'https://api.openai.com/v1',
};

// ============================================================================
// OpenAI Provider Implementation
// ============================================================================

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const;
  readonly config: OpenAIConfig;

  constructor(config: Partial<OpenAIConfig> & { apiKey: string }) {
    this.config = {
      ...DEFAULT_OPENAI_CONFIG,
      ...config,
    };
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }
    if (!this.config.apiKey.startsWith('sk-')) {
      return false;
    }
    return true;
  }

  async complete<T>(prompt: string, image?: Buffer): Promise<AIResponse<T>> {
    const createMetadata = (attempt: number, latencyMs: number): ResponseMetadata => ({
      model: this.config.model,
      provider: 'openai',
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
          console.log(`OpenAI retry ${attempt}: ${error.code} - waiting ${delay}ms`);
        },
      },
      createMetadata
    );
  }

  private async executeRequest<T>(prompt: string, image?: Buffer): Promise<AIResponse<T>> {
    const startTime = Date.now();

    try {
      // Build message content
      const content: OpenAIContentPart[] = [{ type: 'text', text: prompt }];

      if (image) {
        const base64Image = image.toString('base64');
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64Image}`,
            detail: 'high',
          },
        });
      }

      const request: OpenAIRequest = {
        model: this.config.model,
        messages: [{ role: 'user', content }],
        max_completion_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
      };

      const response = await withTimeout(
        this.fetchCompletion(request),
        this.config.timeout,
        createAIError('TIMEOUT', `Request timed out after ${this.config.timeout}ms`)
      );

      const latencyMs = Date.now() - startTime;
      const metadata: ResponseMetadata = {
        model: this.config.model,
        provider: 'openai',
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        latencyMs,
        attemptNumber: 1,
        requestId: response.id,
      };

      // Parse the response content
      const content_text = response.choices?.[0]?.message?.content;
      console.log('[OpenAI] Raw content_text:', content_text?.slice(0, 1000));

      if (!content_text) {
        return createErrorResponse(
          createAIError('INVALID_RESPONSE', 'Empty response from OpenAI'),
          metadata
        );
      }

      try {
        // Parse JSON, handling markdown code fences
        const parsed = parseJsonResponse<T>(content_text);
        console.log('[OpenAI] Parsed response keys:', Object.keys(parsed as object));

        // Validation happens in analysis service if T is ScreenshotAnalysis
        return createSuccessResponse(parsed, metadata);
      } catch (parseError) {
        // Enhanced parse error handling
        let errorMessage = 'Failed to parse JSON response';
        let errorDetails: Record<string, unknown> = { rawContent: content_text.slice(0, 500) };

        if (parseError instanceof SyntaxError) {
          // Try to extract useful info from syntax error
          const match = parseError.message.match(/position (\d+)/);
          if (match) {
            const position = parseInt(match[1], 10);
            errorMessage = `JSON syntax error at position ${position}: ${parseError.message}`;
            errorDetails.position = position;
            errorDetails.context = content_text.slice(Math.max(0, position - 50), position + 50);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const aiError = mapError(error, OPENAI_ERROR_MAPPINGS);

      return createErrorResponse(aiError, {
        model: this.config.model,
        provider: 'openai',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs,
        attemptNumber: 1,
      });
    }
  }

  private async fetchCompletion(request: OpenAIRequest, retryCount = 0): Promise<OpenAIResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };

    if (this.config.organization) {
      headers['OpenAI-Organization'] = this.config.organization;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
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
        console.log(`[OpenAI] Connection reset, internal retry ${retryCount + 1}/3 after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchCompletion(request, retryCount + 1);
      }

      // Network-level error (DNS, connection refused, timeout, etc.)
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const cause = fetchError?.cause ? ` (cause: ${fetchError.cause.message || fetchError.cause})` : '';
      const code = fetchError?.code ? ` [${fetchError.code}]` : '';
      console.error('OpenAI fetch error:', fetchError);
      throw new Error(`Network error calling OpenAI API: ${message}${code}${cause}`);
    }

    if (!response.ok) {
      const errorBody = await response.text();

      // Parse Retry-After header for rate limits
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;

        const error = new Error(`Rate limit exceeded (429): ${errorBody}`);

        // Attach retry-after info to error for retry logic
        if (retryAfterSeconds) {
          (error as any).retryAfterSeconds = retryAfterSeconds;
        }

        throw error;
      }

      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    return response.json() as Promise<OpenAIResponse>;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an OpenAI provider with API key from keychain.
 */
export async function createOpenAIProvider(
  getApiKey: () => Promise<string | null>,
  config?: Partial<Omit<OpenAIConfig, 'apiKey'>>
): Promise<OpenAIProvider> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key not found');
  }

  return new OpenAIProvider({
    ...config,
    apiKey,
  });
}
