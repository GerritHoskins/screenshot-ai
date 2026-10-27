import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_SETTINGS, type SettingsSchema } from '../../src/settings/schema';
import type { RepoContext } from '../../src/context/repo-fetcher';

const state = vi.hoisted(() => ({ directory: '', credentials: new Map<string, string>() }));
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }));
vi.mock('../../src/settings/store', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/context/repo-fetcher', () => ({ fetchRepoContext: vi.fn() }));
vi.mock('@logging', () => ({ getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../../src/security/keychain', () => ({
  createKeychainService: async () => ({
    getPassword: async (_service: string, account: string) => state.credentials.get(account) ?? null,
    setPassword: async (_service: string, account: string, token: string) => { state.credentials.set(account, token); },
    deletePassword: async (_service: string, account: string) => state.credentials.delete(account),
    findCredentials: async () => [...state.credentials].map(([account, password]) => ({ account, password })),
  }),
}));

import { getSettings } from '../../src/settings/store';
import { fetchRepoContext } from '../../src/context/repo-fetcher';
import { loadUnifiedContext } from '../../src/context/unified-loader';
import { deleteRepoToken, storeRepoToken } from '../../src/security/repo-auth';
import { getCacheStats } from '../../src/context/repo-cache';

let settings: SettingsSchema;
const remoteContext = (content: string): RepoContext => ({
  files: [{ path: 'index.ts', content, size: content.length, truncated: false }],
  tree: [{ path: 'index.ts', type: 'file' }],
  stats: { branch: 'main', lastFetched: Date.now(), totalFiles: 1, totalSize: content.length },
});

beforeEach(() => {
  state.credentials.clear();
  vi.clearAllMocks();
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-ai-auth-cache-'));
  settings = structuredClone(DEFAULT_SETTINGS);
  settings.context.enabled = true;
  settings.context.sources = [{ id: 'private', type: 'github', enabled: true, authRef: 'github:user:alice', scope: { owner: 'owner', repo: 'private' } }];
  vi.mocked(getSettings).mockImplementation(() => settings);
});

afterEach(() => {
  fs.rmSync(state.directory, { recursive: true, force: true });
});

describe('private repository cache authentication boundary', () => {
  it('requires a stored credential before fetching or using a cache', async () => {
    const result = await loadUnifiedContext();
    expect(result.files).toEqual([]);
    expect(fetchRepoContext).not.toHaveBeenCalled();
  });

  it('stops returning cached private context after disconnect and refetches for a new credential', async () => {
    const originalToken = 'test-original-private-credential';
    await storeRepoToken('github', originalToken, 'alice');
    vi.mocked(fetchRepoContext).mockResolvedValue(remoteContext('PRIVATE_ORIGINAL_CONTENT'));
    expect((await loadUnifiedContext()).files[0].content).toBe('PRIVATE_ORIGINAL_CONTENT');
    expect((await loadUnifiedContext()).files[0].content).toBe('PRIVATE_ORIGINAL_CONTENT');
    expect(fetchRepoContext).toHaveBeenCalledTimes(1);
    expect(getCacheStats().entryCount).toBe(1);
    expect(fs.readFileSync(path.join(state.directory, 'repo-cache/cache.json'), 'utf8')).not.toContain(originalToken);

    expect(await deleteRepoToken('github', 'alice')).toBe(true);
    expect((await loadUnifiedContext()).files).toEqual([]);
    expect(fetchRepoContext).toHaveBeenCalledTimes(1);

    await storeRepoToken('github', 'test-replacement-private-credential', 'alice');
    vi.mocked(fetchRepoContext).mockResolvedValue(remoteContext('NEW_ACCOUNT_PERMISSION_CONTENT'));
    expect((await loadUnifiedContext()).files[0].content).toBe('NEW_ACCOUNT_PERMISSION_CONTENT');
    expect(fetchRepoContext).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchRepoContext).mock.calls[1][2]).toBe('test-replacement-private-credential');
  });

  it('cannot reuse another account cache through a default auth reference', async () => {
    delete settings.context.sources![0].authRef;
    await storeRepoToken('github', 'test-alice-credential', 'alice');
    vi.mocked(fetchRepoContext).mockResolvedValue(remoteContext('ALICE_CONTEXT'));
    expect((await loadUnifiedContext()).files[0].content).toBe('ALICE_CONTEXT');
    await deleteRepoToken('github', 'alice');
    await storeRepoToken('github', 'test-bob-credential', 'bob');
    vi.mocked(fetchRepoContext).mockResolvedValue(remoteContext('BOB_CONTEXT'));
    expect((await loadUnifiedContext()).files[0].content).toBe('BOB_CONTEXT');
    expect(fetchRepoContext).toHaveBeenCalledTimes(2);
  });

  it.each(['disconnect', 'replace'])('discards an in-flight fetch when authentication changes: %s', async action => {
    await storeRepoToken('github', 'test-original-credential', 'alice');
    vi.mocked(fetchRepoContext).mockImplementation(async () => {
      if (action === 'disconnect') await deleteRepoToken('github', 'alice');
      else await storeRepoToken('github', 'test-replaced-credential', 'alice');
      return remoteContext('REVOKED_IN_FLIGHT_CONTENT');
    });
    expect((await loadUnifiedContext()).files).toEqual([]);
    expect(getCacheStats().entryCount).toBe(0);
  });
});
