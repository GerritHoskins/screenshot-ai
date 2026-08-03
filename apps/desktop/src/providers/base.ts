export type ProviderConfig = {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
  maxRetries: number;
  retryBaseDelay: number;
  retryMaxDelay: number;
};

export type ProviderResponse<T> = {
  data: T;
  rawText: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
};

export interface Provider {
  validateConfig(): Promise<boolean>;
  complete<T>(prompt: string, image: Buffer): Promise<import("../types/ai-response").AIResponse<T>>;
}

export function parseJsonFromText(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function mapConfidence(value: unknown): number {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (value === "high") return 0.85;
  if (value === "medium") return 0.6;
  if (value === "low") return 0.35;
  return 0.5;
}
