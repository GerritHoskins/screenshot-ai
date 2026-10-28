import {
  AnthropicProvider as SharedAnthropicProvider,
  type AIResponse,
  type AnthropicConfig,
} from '@gerrithoskins/screenshot-ai-core';
import type { AIProvider } from './base';

export { DEFAULT_ANTHROPIC_CONFIG } from '@gerrithoskins/screenshot-ai-core';
export type { AnthropicConfig } from '@gerrithoskins/screenshot-ai-core';

/** Converts the desktop's PNG buffer to the shared portable image contract. */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  private readonly provider: SharedAnthropicProvider;

  constructor(config: Partial<AnthropicConfig> & { apiKey: string }) {
    this.provider = new SharedAnthropicProvider(config);
  }

  get config(): AnthropicConfig {
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

export async function createAnthropicProvider(
  getApiKey: () => Promise<string | null>,
  config?: Partial<Omit<AnthropicConfig, 'apiKey'>>,
): Promise<AnthropicProvider> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Anthropic API key not found');
  return new AnthropicProvider({ ...config, apiKey });
}
