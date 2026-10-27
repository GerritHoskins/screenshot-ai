import { beforeEach, describe, expect, it, vi } from 'vitest';

const { credentials, keychain } = vi.hoisted(() => {
  const credentials = new Map<string, string>();
  return {
    credentials,
    keychain: {
      getPassword: vi.fn(async (_service: string, account: string) => credentials.get(account) ?? null),
      setPassword: vi.fn(async (_service: string, account: string, value: string) => { credentials.set(account, value); }),
      deletePassword: vi.fn(async (_service: string, account: string) => credentials.delete(account)),
      findCredentials: vi.fn(async () => [...credentials].map(([account, password]) => ({ account, password }))),
    },
  };
});

vi.mock('../../src/security/keychain', () => ({ createKeychainService: vi.fn(async () => keychain) }));
vi.mock('../../src/logging', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { deleteRepoToken, getKeychainAccount, getRepoToken, storeRepoToken } from '../../src/security/repo-auth';
import { pollGitHubToken, startGitHubDeviceFlow, startGitLabDeviceFlow } from '../../src/security/oauth';

beforeEach(() => { credentials.clear(); });

describe('repository credential identity', () => {
  it.each(['github', 'gitlab'] as const)('round-trips plain and canonical %s account references', async provider => {
    await storeRepoToken(provider, 'stored-secret', 'alice');
    expect(await getRepoToken(provider, `${provider}:user:alice`)).toBe('stored-secret');
    expect(await getRepoToken(provider, 'alice')).toBe('stored-secret');
    expect(await deleteRepoToken(provider, `${provider}:user:alice`)).toBe(true);
    expect(await getRepoToken(provider, 'alice')).toBeNull();
  });

  it('resolves an unambiguous named identity for default status and disconnect', async () => {
    credentials.set('github:user:alice', 'secret');
    expect(await getRepoToken('github')).toBe('secret');
    expect(await deleteRepoToken('github')).toBe(true);
    expect(credentials.size).toBe(0);
  });

  it('never arbitrarily selects or deletes one of multiple identities', async () => {
    credentials.set('github:user:alice', 'secret-a');
    credentials.set('github:user:bob', 'secret-b');
    expect(await getRepoToken('github')).toBeNull();
    expect(await deleteRepoToken('github')).toBe(false);
    expect(credentials.size).toBe(2);
  });

  it('rejects cross-provider and malformed references', () => {
    expect(() => getKeychainAccount('github', 'gitlab:user:alice')).toThrow('Invalid repository authentication reference');
    expect(() => getKeychainAccount('github', 'github:user:')).toThrow();
  });
});

it('fails closed before contacting OAuth endpoints when registered client IDs are absent', async () => {
  vi.stubEnv('SCREENSHOT_AI_GITHUB_CLIENT_ID', '');
  vi.stubEnv('SCREENSHOT_AI_GITLAB_CLIENT_ID', '');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(startGitHubDeviceFlow()).rejects.toThrow('OAuth is not configured');
    await expect(startGitLabDeviceFlow()).rejects.toThrow('OAuth is not configured');
    await expect(pollGitHubToken('private-device-code', 5)).rejects.toThrow('OAuth is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
