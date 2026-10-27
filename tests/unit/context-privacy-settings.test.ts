import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DEFAULT_SETTINGS } from '../../src/settings/schema';
import { getSettings } from '../../src/settings/store';
import { addSource, removeSource, updateSource } from '../../src/context/sources';
import { loadUnifiedContext } from '../../src/context/unified-loader';

const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }));
vi.mock('@logging', () => ({ getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-ai-settings-test-'));
});
afterEach(() => fs.rmSync(state.directory, { recursive: true, force: true }));

function writeSettings(settings: unknown) {
  fs.writeFileSync(path.join(state.directory, 'settings.json'), JSON.stringify(settings));
}

describe('desktop settings privacy across legacy and versioned writes', () => {
  it('normalizes the actual legacy version-2 desktop shape before source changes', () => {
    writeSettings({
      version: 2, provider: 'anthropic', model: 'chosen-model',
      workspaceContextEnabled: true, workspaceRoot: state.directory,
      context: {
        enabled: true, includeFileContents: false, includeFileTree: false, excludes: ['private.*'],
        sources: [{ id: 'local', type: 'local', enabled: true, scope: { path: state.directory, includeFileContents: false } }],
      },
      credentials: { anthropic: { apiKeyStored: true, lastTested: 123 } },
    });
    const settings = getSettings();
    expect(settings.provider).toEqual({ selectedProvider: 'anthropic', selectedModel: 'chosen-model' });
    expect(updateSource('local', { enabled: false })).toEqual({ success: true });
    const result = addSource({ type: 'local', enabled: false, scope: { path: path.join(state.directory, 'another') } });
    expect(result.success).toBe(true);
    const persisted = getSettings();
    expect(persisted.context.includeFileContents).toBe(false);
    expect(persisted.context.includeFileTree).toBe(false);
    expect(persisted.context.excludes).toEqual(['private.*']);
    expect(persisted.context.sources![0].enabled).toBe(false);
    expect(persisted.context.sources![0].scope!.includeFileContents).toBe(false);
    expect(persisted.credentials.anthropic?.lastTested).toBe(123);
  });

  it('handles ordinary version-2 desktop settings without a context object safely', async () => {
    writeSettings({ version: 2, provider: 'openai', promptEnabled: false, workspaceContextEnabled: false });
    expect(getSettings().context.enabled).toBe(false);
    expect((await loadUnifiedContext({ includeFileContents: true })).files).toEqual([]);
    expect(addSource({ type: 'local', enabled: false, scope: { path: state.directory } }).success).toBe(true);
    expect(getSettings().context.enabled).toBe(false);
  });

  it('does not resurrect the last removed source from a retained workspaceRoot', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.context.enabled = true;
    settings.context.workspaceRoot = state.directory;
    settings.context.sources = [{ id: 'local', type: 'local', enabled: true, scope: { path: state.directory } }];
    writeSettings(settings);
    fs.writeFileSync(path.join(state.directory, 'private.ts'), 'SHOULD_NOT_LOAD');
    expect(removeSource('local')).toEqual({ success: true });
    expect(getSettings().context.sources).toEqual([]);
    expect((await loadUnifiedContext()).files).toEqual([]);
  });

  it('preserves explicit canonical prompt and source opt-outs over stale legacy fields', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.context.workspaceRoot = state.directory;
    settings.context.sources = [];
    writeSettings({ ...settings, promptEnabled: true, workspaceContextEnabled: true });
    const persisted = getSettings();
    expect(persisted.context.enabled).toBe(false);
    expect(persisted.context.sources).toEqual([]);
    expect(persisted.prompt.useCustom).toBe(false);
  });
});
