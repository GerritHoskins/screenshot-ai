import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRepoContext } from '../../src/context/repo-fetcher';
import { getRepoToken } from '../../src/security/repo-auth';
import { compileExclusions } from '../../src/context/policy';

vi.mock('@logging', () => ({ getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../../src/security/repo-auth', () => ({ getRepoToken: vi.fn(async () => 'test-repository-token') }));

afterEach(() => vi.unstubAllGlobals());

describe('repository context boundaries', () => {
  it('uses one commit for the scoped GitHub tree and contents, even when tree output is disabled', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(input);
      if (url.pathname.includes('/git/ref/heads/')) return Response.json({ object: { sha: 'selected-commit' } });
      if (url.pathname.includes('/git/trees/')) {
        expect(url.search).toBe('?recursive=1');
        return Response.json({ tree: [
          { path: 'src/index.ts', type: 'blob', size: 10 },
          { path: 'src/secrets.json', type: 'blob', size: 10 },
          { path: 'private.ts', type: 'blob', size: 10 },
          { path: 'src-other/file.ts', type: 'blob', size: 10 },
        ] });
      }
      expect(url.pathname).toBe('/repos/owner/repository/contents/src/index.ts');
      expect(url.searchParams.get('ref')).toBe('selected-commit');
      return Response.json({ encoding: 'base64', content: Buffer.from('safe source').toString('base64'), size: 11, sha: 'file-sha' });
    }));
    const result = await fetchRepoContext({
      id: 'source', type: 'github', enabled: true, authRef: 'github:user:alice',
      scope: { owner: 'owner', repo: 'repository', defaultBranch: 'feature/branch', pathScope: 'src' },
    }, { includeFileTree: false, includeFileContents: true, excludePatterns: compileExclusions(['secrets.*']) });
    expect(getRepoToken).toHaveBeenCalledWith('github', 'github:user:alice');
    expect(result.tree).toEqual([]);
    expect(result.files.map(file => file.path)).toEqual(['src/index.ts']);
    expect(result.files[0].content).toBe('safe source');
    expect(requests).toHaveLength(3);
  });

  it('does not read file contents for a tree-only request and excludes sensitive tree entries', async () => {
    const fetch = vi.fn(async (input: string) => {
      if (input.includes('/git/ref/heads/')) return Response.json({ object: { sha: 'commit' } });
      if (input.includes('/git/trees/')) return Response.json({ tree: [
        { path: 'index.ts', type: 'blob', size: 10 }, { path: '.env.local', type: 'blob', size: 10 },
      ] });
      throw new Error('File contents must not be fetched');
    });
    vi.stubGlobal('fetch', fetch);
    const result = await fetchRepoContext({ id: 'source', type: 'github', enabled: true, scope: { owner: 'owner', repo: 'repository' } }, {
      includeFileTree: true, includeFileContents: false, excludePatterns: compileExclusions(['.env']),
    });
    expect(result.files).toEqual([]);
    expect(result.tree.map(entry => entry.path)).toEqual(['index.ts']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
