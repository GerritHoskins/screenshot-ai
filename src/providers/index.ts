/**
 * Providers Index - Workstream C
 * Unified provider exports and factory.
 */

export * from './base';
export * from './openai';
export * from './anthropic';

import { AIProvider, ProviderConfig } from './base';
import { OpenAIProvider, OpenAIConfig } from './openai';
import { AnthropicProvider, AnthropicConfig } from './anthropic';

// ============================================================================
// Provider Factory
// ============================================================================

export type ProviderType = 'openai' | 'anthropic';

export type ProviderConfigMap = {
  openai: OpenAIConfig;
  anthropic: AnthropicConfig;
};

/**
 * Create a provider instance by type.
 */
export function createProvider<T extends ProviderType>(
  type: T,
  config: ProviderConfigMap[T]
): AIProvider {
  switch (type) {
    case 'openai':
      return new OpenAIProvider(config as OpenAIConfig);
    case 'anthropic':
      return new AnthropicProvider(config as AnthropicConfig);
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

/**
 * Get default model for a provider.
 */
export function getDefaultModel(type: ProviderType): string {
  switch (type) {
    case 'openai':
      return 'gpt-5.2';
    case 'anthropic':
      return 'claude-sonnet-4-5-20250929';
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}
