import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai';
import { AnthropicProvider } from '../../src/providers/anthropic';
import { redactLogValue } from '../../src/security/redaction';
import { Logger } from '../../src/logging/logger';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const providers = [
  { name: 'OpenAI', create: (config = {}) => new OpenAIProvider({ apiKey: 'sk-test-key', ...config }) },
  { name: 'Anthropic', create: (config = {}) => new AnthropicProvider({ apiKey: 'sk-ant-test-key', ...config }) },
];

describe.each(providers)('$name request security', ({ create }) => {
  it('aborts each timed-out request before starting the bounded retry', async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal!;
      signals.push(signal);
      maxActive = Math.max(maxActive, ++active);
      signal.addEventListener('abort', () => {
        active--;
        reject(new Error('request aborted'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = create({ timeout: 10, maxRetries: 1, retryBaseDelay: 0, retryMaxDelay: 0 }).complete('private prompt');
    await vi.runAllTimersAsync();
    const result = await request;
    expect(result.error?.code).toBe('TIMEOUT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(active).toBe(0);
    expect(maxActive).toBe(1);
  });

  it('uses only the outer retry budget for network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await create({ maxRetries: 2, retryBaseDelay: 0, retryMaxDelay: 0 }).complete('private prompt');
    expect(result.error?.code).toBe('NETWORK_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry authentication errors or expose provider error bodies', async () => {
    const readBody = vi.fn().mockResolvedValue('private echoed prompt and token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: readBody });
    vi.stubGlobal('fetch', fetchMock);
    const result = await create({ maxRetries: 3 }).complete('private prompt');
    expect(result.error?.code).toBe('AUTH_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readBody).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not attach private model text to parse errors or console logs', async () => {
    const secret = 'private screenshot text';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: secret } }],
        content: [{ type: 'text', text: secret }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }));
    const result = await create({ maxRetries: 0 }).complete('private prompt');
    expect(result.error?.code).toBe('PARSE_ERROR');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
});

it('redacts unknown-format credentials and private payload fields recursively', () => {
  const metadata = {
    token: 'short-custom-secret', nested: { apiKey: 'also-short', prompt: 'private text' },
    access_token: 'token-value', provider: 'openai',
  };
  const output = JSON.stringify(redactLogValue(metadata));
  expect(output).not.toMatch(/short-custom-secret|also-short|private text|token-value/);
  expect(output).toContain('openai');
  expect(metadata.token).toBe('short-custom-secret');
});

it('redacts Error messages as well as structured metadata in persisted logs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-ai-log-test-'));
  try {
    const logger = new Logger({ logDir: dir });
    logger.error('test', 'Failed', new Error('Bearer sensitive-token'), { apiKey: 'custom-secret', prompt: 'private prompt' });
    logger.warn('test', 'Warning', new Error('glpat-sensitive1234567890'));
    const output = fs.readdirSync(dir).map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('');
    expect(output).not.toMatch(/sensitive-token|custom-secret|private prompt|glpat-sensitive1234567890/);
    expect(output).toContain('[REDACTED]');
  } finally {
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
    fs.rmdirSync(dir);
  }
});
