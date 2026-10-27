import type { ProviderOptions, ProviderResult } from "./types";

export async function analyzeWithOpenAI(args: {
  imageBase64: string;
  prompt: string;
  options: ProviderOptions;
}): Promise<ProviderResult> {
  const { imageBase64, prompt, options } = args;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              {
                type: "input_image",
                image_url: `data:image/png;base64,${imageBase64}`
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    const json = await response.json();
    if (!response.ok) {
      const message = `OpenAI error ${response.status}`;
      throw new Error(message);
    }

    const text = extractOpenAIText(json);
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

function extractOpenAIText(response: any): string {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }
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
