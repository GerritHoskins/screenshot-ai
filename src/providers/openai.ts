import {
  OpenAIProvider as SharedOpenAIProvider,
  type AIResponse,
  type OpenAIConfig,
} from '@gerrithoskins/screenshot-ai-core';
import type { AIProvider } from './base';

export { DEFAULT_OPENAI_CONFIG } from '@gerrithoskins/screenshot-ai-core';
export type { OpenAIConfig } from '@gerrithoskins/screenshot-ai-core';

/** Converts the desktop's PNG buffer to the shared portable image contract. */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const;
  private readonly provider: SharedOpenAIProvider;

  constructor(config: Partial<OpenAIConfig> & { apiKey: string }) {
    this.provider = new SharedOpenAIProvider(config);
  }

  get config(): OpenAIConfig {
    return this.provider.config;
  }

  validateConfig(): Promise<boolean> {
    return this.provider.validateConfig();
  }

  complete<T>(prompt: string, image?: Buffer, options?: { signal?: AbortSignal }): Promise<AIResponse<T>> {
    return this.provider.complete<T>(
      prompt,
      image ? { base64: image.toString('base64'), mimeType: 'image/png' } : undefined,
      options,
    );
  }
}

export async function createOpenAIProvider(
  getApiKey: () => Promise<string | null>,
  config?: Partial<Omit<OpenAIConfig, 'apiKey'>>,
): Promise<OpenAIProvider> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('OpenAI API key not found');
  return new OpenAIProvider({ ...config, apiKey });
}
