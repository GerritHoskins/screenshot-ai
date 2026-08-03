import type { Provider, ProviderConfig } from "./base";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";

export type ProviderType = "openai" | "anthropic";

export function createProvider(type: ProviderType, config: ProviderConfig): Provider {
  if (type === "openai") return new OpenAIProvider(config);
  if (type === "anthropic") return new AnthropicProvider(config);
  throw new Error(`Unsupported provider: ${type}`);
}
