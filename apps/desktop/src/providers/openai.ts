import type { AIResponse } from "../types/ai-response";
import { mapConfidence, parseJsonFromText, type Provider, type ProviderConfig } from "./base";

export class OpenAIProvider implements Provider {
  constructor(private config: ProviderConfig) {}

  async validateConfig(): Promise<boolean> {
    return /^sk-[A-Za-z0-9]{20,}$/.test(this.config.apiKey);
  }

  async complete<T>(prompt: string, image: Buffer): Promise<AIResponse<T>> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const imageBase64 = image.toString("base64");
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                { type: "input_image", image_url: `data:image/png;base64,${imageBase64}` }
              ]
            }
          ],
          temperature: this.config.temperature,
          max_completion_tokens: this.config.maxTokens
        }),
        signal: controller.signal
      });

      const json = await response.json();
      if (!response.ok) {
        const message = json?.error?.message || `OpenAI error ${response.status}`;
        return failure("PROVIDER_ERROR", message, started, this.config.model);
      }

      const text = extractOpenAIText(json);
      const parsed = parseJsonFromText(text) ?? {};
      const confidence = mapConfidence((parsed as any).confidence);

      const data = {
        text: (parsed as any).summary ?? text,
        structuredData: parsed,
        confidence
      } as unknown as T;

      return {
        success: true,
        data,
        metadata: {
          provider: "openai",
          model: json?.model || this.config.model,
          latencyMs: Date.now() - started,
          promptTokens: json?.usage?.input_tokens ?? 0,
          completionTokens: json?.usage?.output_tokens ?? 0,
          attemptNumber: 1
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "OpenAI request failed";
      return failure("PROVIDER_ERROR", message, started, this.config.model);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractOpenAIText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;
  const output = response?.output;
  if (Array.isArray(output)) {
    const chunks: string[] = [];
    for (const item of output) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") {
            chunks.push(c.text);
          }
        }
      }
    }
    if (chunks.length > 0) return chunks.join("\n");
  }
  return "";
}

function failure(code: string, message: string, started: number, model: string): AIResponse<never> {
  return {
    success: false,
    error: { code, message, retryable: true },
    metadata: {
      provider: "openai",
      model,
      latencyMs: Date.now() - started,
      promptTokens: 0,
      completionTokens: 0,
      attemptNumber: 1
    }
  };
}
