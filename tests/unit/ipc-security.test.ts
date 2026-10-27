import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { hardenWindow, isTrustedIpcSender, isTrustedRendererUrl, isValidSelectionRect, validateDesktopIpcArgs } from '../../src/security/ipc-hardening';

const rendererDirectory = resolve('dist/renderer');
const mainUrl = pathToFileURL(resolve(rendererDirectory, 'index.html')).href;

afterEach(() => vi.unstubAllEnvs());

describe('renderer trust boundary', () => {
  it('accepts only exact packaged pages, never sibling files or external URLs', () => {
    expect(isTrustedRendererUrl(mainUrl, rendererDirectory, undefined, '')).toBe(true);
    expect(isTrustedRendererUrl(pathToFileURL(resolve(rendererDirectory, '../index.html')).href, rendererDirectory, undefined, '')).toBe(false);
    expect(isTrustedRendererUrl('https://example.com/index.html', rendererDirectory, undefined, '')).toBe(false);
    expect(isTrustedRendererUrl(pathToFileURL(resolve(rendererDirectory, 'overlay.html')).href, rendererDirectory, undefined, '')).toBe(false);
  });

  it('restricts development senders by both origin and page', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/settings.html', rendererDirectory, undefined, 'http://localhost:5173')).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5174/settings.html', rendererDirectory, undefined, 'http://localhost:5173')).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5173/unknown.html', rendererDirectory, undefined, 'http://localhost:5173')).toBe(false);
  });

  it('rejects child frames, destroyed renderers, and a different owner window', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const frame = { url: mainUrl };
    const sender = { mainFrame: frame, isDestroyed: () => false };
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    expect(isTrustedIpcSender(event, rendererDirectory)).toBe(true);
    expect(isTrustedIpcSender({ ...event, senderFrame: { url: mainUrl } } as unknown as IpcMainInvokeEvent, rendererDirectory)).toBe(false);
    expect(isTrustedIpcSender(event, rendererDirectory, undefined, { webContents: {} } as BrowserWindow)).toBe(false);
    expect(isTrustedIpcSender({ ...event, sender: { ...sender, isDestroyed: () => true } } as unknown as IpcMainInvokeEvent, rendererDirectory)).toBe(false);
  });

  it('blocks external navigation, popup windows and webview attachment', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const events = new Map<string, (...args: any[]) => void>();
    const setWindowOpenHandler = vi.fn();
    hardenWindow({ webContents: { setWindowOpenHandler, on: (name: string, handler: (...args: any[]) => void) => events.set(name, handler) } } as unknown as BrowserWindow, rendererDirectory);
    expect(setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const preventDefault = vi.fn();
    events.get('will-navigate')!({ preventDefault }, 'https://example.com');
    expect(preventDefault).toHaveBeenCalledOnce();
    events.get('will-navigate')!({ preventDefault }, mainUrl);
    expect(preventDefault).toHaveBeenCalledOnce();
    events.get('will-attach-webview')!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
});

describe('desktop IPC payload validation', () => {
  it('rejects unknown channels, prototype keys and invalid provider/settings values', () => {
    expect(validateDesktopIpcArgs('unknown', [])).toBe(false);
    expect(validateDesktopIpcArgs('settings:set', ['__proto__', {}])).toBe(false);
    expect(validateDesktopIpcArgs('settings:set', ['provider', 'attacker'])).toBe(false);
    expect(validateDesktopIpcArgs('settings:storeApiKey', ['github', 'token'])).toBe(false);
    expect(validateDesktopIpcArgs('settings:set', ['provider', 'anthropic'])).toBe(true);
    expect(validateDesktopIpcArgs('settings:setContextOptions', [{ includeFileContents: false, excludes: ['.env*'] }])).toBe(true);
  });

  it('rejects unsafe export paths and invalid filters but accepts plain filenames', () => {
    expect(validateDesktopIpcArgs('file:saveText', [{ content: 'ok', defaultFileName: '../secrets.json' }])).toBe(false);
    expect(validateDesktopIpcArgs('file:saveText', [{ content: 'ok', defaultFileName: 'C:\\other.json' }])).toBe(false);
    expect(validateDesktopIpcArgs('file:saveText', [{ content: 'ok', filters: [{ name: 'Bad', extensions: ['../exe'] }] }])).toBe(false);
    expect(validateDesktopIpcArgs('file:saveText', [{ content: 'ok', defaultFileName: 'report.json', filters: [{ name: 'JSON', extensions: ['json'] }] }])).toBe(true);
  });

  it('validates source scope fields and rejects dangerous nested keys', () => {
    expect(validateDesktopIpcArgs('settings:addContextSource', [{ type: 'github', enabled: true, scope: { owner: 'owner', repo: 'repo', includeFileContents: false }, authRef: 'github:user:owner' }])).toBe(true);
    expect(validateDesktopIpcArgs('settings:addContextSource', [{ type: 'github', enabled: true, scope: { owner: 'owner', constructor: 'bad' } }])).toBe(false);
    expect(validateDesktopIpcArgs('settings:pollOAuthToken', ['github', 'code', -1])).toBe(false);
  });

  it('accepts finite integer selection bounds and rejects malformed rectangles', () => {
    expect(isValidSelectionRect({ x: 0, y: 10, w: 300, h: 100 })).toBe(true);
    expect(isValidSelectionRect({ x: NaN, y: 0, w: 10, h: 10 })).toBe(false);
    expect(isValidSelectionRect({ x: 0, y: -1, w: 10, h: 10 })).toBe(false);
    expect(isValidSelectionRect({ x: 0.5, y: 0, w: 10, h: 10 })).toBe(false);
  });
});
