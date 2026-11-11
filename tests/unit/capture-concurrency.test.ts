import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import type { IpcMainEvent } from 'electron';

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: IpcMainEvent, ...args: unknown[]) => unknown>(),
  handlers: new Map<string, (event: IpcMainEvent, ...args: unknown[]) => unknown>(),
  logInfo: vi.fn(),
  shortcuts: new Map<string, () => void>(),
  windows: [] as Array<{ webContents: { mainFrame: { url: string }; send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean } }>,
  capture: vi.fn(),
  analyze: vi.fn(),
  settings: vi.fn(),
  apiKey: vi.fn(async () => 'test-key' as string | null),
}));

vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
    whenReady: () => Promise.resolve(),
    getPath: () => 'unused-test-path',
    on: vi.fn(),
  },
  BrowserWindow: class {
    webContents = {
      mainFrame: { url: '' },
      send: vi.fn(),
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    show = vi.fn();
    focus = vi.fn();
    constructor() { mocks.windows.push(this); }
    async loadFile(file: string) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
  },
  ipcMain: {
    on: (channel: string, handler: (event: IpcMainEvent, ...args: unknown[]) => unknown) => mocks.events.set(channel, handler),
    handle: (channel: string, handler: (event: IpcMainEvent, ...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
  },
  globalShortcut: {
    register: (accelerator: string, handler: () => void) => mocks.shortcuts.set(accelerator, handler),
    unregisterAll: vi.fn(),
  },
  nativeImage: { createFromBuffer: () => ({ toDataURL: () => 'data:image/png;base64,aGVsbG8=' }) },
  dialog: {},
}));
vi.mock('fs', () => ({ existsSync: () => false }));
vi.mock('../../apps/desktop/src/main/capture', () => ({ captureScreenSelection: mocks.capture }));
vi.mock('../../apps/desktop/src/main/shield', () => ({ shieldCapture: async (png: Buffer) => png }));
vi.mock('../../apps/desktop/src/main/analysis', () => ({ getAnalysisService: () => ({ analyzeScreenshot: mocks.analyze, providerType: 'anthropic', model: 'claude-test-model' }) }));
vi.mock('../../src/security/keychain', () => ({ getApiKey: mocks.apiKey }));
vi.mock('../../apps/desktop/src/main/settings', () => ({ registerSettingsHandlers: mocks.settings }));
vi.mock('../../src/logging', () => ({ getLogger: () => ({ debug: vi.fn(), info: mocks.logInfo, warn: vi.fn(), error: vi.fn(), logAIResponse: vi.fn(), logAIRequest: vi.fn() }) }));
vi.mock('../../src/errors', () => ({ mapCaptureError: () => ({ error: { code: 'CAPTURE_ERROR', retryable: true } }), mapProviderError: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function sender(): IpcMainEvent {
  const webContents = mocks.windows[0].webContents;
  return { sender: webContents, senderFrame: webContents.mainFrame } as unknown as IpcMainEvent;
}

async function clickCapture() {
  await mocks.events.get('capture:start')!(sender());
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.events.clear();
  mocks.handlers.clear();
  mocks.shortcuts.clear();
  mocks.windows.length = 0;
  vi.stubEnv('ELECTRON_RENDERER_URL', '');
  await import('../../apps/desktop/src/main/index');
  await vi.waitFor(() => expect(mocks.shortcuts.has('CommandOrControl+Shift+S')).toBe(true));
  expect(mocks.windows[0].webContents.mainFrame.url).toBe(pathToFileURL(resolve('apps/desktop/src/renderer/index.html')).href);
});

describe('actual main-process capture serialization', () => {
  it('ignores repeated button and hotkey triggers during pending selection, then unlocks after cancellation', async () => {
    const selection = deferred<Buffer | null>();
    mocks.capture.mockReturnValueOnce(selection.promise).mockResolvedValueOnce(null);

    await clickCapture();
    await clickCapture();
    mocks.shortcuts.get('CommandOrControl+Shift+S')!();
    expect(mocks.capture).toHaveBeenCalledTimes(1);

    selection.resolve(null);
    await vi.waitFor(() => expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith('analysis:processing', { stage: 'cancelled' }));
    await clickCapture();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('the global hotkey reports a missing API key instead of opening the overlay', async () => {
    mocks.apiKey.mockResolvedValueOnce(null);
    mocks.shortcuts.get('CommandOrControl+Shift+S')!();
    await vi.waitFor(() => expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith('analysis:error', expect.objectContaining({ code: 'AUTH_ERROR', sent: null })));
    expect(mocks.capture).not.toHaveBeenCalled();
    expect((mocks.windows[0] as unknown as { show: ReturnType<typeof vi.fn> }).show).toHaveBeenCalled();
    mocks.capture.mockResolvedValueOnce(null);
    await clickCapture();
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1));
  });

  it('releases the capture lock when screen selection fails', async () => {
    const selection = deferred<Buffer | null>();
    mocks.capture.mockReturnValueOnce(selection.promise).mockResolvedValueOnce(null);
    await clickCapture();
    await clickCapture();
    expect(mocks.capture).toHaveBeenCalledTimes(1);

    selection.reject(new Error('screen capture unavailable'));
    await vi.waitFor(() => expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith('analysis:error', expect.objectContaining({ code: 'CAPTURE_ERROR' })));
    await clickCapture();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});

const IMAGE = Buffer.from('png');
const okResponse = { success: true, data: { confidence: 0.9 }, metadata: { provider: 'anthropic', model: 'claude-test-model', latencyMs: 1, promptTokens: 1, completionTokens: 1 } };
const send = () => mocks.windows[0].webContents.send;
const sentOn = (channel: string) => send().mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('analysis cancel, processing payload and retry', () => {
  it('reports provider and effective model on the analyzing stage and passes an AbortSignal to the service', async () => {
    const analysis = deferred<unknown>();
    mocks.capture.mockResolvedValueOnce(IMAGE);
    mocks.analyze.mockReturnValueOnce(analysis.promise);
    await clickCapture();
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
    expect(send()).toHaveBeenCalledWith('analysis:processing', { stage: 'analyzing', provider: 'anthropic', model: 'claude-test-model' });
    expect(mocks.analyze.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
    analysis.resolve(okResponse);
    await vi.waitFor(() => expect(send()).toHaveBeenCalledWith('analysis:result', okResponse));
  });

  it('aborts the in-flight analysis, emits CANCELLED (retryable), discards the late result and unlocks capture', async () => {
    const analysis = deferred<unknown>();
    mocks.capture.mockResolvedValueOnce(IMAGE).mockResolvedValueOnce(null);
    mocks.analyze.mockReturnValueOnce(analysis.promise);
    await clickCapture();
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));

    mocks.events.get('analysis:cancel')!(sender());
    const signal = mocks.analyze.mock.calls[0][3] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(sentOn('analysis:error')).toEqual([{ code: 'CANCELLED', message: 'Analysis cancelled.', retryable: true }]);

    analysis.resolve(okResponse);
    await flush();
    expect(sentOn('analysis:result')).toEqual([]);

    await clickCapture();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
  });

  it('ignores cancel while a region selection is active and rejects cancel with arguments', async () => {
    const selection = deferred<Buffer | null>();
    mocks.capture.mockReturnValueOnce(selection.promise);
    await clickCapture();
    mocks.events.get('analysis:cancel')!(sender());
    mocks.events.get('analysis:cancel')!(sender(), 'extra');
    expect(sentOn('analysis:error')).toEqual([]);
    await clickCapture();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    selection.resolve(null);
    await vi.waitFor(() => expect(send()).toHaveBeenCalledWith('analysis:processing', { stage: 'cancelled' }));
  });

  it('retry re-analyzes the last image after an error', async () => {
    mocks.capture.mockResolvedValueOnce(IMAGE);
    mocks.analyze
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'offline', retryable: true }, metadata: {} })
      .mockResolvedValueOnce(okResponse);
    await clickCapture();
    await vi.waitFor(() => expect(sentOn('analysis:error')).toHaveLength(1));
    expect(sentOn('analysis:error')[0]).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });

    await mocks.events.get('analysis:retry')!(sender());
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.analyze.mock.calls[1][0]).toBe(IMAGE);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(send()).toHaveBeenCalledWith('analysis:result', okResponse);
  });

  it('retry without an image starts a new capture, and retry after a cancel re-analyzes', async () => {
    mocks.capture.mockResolvedValueOnce(null);
    await mocks.events.get('analysis:retry')!(sender());
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(send()).toHaveBeenCalledWith('analysis:processing', { stage: 'cancelled' }));
    expect(mocks.analyze).not.toHaveBeenCalled();

    const analysis = deferred<unknown>();
    mocks.capture.mockResolvedValueOnce(IMAGE);
    mocks.analyze.mockReturnValueOnce(analysis.promise).mockResolvedValueOnce(okResponse);
    await clickCapture();
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
    mocks.events.get('analysis:cancel')!(sender());
    await mocks.events.get('analysis:retry')!(sender());
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(send()).toHaveBeenCalledWith('analysis:result', okResponse);
  });
});

