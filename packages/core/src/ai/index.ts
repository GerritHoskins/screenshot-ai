import { basePrompt } from "../prompt/base";
import { retryPrompt } from "../prompt/retry";
import type { AIResponse, ScreenshotAnalysis } from "../types/ai-response";
import { analyzeWithOpenAI } from "./providers/openai";
import { analyzeWithAnthropic } from "./providers/anthropic";

export type AnalyzeOptions = {
  provider: "openai" | "anthropic";
  model: string;
  apiKey: string;
  timeoutMs?: number;
  retry?: boolean;
};

export async function analyzeImage(image: Buffer, opts: AnalyzeOptions): Promise<AIResponse<ScreenshotAnalysis>> {
  const started = Date.now();
  const prompt = opts.retry ? `${basePrompt}\n\n${retryPrompt}` : basePrompt;
  const imageBase64 = image.toString("base64");
  const timeoutMs = opts.timeoutMs ?? 30000;

  try {
    const result =
      opts.provider === "openai"
        ? await analyzeWithOpenAI({ imageBase64, prompt, options: { apiKey: opts.apiKey, model: opts.model, timeoutMs } })
        : await analyzeWithAnthropic({ imageBase64, prompt, options: { apiKey: opts.apiKey, model: opts.model, timeoutMs } });

    const parsed = parseJson(result.text);
    const confidence = toConfidence(parsed?.confidence);

    return {
      success: true,
      data: {
        text: typeof parsed?.summary === 'string' ? parsed.summary : result.text,
        structuredData: parsed ?? undefined,
        confidence
      },
      metadata: {
        provider: opts.provider,
        model: result.model,
        latencyMs: Date.now() - started,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        attemptNumber: 1
      }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      error: {
        code: "PROVIDER_ERROR",
        message,
        retryable: true
      },
      metadata: {
        provider: opts.provider,
        model: opts.model,
        latencyMs: Date.now() - started,
        promptTokens: 0,
        completionTokens: 0,
        attemptNumber: 1
      }
    };
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toConfidence(value: unknown): number {
  if (value === "high") return 0.85;
  if (value === "medium") return 0.6;
  if (value === "low") return 0.35;
  return 0.5;
}
