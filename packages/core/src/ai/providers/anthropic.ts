import type { ProviderOptions, ProviderResult } from "./types";

export async function analyzeWithAnthropic(args: {
  imageBase64: string;
  prompt: string;
  options: ProviderOptions;
}): Promise<ProviderResult> {
  const { imageBase64, prompt, options } = args;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 1024,
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
      const message = `Anthropic error ${response.status}`;
      throw new Error(message);
    }

    const text = extractAnthropicText(json);
    return {
      text,
      model: json?.model || options.model,
      promptTokens: json?.usage?.input_tokens ?? 0,
      completionTokens: json?.usage?.output_tokens ?? 0
    };
  } finally {
    clearTimeout(timeout);
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
