import type { AIResponse } from "../types/ai-response";
import { mapConfidence, parseJsonFromText, type Provider, type ProviderConfig } from "./base";

export class AnthropicProvider implements Provider {
  constructor(private config: ProviderConfig) {}

  async validateConfig(): Promise<boolean> {
    return /^sk-ant-[A-Za-z0-9-_]{20,}$/.test(this.config.apiKey);
  }

  async complete<T>(prompt: string, image: Buffer): Promise<AIResponse<T>> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const imageBase64 = image.toString("base64");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: imageBase64
                  }
                },
                { type: "text", text: prompt }
              ]
            }
          ]
        }),
        signal: controller.signal
      });

      const json = await response.json();
      if (!response.ok) {
        const message = json?.error?.message || `Anthropic error ${response.status}`;
        return failure("PROVIDER_ERROR", message, started, this.config.model);
      }

      const text = extractAnthropicText(json);
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
          provider: "anthropic",
          model: json?.model || this.config.model,
          latencyMs: Date.now() - started,
          promptTokens: json?.usage?.input_tokens ?? 0,
          completionTokens: json?.usage?.output_tokens ?? 0,
          attemptNumber: 1
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Anthropic request failed";
      return failure("PROVIDER_ERROR", message, started, this.config.model);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractAnthropicText(response: any): string {
  const content = response?.content;
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const c of content) {
      if (c?.type === "text" && typeof c?.text === "string") {
        chunks.push(c.text);
      }
    }
    return chunks.join("\n");
  }
  return "";
}

function failure(code: string, message: string, started: number, model: string): AIResponse<never> {
  return {
    success: false,
    error: { code, message, retryable: true },
    metadata: {
      provider: "anthropic",
      model,
      latencyMs: Date.now() - started,
      promptTokens: 0,
      completionTokens: 0,
      attemptNumber: 1
    }
  };
}
