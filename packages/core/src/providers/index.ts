export * from './base.js';
export * from './openai.js';
export * from './anthropic.js';
import type { AIProvider, ProviderConfig } from './base.js';
import { OpenAIProvider, type OpenAIConfig, DEFAULT_OPENAI_CONFIG } from './openai.js';
import { AnthropicProvider, type AnthropicConfig, DEFAULT_ANTHROPIC_CONFIG } from './anthropic.js';
export type ProviderType = 'openai' | 'anthropic';
export type ProviderConfigMap = { openai: OpenAIConfig; anthropic: AnthropicConfig };
export interface CreateProviderOptions extends Partial<ProviderConfig> {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  anthropicVersion?: string;
}
export function createProvider(type: ProviderType, config: CreateProviderOptions): AIProvider {
  switch (type) {
    case 'openai': return new OpenAIProvider(config);
    case 'anthropic': return new AnthropicProvider(config);
    default: throw new Error('Unknown provider type.');
  }
}
export function getDefaultModel(type: ProviderType): string {
  switch (type) {
    case 'openai': return DEFAULT_OPENAI_CONFIG.model;
    case 'anthropic': return DEFAULT_ANTHROPIC_CONFIG.model;
    default: throw new Error('Unknown provider type.');
  }
}
