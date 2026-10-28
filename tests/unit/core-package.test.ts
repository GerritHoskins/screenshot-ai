import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeImage,
  AnthropicProvider,
  OpenAIProvider,
  validateImageInput,
  type FetchLike,
  type FetchRequest,
  type FetchResponse,
  type ImageInput,
} from '../../packages/core/src/index';
import { OpenAIProvider as DesktopOpenAIProvider } from '../../src/providers/openai';
import { AnthropicProvider as DesktopAnthropicProvider } from '../../src/providers/anthropic';

const image: ImageInput = { base64: 'aGVsbG8=', mimeType: 'image/png' };
const payload = {
  answer: 'A useful answer',
  text: 'Extracted text',
  codeBlocks: [{ language: 'typescript', code: 'const value = 1;' }],
  structuredData: { items: [1, 2] },
  confidence: 0.87,
};

function success(provider: 'openai' | 'anthropic', text = JSON.stringify(payload)) {
  return {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => provider === 'openai'
      ? { choices: [{ message: { content: text } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }
      : { content: [{ type: 'text', text }], usage: { input_tokens: 11, output_tokens: 7 } },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('portable core public analyzer', () => {
  it.each(['openai', 'anthropic'] as const)('preserves validated results and metadata through %s', async provider => {
    const fetch = vi.fn(async () => success(provider));
    const result = await analyzeImage(image, { provider, apiKey: 'sk-ant-local-fixture-only', model: 'fixture-model', fetch, maxRetries: 0 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(payload);
    expect(result.metadata).toMatchObject({ provider, model: 'fixture-model', promptTokens: 11, completionTokens: 7, attemptNumber: 1 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { base64: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' },
    { base64: 'aGVsbG8=', mimeType: 'text/plain' },
    { base64: '', mimeType: 'image/png' },
    { base64: 'invalid!!!', mimeType: 'image/png' },
  ])('rejects invalid image input before transport: %j', async value => {
    const fetch = vi.fn(async () => success('openai'));
    const result = await analyzeImage(value as ImageInput, { provider: 'openai', apiKey: 'sk-local-fixture-only', fetch });
    expect(result.success).toBe(false);
    expect(result.error?.retryable).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates realistic base64 size without recursive-regex stack overflow', () => {
    expect(validateImageInput({ base64: 'A'.repeat(4 * 1024 * 1024), mimeType: 'image/png' })).toBe(true);
  });

  it.each(['{broken JSON', '{}', '{"confidence":1.5}', '{"confidence":null}'])('rejects malformed or invalid analysis data: %s', async text => {
    const result = await analyzeImage(image, {
      provider: 'openai', apiKey: 'sk-local-fixture-only', maxRetries: 0,
      fetch: async () => success('openai', text),
    });
    expect(result.success).toBe(false);
    expect(['PARSE_ERROR', 'VALIDATION_ERROR']).toContain(result.error?.code);
  });

  it('passes custom prompt and explicitly supplied context without collecting files', async () => {
    let request: FetchRequest | undefined;
    const fetch: FetchLike = async (_url, init) => { request = init; return success('openai'); };
    await analyzeImage(image, {
      provider: 'openai', apiKey: 'sk-local-fixture-only', prompt: 'Explain the layout.', context: 'User-selected context only.', fetch,
    });
    expect(request?.body).toContain('Explain the layout.');
    expect(request?.body).toContain('User-selected context only.');
  });

  it('cancels before making a request when the caller is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn(async () => success('openai'));
    const result = await analyzeImage(image, { provider: 'openai', apiKey: 'sk-local-fixture-only', fetch, signal: controller.signal });
    expect(result.error).toMatchObject({ code: 'CANCELLED', retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts an active request and does not retry caller cancellation', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = vi.fn((_url, init) => new Promise<FetchResponse>((_resolve, reject) => {
      signal = init.signal;
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      started();
    }));
    const pending = analyzeImage(image, { provider: 'openai', apiKey: 'sk-local-fixture-only', fetch, signal: controller.signal, maxRetries: 3 });
    await ready;
    controller.abort();
    const result = await pending;
    expect(signal?.aborted).toBe(true);
    expect(result.error).toMatchObject({ code: 'CANCELLED', retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('aborts response-body work when a request times out', async () => {
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = async (_url, init) => {
      signal = init.signal;
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: () => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
      };
    };
    const result = await analyzeImage(image, { provider: 'openai', apiKey: 'sk-local-fixture-only', fetch, timeoutMs: 5, maxRetries: 0 });
    expect(signal?.aborted).toBe(true);
    expect(result.error?.code).toBe('TIMEOUT');
  });
});

describe('portable provider safety and desktop adapters', () => {
  it.each(['openai', 'anthropic'] as const)('does not expose or log private %s error bodies', async provider => {
    const privateContent = 'PRIVATE_SCREENSHOT_AND_PROMPT';
    const json = vi.fn(async () => ({ error: { message: privateContent } }));
    const fetch = vi.fn(async () => ({ ok: false, status: 401, headers: { get: () => null }, json }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await analyzeImage(image, { provider, apiKey: 'sk-ant-local-fixture-only', fetch, maxRetries: 3 });
    expect(result.error).toMatchObject({ code: 'AUTH_ERROR', retryable: false });
    expect(JSON.stringify(result)).not.toContain(privateContent);
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('retries transient responses through one bounded policy', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({}) })
      .mockResolvedValueOnce(success('openai'));
    const provider = new OpenAIProvider({ apiKey: 'sk-local-fixture-only', fetch, maxRetries: 1, retryBaseDelay: 0, retryMaxDelay: 0 });
    const result = await provider.complete('Return valid JSON', image);
    expect(result.success).toBe(true);
    expect(result.metadata.attemptNumber).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['openai', DesktopOpenAIProvider],
    ['anthropic', DesktopAnthropicProvider],
  ] as const)('converts desktop Buffer images only in the %s adapter', async (name, Provider) => {
    let body = '';
    const fetch: FetchLike = async (_url, init) => { body = init.body; return success(name); };
    const buffer = Buffer.from('desktop-image-bytes');
    const provider = new Provider({ apiKey: 'sk-ant-local-fixture-only', fetch });
    const result = await provider.complete('Return valid JSON', buffer);
    expect(result.success).toBe(true);
    expect(body).toContain(buffer.toString('base64'));
    expect(body).toContain(name === 'openai' ? 'data:image/png;base64,' : '"media_type":"image/png"');
  });

  it('accepts portable JPEG input directly without a desktop adapter', async () => {
    let body = '';
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-local-fixture-only',
      fetch: async (_url, init) => { body = init.body; return success('anthropic'); },
    });
    expect((await provider.complete('Return valid JSON', { ...image, mimeType: 'image/jpeg' })).success).toBe(true);
    expect(body).toContain('"media_type":"image/jpeg"');
  });
});
