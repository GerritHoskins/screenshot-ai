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
  withAbortTimeout,
  isAIError,
  providerHttpError,
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

      const response = await withAbortTimeout(
        signal => this.fetchCompletion(request, signal),
        this.config.timeout
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
      } catch {
        return createErrorResponse(
          createAIError('PARSE_ERROR', 'The provider returned invalid JSON.'),
          metadata
        );
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const aiError = isAIError(error) ? error
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
    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
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
      await response.body?.cancel();
      throw providerHttpError('Anthropic', response.status, response.headers.get('Retry-After'));
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
