import { describe, expect, it, vi } from 'vitest';
import {
  analyzeImage, AnthropicProvider, OpenAIProvider, withAbortTimeout,
  type AnalyzeOptions, type FetchLike, type FetchResponse,
} from '../../packages/core/src/index';

const image = { base64: 'aW1hZ2U=', mimeType: 'image/png' as const };
function successfulResponse(): FetchResponse {
  return {
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({
      choices: [{ message: { content: '{"answer":"safe","confidence":1}' } }],
      content: [{ type: 'text', text: '{"answer":"safe","confidence":1}' }],
      usage: {},
    }),
  };
}

describe('portable API input and transport boundaries', () => {
  it.each([null, {}, { aborted: false }, { aborted: 'yes' }, 42])('rejects malformed caller signal %j before dispatch', async signal => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(successfulResponse());
    const result = await analyzeImage(image, {
      provider: 'openai', apiKey: 'sk-test', fetch, signal: signal as unknown as AbortSignal,
    });
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([123, {}, '', '   ', ' model '])('rejects malformed model %j and retains string metadata', async model => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(successfulResponse());
    const result = await analyzeImage(image, {
      provider: 'openai', apiKey: 'sk-test', fetch, model: model as unknown as string,
    });
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(typeof result.metadata.model).toBe('string');
    expect(result.metadata.model.trim().length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([OpenAIProvider, AnthropicProvider])('guards signals and metadata on lower-level %s clients', async Provider => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(successfulResponse());
    const client = new Provider({ apiKey: 'sk-ant-test', fetch });
    const invalidSignal = await client.complete('private prompt', image, { signal: {} as AbortSignal });
    expect(invalidSignal.error?.code).toBe('INVALID_REQUEST');
    const invalidModel = new Provider({ apiKey: 'sk-ant-test', fetch, model: { secret: 'not-metadata' } as unknown as string });
    const invalidModelResult = await invalidModel.complete('private prompt', image);
    expect(invalidModelResult.error?.code).toBe('INVALID_REQUEST');
    expect(typeof invalidModelResult.metadata.model).toBe('string');
    expect(JSON.stringify(invalidModelResult)).not.toContain('not-metadata');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a malformed signal in the deadline helper before invoking the operation', async () => {
    const operation = vi.fn(async () => 'unexpected');
    await expect(withAbortTimeout(operation, 100, {} as AbortSignal)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(operation).not.toHaveBeenCalled();
  });

  it.each(['openai', 'anthropic'] as const)('does not trust AIError-shaped %s transport rejections', async provider => {
    const privateMessage = 'private echoed prompt or credential';
    const fetch = vi.fn<FetchLike>().mockRejectedValue({ code: 'AUTH_ERROR', message: privateMessage, retryable: false });
    const result = await analyzeImage(image, { provider, apiKey: 'sk-ant-test', fetch, maxRetries: 0 });
    expect(result.error?.code).toBe('NETWORK_ERROR');
    expect(JSON.stringify(result)).not.toContain(privateMessage);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['openai', 'anthropic'] as const)('preserves safe %s HTTP errors when body cancellation rejects', async provider => {
    const readBody = vi.fn();
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: false, status: 401, headers: new Headers(), json: readBody,
      body: { cancel: async () => { throw { code: 'NETWORK_ERROR', message: 'private echoed body', retryable: true }; } },
    });
    const result = await analyzeImage(image, { provider, apiKey: 'sk-ant-test', fetch, maxRetries: 3 });
    expect(result.error?.code).toBe('AUTH_ERROR');
    expect(JSON.stringify(result)).not.toContain('private echoed body');
    expect(readBody).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retains custom instructions and appends the required JSON analysis schema', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(successfulResponse());
    const options: AnalyzeOptions = { provider: 'openai', apiKey: 'sk-test', fetch, prompt: 'Explain the layout.' };
    const result = await analyzeImage(image, options);
    expect(result.success).toBe(true);
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    const prompt = request.messages[0].content[0].text;
    expect(prompt).toContain('Explain the layout.');
    expect(prompt).toContain('valid JSON only');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"codeBlocks"');
  });
});
