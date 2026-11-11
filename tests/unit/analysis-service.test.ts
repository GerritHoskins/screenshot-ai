import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisService } from '../../apps/desktop/src/main/analysis';
import { createProvider } from '../../src/providers';
import { getApiKey } from '../../src/security/keychain';
import { DEFAULT_PROVIDER_CONFIG } from '../../src/providers/base';

vi.mock('electron', () => ({ app: { getPath: () => 'unused-test-path' } }));
vi.mock('../../src/providers', () => ({ createProvider: vi.fn() }));
vi.mock('../../src/security/keychain', () => ({ getApiKey: vi.fn() }));

const complete = vi.fn();
const analyze = (signal?: AbortSignal) =>
  new AnalysisService({ provider: 'anthropic', workspaceContextEnabled: false }).analyzeScreenshot(Buffer.from('image'), null, undefined, signal);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiKey).mockResolvedValue('test-key');
  complete.mockResolvedValue({ success: true, data: { answer: 'ok', confidence: 1 }, metadata: { provider: 'anthropic' } });
  vi.mocked(createProvider).mockReturnValue({ name: 'anthropic', config: DEFAULT_PROVIDER_CONFIG, validateConfig: async () => true, complete });
});

describe('desktop AnalysisService', () => {
  it('reports a missing key as AUTH_ERROR naming the provider', async () => {
    vi.mocked(getApiKey).mockResolvedValue(null);
    const response = await analyze();
    expect(response.success).toBe(false);
    expect(response.error).toMatchObject({ code: 'AUTH_ERROR', retryable: false });
    expect(response.error?.message).toBe('No API key is stored for Anthropic. Add one in Settings > API Keys.');
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('records what was sent only once the request leaves the machine', async () => {
    const service = new AnalysisService({ provider: 'anthropic', workspaceContextEnabled: false });
    vi.mocked(getApiKey).mockResolvedValueOnce(null);
    await service.analyzeScreenshot(Buffer.from('x'));
    expect(service.lastSent).toBeNull();
    await service.analyzeScreenshot(Buffer.from('x'));
    expect(service.lastSent).toEqual({ contextFiles: 0, customPrompt: false });
  });

  it('resolves the effective model to the provider default when none is set', () => {
    expect(new AnalysisService({ provider: 'anthropic' }).model).toMatch(/^claude-/);
    expect(new AnalysisService({ provider: 'openai', model: 'custom-model' }).model).toBe('custom-model');
  });

  it('passes the cancellation signal to the provider', async () => {
    const controller = new AbortController();
    await analyze(controller.signal);
    expect(complete.mock.calls[0][2]).toEqual({ signal: controller.signal });
  });

  it('returns a retryable CANCELLED response without calling the provider when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await analyze(controller.signal);
    expect(response.error).toMatchObject({ code: 'CANCELLED', retryable: true });
    expect(complete).not.toHaveBeenCalled();
  });
});
