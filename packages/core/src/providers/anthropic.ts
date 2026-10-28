/**
 * Anthropic Provider - Workstream C
 * Anthropic Claude API integration with vision support.
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
    this.config = mergeDefined({ ...DEFAULT_ANTHROPIC_CONFIG, apiKey: config.apiKey }, config);
  }

  async validateConfig(): Promise<boolean> {
    if (typeof this.config.apiKey !== 'string' || !this.config.apiKey) {
      return false;
    }
    if (!this.config.apiKey.startsWith('sk-ant-')) {
      return false;
    }
    return true;
  }

  async complete<T>(prompt: string, image?: ImageInput, options: CompletionOptions = {}): Promise<AIResponse<T>> {
    const createMetadata = (attempt: number, latencyMs: number): ResponseMetadata => ({
      model: safeModelMetadata(this.config.model, DEFAULT_ANTHROPIC_CONFIG.model),
      provider: 'anthropic',
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
      const content: AnthropicContentPart[] = [];

      if (image) {
        const base64Image = image.base64;
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType,
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

      const response = await withAbortTimeout(
        signal => this.fetchCompletion(request, signal),
        this.config.timeout,
        options.signal
      );

      const latencyMs = Date.now() - startTime;
      const metadata: ResponseMetadata = {
        model: this.config.model,
        provider: 'anthropic',
        promptTokens: response.usage?.input_tokens ?? 0,
        completionTokens: response.usage?.output_tokens ?? 0,
        latencyMs,
        attemptNumber: 1,
        requestId: response.id,
      };

      // Extract text content from response
      const textContent = Array.isArray(response.content) ? response.content.find(c => c.type === 'text') : undefined;
      if (typeof textContent?.text !== 'string' || !textContent.text) {
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
        provider: 'anthropic',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs,
        attemptNumber: 1,
      });
    }
  }

  private async fetchCompletion(request: AnthropicRequest, signal: AbortSignal): Promise<AnthropicResponse> {
    const fetcher = this.config.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') throw createAIError('INVALID_REQUEST', 'A fetch implementation is required.');
    const response = await fetcher(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': this.config.anthropicVersion!,
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* Preserve the safe HTTP classification. */ }
      let retryAfter: string | null = null;
      try { retryAfter = response.headers.get('Retry-After'); } catch { /* Optional metadata is not an error source. */ }
      throw providerHttpError('Anthropic', response.status, retryAfter);
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw invalidProviderResponseError(); }
    if (typeof value !== 'object' || value === null) throw invalidProviderResponseError();
    return value as AnthropicResponse;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Anthropic provider with a credential supplied by the host.
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
