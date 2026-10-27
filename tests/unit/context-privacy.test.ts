import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DEFAULT_SETTINGS, type SettingsSchema } from '../../src/settings/schema';
import { getSettings } from '../../src/settings/store';
import { loadUnifiedContext } from '../../src/context/unified-loader';
import { compileExclusions, isExcluded } from '../../src/context/policy';
import { scanForSecrets } from '../../src/context/secret-scanner';
import { AnalysisService } from '../../apps/desktop/src/main/analysis';
import { createProvider } from '../../src/providers';
import { DEFAULT_PROVIDER_CONFIG } from '../../src/providers/base';
import { fetchRepoContext } from '../../src/context/repo-fetcher';
import { getCacheKey, getCacheStats } from '../../src/context/repo-cache';

const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }));
vi.mock('../../src/settings/store', () => ({ getSettings: vi.fn() }));
vi.mock('@logging', () => ({ getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../../src/providers', () => ({ createProvider: vi.fn() }));
vi.mock('../../src/security/keychain', () => ({ getApiKey: vi.fn(async () => 'test-key') }));
vi.mock('../../src/security/repo-auth', () => ({ getRepoToken: vi.fn(async () => 'test-repo-key') }));
vi.mock('../../src/context/repo-fetcher', () => ({ fetchRepoContext: vi.fn() }));

let settings: SettingsSchema;
const complete = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-ai-context-test-'));
  settings = structuredClone(DEFAULT_SETTINGS);
  settings.context.enabled = true;
  settings.context.workspaceRoot = state.directory;
  settings.context.sources = [{ id: 'local', type: 'local', enabled: true, scope: { path: state.directory } }];
  vi.mocked(getSettings).mockImplementation(() => settings);
  complete.mockResolvedValue({ success: true, data: { answer: 'safe', confidence: 1 }, metadata: { provider: 'openai' } });
  vi.mocked(createProvider).mockReturnValue({ name: 'openai', config: DEFAULT_PROVIDER_CONFIG, validateConfig: async () => true, complete });
});

afterEach(() => {
  fs.rmSync(state.directory, { recursive: true, force: true });
});

function write(name: string, content: string) {
  const target = path.join(state.directory, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function analyze() {
  return new AnalysisService({ provider: 'openai' }).analyzeScreenshot(Buffer.from('image'));
}

describe('context privacy in the production analysis path', () => {
  it('does not read any source when context is disabled, even when callers request inclusion', async () => {
    settings.context.enabled = false;
    settings.context.sources = [{ id: 'remote', type: 'github', enabled: true, scope: { owner: 'owner', repo: 'repo' } }];
    expect((await loadUnifiedContext({ includeFileContents: true })).files).toEqual([]);
    await analyze();
    expect(fetchRepoContext).not.toHaveBeenCalled();
    expect(complete.mock.calls[0][0]).not.toContain('Workspace Context');
  });

  it('honors global content opt-out and sends only an allowed tree', async () => {
    write('allowed.ts', 'PRIVATE_FILE_CONTENT');
    write('excluded.ts', 'EXCLUDED_FILE_CONTENT');
    settings.context.includeFileContents = false;
    settings.context.excludes.push('excluded.ts');
    const preview = await loadUnifiedContext();
    expect(preview.files).toEqual([]);
    expect(preview.tree.map(entry => entry.path)).toEqual(['allowed.ts']);
    await analyze();
    expect(complete.mock.calls[0][0]).toContain('allowed.ts');
    expect(complete.mock.calls[0][0]).not.toContain('PRIVATE_FILE_CONTENT');
    expect(complete.mock.calls[0][0]).not.toContain('excluded.ts');
  });

  it('enforces per-source flags and excludes as well as global exclusions', async () => {
    write('allowed.ts', 'SAFE_SOURCE_CONTENT');
    write('excluded.ts', 'EXCLUDED_FILE_CONTENT');
    settings.context.sources = [{ id: 'local', type: 'local', enabled: true, scope: { path: state.directory, excludes: ['excluded.ts'], includeFileTree: false } }];
    const preview = await loadUnifiedContext();
    expect(preview.tree).toEqual([]);
    expect(preview.files.map(file => file.path)).toEqual(['allowed.ts']);
    await analyze();
    expect(complete.mock.calls[0][0]).toContain('SAFE_SOURCE_CONTENT');
    expect(complete.mock.calls[0][0]).not.toContain('EXCLUDED_FILE_CONTENT');
  });

  it('never activates a disabled source through a legacy fallback', async () => {
    write('sensitive.ts', 'SHOULD_NOT_BE_READ');
    settings.context.sources = [{ id: 'local', type: 'local', enabled: false, scope: { path: state.directory } }];
    expect((await loadUnifiedContext()).files).toEqual([]);
    await analyze();
    expect(complete.mock.calls[0][0]).not.toContain('SHOULD_NOT_BE_READ');
  });

  it('blocks a detected secret in legacy-folder context before provider creation', async () => {
    delete settings.context.sources;
    const secret = '1234567890abcdefghijklmnop';
    write('config.ts', `const api_key = '${secret}';`);
    const result = await analyze();
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_REQUEST');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('blocks secrets in custom prompts even with repository context disabled', async () => {
    settings.context.enabled = false;
    write('settings.json', JSON.stringify({ prompt: { useCustom: true, customText: 'api_key=1234567890abcdefghijklmnop' } }));
    const result = await analyze();
    expect(result.success).toBe(false);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('blocks remote secrets without storing them in the repository cache', async () => {
    settings.context.sources = [{ id: 'remote', type: 'github', enabled: true, scope: { owner: 'owner', repo: 'repo' } }];
    vi.mocked(fetchRepoContext).mockResolvedValue({
      files: [{ path: 'config.ts', content: 'api_key=1234567890abcdefghijklmnop', size: 40, truncated: false }],
      tree: [], stats: { totalFiles: 1, totalSize: 40, branch: 'main', lastFetched: Date.now() },
    });
    const result = await analyze();
    expect(result.success).toBe(false);
    expect(createProvider).not.toHaveBeenCalled();
    expect(getCacheStats().entryCount).toBe(0);
    expect(fs.existsSync(path.join(state.directory, 'repo-cache/cache.json'))).toBe(false);
  });

  it('blocks standalone fine-grained GitHub tokens before sending or caching them', async () => {
    const token = `github_pat_${'a'.repeat(82)}`;
    settings.context.sources = [{ id: 'remote', type: 'github', enabled: true, scope: { owner: 'owner', repo: 'repo' } }];
    vi.mocked(fetchRepoContext).mockResolvedValue({
      files: [{ path: 'export.ts', content: `export default '${token}';`, size: 120, truncated: false }],
      tree: [], stats: { totalFiles: 1, totalSize: 120, branch: 'main', lastFetched: Date.now() },
    });
    const result = await analyze();
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(createProvider).not.toHaveBeenCalled();
    expect(getCacheStats().entryCount).toBe(0);
    expect(fs.existsSync(path.join(state.directory, 'repo-cache/cache.json'))).toBe(false);
  });

  it('does not resurrect a removed source from the retained legacy workspace folder', async () => {
    write('removed.ts', 'MUST_NOT_REACTIVATE');
    settings.context.sources = [];
    await analyze();
    expect(complete.mock.calls[0][0]).not.toContain('MUST_NOT_REACTIVATE');
    expect((await loadUnifiedContext()).files).toEqual([]);
  });

  it('honors a source-specific content opt-out even when the global setting permits contents', async () => {
    write('private.ts', 'api_key=1234567890abcdefghijklmnop');
    settings.context.sources = [{ id: 'local', type: 'local', enabled: true, scope: { path: state.directory, includeFileContents: false } }];
    const context = await loadUnifiedContext();
    expect(context.files).toEqual([]);
    expect(context.tree.map(entry => entry.path)).toEqual(['private.ts']);
    await analyze();
    expect(complete).toHaveBeenCalled();
    expect(complete.mock.calls[0][0]).not.toContain('1234567890abcdefghijklmnop');
  });

  it('does not climb out of an explicitly selected folder', async () => {
    write('package.json', '{}');
    write('private.ts', 'PARENT_SECRET_CONTENT');
    write('selected/index.ts', 'CHILD_SAFE_CONTENT');
    settings.context.workspaceRoot = path.join(state.directory, 'selected');
    settings.context.sources![0].scope!.path = settings.context.workspaceRoot;
    const context = await loadUnifiedContext();
    expect(context.files.map(file => file.path)).toEqual(['index.ts']);
  });
});

describe('privacy helpers', () => {
  it('matches nested files and environment variants without treating settings as regular expressions', () => {
    const patterns = compileExclusions(['.env', 'secrets.*', 'private[1].ts']);
    for (const name of ['.env', '.env.local', 'config/secrets.yaml', 'private[1].ts']) expect(isExcluded(name, patterns)).toBe(true);
    expect(isExcluded('private1.ts', patterns)).toBe(false);
    expect(isExcluded('src/environment.ts', patterns)).toBe(false);
  });

  it('does not return secret contents from the scanner or skip oversized source metadata', () => {
    const secret = '1234567890abcdefghijklmnop';
    const scan = scanForSecrets([{ path: 'config.ts', content: `api_key=${secret}`, size: 999999, truncated: true }]);
    expect(scan.hasSecrets).toBe(true);
    expect(JSON.stringify(scan)).not.toContain(secret);
    expect(scan.matches[0].content).toBe('[REDACTED]');
  });

  it('detects quoted JSON credentials and private keys regardless of filename', () => {
    const scan = scanForSecrets([
      { path: 'config.json', content: '{"apiKey":"1234567890abcdefghijklmnop"}', size: 50, truncated: false },
      { path: 'notes.ts', content: '-----BEGIN OPENSSH PRIVATE KEY-----', size: 40, truncated: false },
    ]);
    expect(scan.matches).toHaveLength(2);
  });

  it.each(['ghu_', 'ghs_', 'ghr_', 'gho_', 'ghp_'])('detects standalone %s GitHub tokens', prefix => {
    const scan = scanForSecrets([{ path: 'export.ts', content: `export default '${prefix}${'a'.repeat(36)}';`, size: 100, truncated: false }]);
    expect(scan.hasSecrets).toBe(true);
  });

  it('separates caches when privacy options, exclusions, branches or accounts change', () => {
    const source = { id: 'same', type: 'github' as const, enabled: true, scope: { defaultBranch: 'main' } };
    const baseline = getCacheKey(source, { includeFileContents: true });
    expect(getCacheKey(source, { includeFileContents: false })).not.toBe(baseline);
    expect(getCacheKey(source, { includeFileContents: true, excludePatterns: [/private/] })).not.toBe(baseline);
    expect(getCacheKey({ ...source, scope: { defaultBranch: 'other' } }, { includeFileContents: true })).not.toBe(baseline);
    expect(getCacheKey({ ...source, authRef: 'github:user:other' }, { includeFileContents: true })).not.toBe(baseline);
  });
});
