import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import type { IpcMainInvokeEvent } from 'electron';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  files: new Map<string, string>(),
  storeApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  complete: vi.fn(),
  createProvider: vi.fn(),
  writeFileSync: vi.fn(),
  loadUnifiedContext: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler) },
  app: { getPath: () => resolve('.cache/test-user-data') },
  dialog: {},
  shell: {},
}));
vi.mock('fs', () => ({
  existsSync: (file: string) => mocks.files.has(file),
  readFileSync: (file: string) => mocks.files.get(file),
  unlinkSync: (file: string) => mocks.files.delete(file),
  mkdirSync: vi.fn(),
  writeFileSync: mocks.writeFileSync,
}));
vi.mock('../../src/logging', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));
vi.mock('../../src/security/keychain', () => ({
  storeApiKey: mocks.storeApiKey,
  deleteApiKey: mocks.deleteApiKey,
  getApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  validateApiKeyFormat: () => true,
  maskApiKey: vi.fn(),
}));
vi.mock('../../src/providers', () => ({ createProvider: mocks.createProvider }));
vi.mock('../../src/context/unified-loader', () => ({ loadUnifiedContext: mocks.loadUnifiedContext }));

import { registerSettingsHandlers } from '../../apps/desktop/src/main/settings';

const rendererDirectory = resolve('dist/renderer');
function event(url = pathToFileURL(resolve(rendererDirectory, 'settings.html')).href): IpcMainInvokeEvent {
  const frame = { url };
  return { sender: { mainFrame: frame, isDestroyed: () => false }, senderFrame: frame } as unknown as IpcMainInvokeEvent;
}
function invoke(channel: string, ...args: unknown[]) {
  return mocks.handlers.get(channel)!(event(), ...args);
}

beforeEach(() => {
  vi.stubEnv('ELECTRON_RENDERER_URL', '');
  mocks.handlers.clear();
  mocks.files.clear();
  vi.clearAllMocks();
  mocks.writeFileSync.mockImplementation((file: string, content: string) => mocks.files.set(file, content));
  mocks.complete.mockResolvedValue({ success: true });
  mocks.createProvider.mockReturnValue({ complete: mocks.complete });
  registerSettingsHandlers(rendererDirectory);
});

describe('settings IPC security wiring', () => {
  it('rejects untrusted senders and invalid payloads before touching credentials', () => {
    const handler = mocks.handlers.get('settings:storeApiKey')!;
    expect(() => handler(event('https://example.com'), 'openai', 'secret')).toThrow('untrusted');
    expect(() => handler(event(), 'attacker', 'secret')).toThrow('untrusted');
    expect(mocks.storeApiKey).not.toHaveBeenCalled();
  });

  it('tests the supplied credential directly without writing or deleting saved keys', async () => {
    await expect(invoke('settings:testApiKey', 'openai', 'temporary-key')).resolves.toMatchObject({ success: true });
    expect(mocks.createProvider).toHaveBeenCalledWith('openai', expect.objectContaining({ apiKey: 'temporary-key', timeout: 5000, maxRetries: 0 }));
    expect(mocks.storeApiKey).not.toHaveBeenCalled();
    expect(mocks.deleteApiKey).not.toHaveBeenCalled();
    expect(mocks.writeFileSync.mock.calls.every(call => !String(call[1]).includes('temporary-key'))).toBe(true);
  });

  it('does not report failed provider requests as a successful credential test', async () => {
    mocks.complete.mockResolvedValue({ success: false, error: { code: 'TIMEOUT', message: 'raw secret temporary-key' } });
    const result = await invoke('settings:testApiKey', 'anthropic', 'temporary-key');
    expect(result).toMatchObject({ success: false, errorCode: 'timeout' });
    expect(JSON.stringify(result)).not.toContain('temporary-key');
    expect(mocks.storeApiKey).not.toHaveBeenCalled();
  });

  it('uses the unified loader for tree-only previews without a separate content-loading fallback', async () => {
    mocks.loadUnifiedContext.mockResolvedValue({ files: [], tree: [{ path: 'src', type: 'dir' }], stats: { totalSize: 0, sources: [] } });
    await expect(invoke('settings:getContextPreview', 'workspace')).resolves.toMatchObject({ success: true, fileCount: 0, treeEntryCount: 1 });
    expect(mocks.loadUnifiedContext).toHaveBeenCalledWith({ workspaceRoot: 'workspace' });
  });

  it('keeps provider/model selections coherent after the real source API normalizes settings', async () => {
    const settingsFile = resolve('.cache/test-user-data/settings.json');
    mocks.files.set(settingsFile, JSON.stringify({ version: 2, provider: 'openai', model: 'openai-original' }));
    const added = await invoke('settings:addContextSource', { type: 'local', enabled: true, scope: { path: '/workspace' } }) as { success: boolean; sourceId: string };
    expect(added.success).toBe(true);
    expect(JSON.parse(mocks.files.get(settingsFile)!).provider).toMatchObject({ selectedProvider: 'openai', selectedModel: 'openai-original' });

    await invoke('settings:set', 'model', 'openai-updated');
    await invoke('settings:set', 'provider', 'anthropic');
    expect(await invoke('settings:get', 'model')).toBeUndefined();
    await invoke('settings:set', 'model', 'anthropic-selected');
    expect(await invoke('settings:updateContextSource', added.sourceId, { enabled: false })).toMatchObject({ success: true });
    await invoke('settings:set', 'provider', 'openai');
    expect(await invoke('settings:get', 'provider')).toBe('openai');
    expect(await invoke('settings:get', 'model')).toBe('openai-updated');
    expect(await invoke('settings:get', 'providerModels')).toEqual({ openai: 'openai-updated', anthropic: 'anthropic-selected' });
    expect(JSON.parse(mocks.files.get(settingsFile)!).context.sources).toHaveLength(1);
  });

  it('synchronizes imported, disabled and cleared custom prompts after source normalization', async () => {
    const settingsFile = resolve('.cache/test-user-data/settings.json');
    const promptFile = resolve('.cache/test-user-data/custom-prompt.txt');
    mocks.files.set(settingsFile, JSON.stringify({ version: 2, provider: 'openai', promptEnabled: true, prompt: { useCustom: true, customText: 'old prompt' } }));
    expect(await invoke('settings:addContextSource', { type: 'local', enabled: false, scope: { path: '/workspace' } })).toMatchObject({ success: true });
    expect(await invoke('settings:importPrompt', 'new prompt')).toEqual({ success: true });
    expect(await invoke('settings:getPromptText')).toEqual({ text: 'new prompt' });
    expect(JSON.parse(mocks.files.get(settingsFile)!).prompt).toEqual({ useCustom: true, customText: 'new prompt' });
    expect(mocks.files.get(promptFile)).toBe('new prompt');

    await invoke('settings:setPromptEnabled', false);
    expect(await invoke('settings:getPromptStatus')).toEqual({ enabled: false, length: 10 });
    expect(JSON.parse(mocks.files.get(settingsFile)!).promptEnabled).toBe(false);
    expect(JSON.parse(mocks.files.get(settingsFile)!).prompt.useCustom).toBe(false);
    await invoke('settings:clearPrompt');
    expect(await invoke('settings:getPromptStatus')).toEqual({ enabled: false, length: 0 });
    expect(await invoke('settings:getPromptText')).toEqual({ text: '' });
    expect(JSON.parse(mocks.files.get(settingsFile)!).prompt).toEqual({ useCustom: false });
    expect(mocks.files.has(promptFile)).toBe(false);
  });
});
