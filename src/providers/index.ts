export * from './base';
export * from './openai';
export * from './anthropic';

import type { AIProvider } from './base';
import { OpenAIProvider, type OpenAIConfig } from './openai';
import { AnthropicProvider, type AnthropicConfig } from './anthropic';
import type { ProviderType } from '@gerrithoskins/screenshot-ai-core';

export { getDefaultModel } from '@gerrithoskins/screenshot-ai-core';
export type { ProviderType } from '@gerrithoskins/screenshot-ai-core';

export type ProviderConfigMap = {
  openai: OpenAIConfig;
  anthropic: AnthropicConfig;
};

/** Desktop providers retain Buffer support while sharing every HTTP operation. */
export function createProvider<T extends ProviderType>(type: T, config: ProviderConfigMap[T]): AIProvider {
  switch (type) {
    case 'openai': return new OpenAIProvider(config as OpenAIConfig);
    case 'anthropic': return new AnthropicProvider(config as AnthropicConfig);
    default: throw new Error(`Unknown provider type: ${type}`);
  }
}
