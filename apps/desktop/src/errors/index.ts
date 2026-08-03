import type { AIResponse } from "../types/ai-response";

export function mapCaptureError(error: unknown): AIResponse<unknown> {
  const message = error instanceof Error ? error.message : "Capture failed";
  return {
    success: false,
    error: {
      code: "CAPTURE_ERROR",
      message,
      retryable: true
    },
    metadata: {
      provider: "system",
      model: "n/a",
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      attemptNumber: 1
    }
  };
}

export function mapProviderError(error: unknown, provider: string): AIResponse<unknown> {
  const message = error instanceof Error ? error.message : "Provider error";
  return {
    success: false,
    error: {
      code: "PROVIDER_ERROR",
      message,
      retryable: true
    },
    metadata: {
      provider,
      model: "unknown",
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      attemptNumber: 1
    }
  };
}
