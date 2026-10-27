import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import type { IpcMainEvent } from 'electron';

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: IpcMainEvent, ...args: unknown[]) => unknown>(),
  shortcuts: new Map<string, () => void>(),
  windows: [] as Array<{ webContents: { mainFrame: { url: string }; send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean } }>,
  capture: vi.fn(),
  analyze: vi.fn(),
  settings: vi.fn(),
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
    constructor() { mocks.windows.push(this); }
    async loadFile(file: string) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
  },
  ipcMain: {
    on: (channel: string, handler: (event: IpcMainEvent, ...args: unknown[]) => unknown) => mocks.events.set(channel, handler),
    handle: vi.fn(),
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
vi.mock('../../apps/desktop/src/main/analysis', () => ({ getAnalysisService: () => ({ analyzeScreenshot: mocks.analyze }) }));
vi.mock('../../apps/desktop/src/main/settings', () => ({ registerSettingsHandlers: mocks.settings }));
vi.mock('../../src/logging', () => ({ getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), logAIResponse: vi.fn() }) }));
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
