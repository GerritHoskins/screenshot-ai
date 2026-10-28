import type { AIResponse, ProviderConfig } from '@gerrithoskins/screenshot-ai-core';

export {
  DEFAULT_PROVIDER_CONFIG,
  calculateBackoffDelay,
  sleep,
  withRetry,
  withAbortTimeout,
  isAIError,
  providerHttpError,
  withTimeout,
  mapError,
  extractJsonFromResponse,
  parseJsonResponse,
} from '@gerrithoskins/screenshot-ai-core';
export type {
  ProviderConfig,
  RetryOptions,
  ErrorMapping,
} from '@gerrithoskins/screenshot-ai-core';

/** Desktop boundary: only this adapter layer accepts Node image buffers. */
export interface AIProvider {
  readonly name: 'openai' | 'anthropic';
  readonly config: ProviderConfig;
  complete<T>(prompt: string, image?: Buffer, options?: { signal?: AbortSignal }): Promise<AIResponse<T>>;
  validateConfig(): Promise<boolean>;
}