describe('feedback:submit', () => {
  const submit = (...args: unknown[]) => Promise.resolve().then(() => mocks.handlers.get('feedback:submit')!(sender(), ...args));

  it('accepts the legacy and detailed shapes, rejects invalid details, and never logs the comment', async () => {
    await expect(submit({ positive: true })).resolves.toEqual({ success: true });
    await expect(submit({ positive: false, reason: 'incorrect', comment: 'secret words here' })).resolves.toEqual({ success: true });
    await expect(submit({ positive: false, reason: 'bogus' })).rejects.toThrow();
    await expect(submit({ positive: false, comment: 'x'.repeat(501) })).rejects.toThrow();
    expect(JSON.stringify(mocks.logInfo.mock.calls)).not.toContain('secret words here');
    expect(mocks.logInfo).toHaveBeenCalledWith('main', 'Feedback received', expect.objectContaining({ feedback: 'negative', reason: 'incorrect', hasComment: true }));
  });

  it('passes negative feedback to the retry analysis', async () => {
    mocks.capture.mockResolvedValueOnce(IMAGE);
    mocks.analyze.mockResolvedValue(okResponse);
    await clickCapture();
    await vi.waitFor(() => expect(sentOn('analysis:result')).toHaveLength(1));
    await submit({ positive: false, reason: 'too-verbose' });
    await mocks.events.get('analysis:retry')!(sender());
    expect(mocks.analyze.mock.calls[1][1]).toBe('negative');
  });
});
