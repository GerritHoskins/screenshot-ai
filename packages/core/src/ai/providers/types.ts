export type ProviderResult = {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

export type ProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
};
