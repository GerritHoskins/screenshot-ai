/**
 * OpenAI Provider - Workstream C
 * OpenAI API integration with vision support.
 */

import type { AIResponse, ResponseMetadata } from '../types/ai-response.js';
import { createSuccessResponse, createErrorResponse, createAIError } from '../types/ai-response.js';
import {
  AIProvider,
  ProviderConfig,
  DEFAULT_PROVIDER_CONFIG,
  withRetry,
  withAbortTimeout,
  isTrustedRequestError,
  isValidAbortSignal,
  safeModelMetadata,
  invalidProviderResponseError,
  providerHttpError,
  parseJsonResponse,
  type ImageInput,
  type CompletionOptions,
  validProviderConfig,
  validateImageInput,
  mergeDefined,
} from './base.js';

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
    this.config = mergeDefined({ ...DEFAULT_OPENAI_CONFIG, apiKey: config.apiKey }, config);
  }

  async validateConfig(): Promise<boolean> {
    if (typeof this.config.apiKey !== 'string' || !this.config.apiKey) {
      return false;
    }
    if (!this.config.apiKey.startsWith('sk-')) {
      return false;
    }
    return true;
  }

  async complete<T>(prompt: string, image?: ImageInput, options: CompletionOptions = {}): Promise<AIResponse<T>> {
    const createMetadata = (attempt: number, latencyMs: number): ResponseMetadata => ({
      model: safeModelMetadata(this.config.model, DEFAULT_OPENAI_CONFIG.model),
      provider: 'openai',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs,
      attemptNumber: attempt,
    });

    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        (options.signal !== undefined && !isValidAbortSignal(options.signal)) ||
        !validProviderConfig(this.config) || typeof prompt !== 'string' || (image !== undefined && !validateImageInput(image))) {
      return createErrorResponse(createAIError('INVALID_REQUEST', 'Invalid analysis configuration or image.'), createMetadata(1, 0));
    }
    if (!(await this.validateConfig())) {
      return createErrorResponse(createAIError('AUTH_ERROR', 'Invalid API key format.'), createMetadata(1, 0));
    }

    return withRetry(
      () => this.executeRequest<T>(prompt, image, options),
      {
        maxRetries: this.config.maxRetries,
        baseDelay: this.config.retryBaseDelay,
        maxDelay: this.config.retryMaxDelay,
        signal: options.signal,
      },
      createMetadata
    );
  }

  private async executeRequest<T>(prompt: string, image?: ImageInput, options: CompletionOptions = {}): Promise<AIResponse<T>> {
    const startTime = Date.now();

    try {
      // Build message content
      const content: OpenAIContentPart[] = [{ type: 'text', text: prompt }];

      if (image) {
        const base64Image = image.base64;
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${base64Image}`,
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

      const response = await withAbortTimeout(
        signal => this.fetchCompletion(request, signal),
        this.config.timeout,
        options.signal
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

      if (typeof content_text !== 'string' || !content_text) {
        return createErrorResponse(
          createAIError('INVALID_RESPONSE', 'Empty response from OpenAI'),
          metadata
        );
      }

      try {
        // Parse JSON, handling markdown code fences
        const parsed = parseJsonResponse<T>(content_text);

        // Validation happens in analysis service if T is ScreenshotAnalysis
        return createSuccessResponse(parsed, metadata);
      } catch {
        return createErrorResponse(
          createAIError('PARSE_ERROR', 'The provider returned invalid JSON.'),
          metadata
        );
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const aiError = isTrustedRequestError(error) ? error
        : createAIError('NETWORK_ERROR', 'Unable to complete the provider request.');

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

  private async fetchCompletion(request: OpenAIRequest, signal: AbortSignal): Promise<OpenAIResponse> {
    const fetcher = this.config.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') throw createAIError('INVALID_REQUEST', 'A fetch implementation is required.');
    const response = await fetcher(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...(this.config.organization ? { 'OpenAI-Organization': this.config.organization } : {}),
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* Preserve the safe HTTP classification. */ }
      let retryAfter: string | null = null;
      try { retryAfter = response.headers.get('Retry-After'); } catch { /* Optional metadata is not an error source. */ }
      throw providerHttpError('OpenAI', response.status, retryAfter);
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw invalidProviderResponseError(); }
    if (typeof value !== 'object' || value === null) throw invalidProviderResponseError();
    return value as OpenAIResponse;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an OpenAI provider with a credential supplied by the host.
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
