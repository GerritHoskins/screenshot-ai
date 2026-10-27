/**
 * Repository Authentication - Phase 1
 * Handles GitHub and GitLab authentication (PAT and OAuth)
 */

import { createKeychainService, type KeychainService } from './keychain';
import { getLogger } from '@logging';

// Lazy-load keychain service
let keychainService: Promise<KeychainService> | null = null;

async function getKeychainService(): Promise<KeychainService> {
  if (!keychainService) {
    keychainService = createKeychainService().catch(error => {
      keychainService = null;
      throw error;
    });
  }
  return keychainService;
}

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export type RepoProvider = 'github' | 'gitlab';

export interface AuthToken {
  token: string;
  type: 'pat' | 'oauth';
  scopes?: string[];
  expiresAt?: number;
}

export interface AuthStatus {
  authenticated: boolean;
  username?: string;
  tokenType?: 'pat' | 'oauth';
  scopes?: string[];
}

export interface TokenValidationResult {
  valid: boolean;
  username?: string;
  scopes?: string[];
  error?: string;
}

// ============================================================================
// Keychain Account Names
// ============================================================================

export function getKeychainAccount(provider: RepoProvider, username?: string): string {
  if (provider !== 'github' && provider !== 'gitlab') throw new Error('Invalid repository provider');
  if (!username) return `${provider}:default`;
  if (username === `${provider}:default`) return username;
  if (username.startsWith(`${provider}:user:`)) {
    const accountName = username.slice(`${provider}:user:`.length);
    if (accountName && !accountName.includes(':')) return username;
  } else if (!username.includes(':')) {
    return `${provider}:user:${username}`;
  }
  throw new Error('Invalid repository authentication reference');
}

async function resolveStoredAccount(keychain: KeychainService, provider: RepoProvider, username?: string): Promise<string> {
  const account = getKeychainAccount(provider, username);
  if (account !== `${provider}:default` || await keychain.getPassword(SERVICE_NAME, account)) return account;
  const accounts = (await keychain.findCredentials(SERVICE_NAME))
    .filter(credential => credential.account.startsWith(`${provider}:user:`));
  // Never silently select or delete one of several authenticated identities.
  return accounts.length === 1 ? accounts[0].account : account;
}

// ============================================================================
// Token Storage
// ============================================================================

const SERVICE_NAME = 'screenshot-ai';

/**
 * Store repository access token in keychain.
 */
export async function storeRepoToken(
  provider: RepoProvider,
  token: string,
  username?: string
): Promise<void> {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token');
  }

  const keychain = await getKeychainService();
  const account = getKeychainAccount(provider, username);
  
  await keychain.setPassword(SERVICE_NAME, account, token);
  logger.info('repo-auth', 'Token stored', { provider, account });
}

/**
 * Retrieve repository access token from keychain.
 */
export async function getRepoToken(
  provider: RepoProvider,
  username?: string
): Promise<string | null> {
  const keychain = await getKeychainService();
  const account = await resolveStoredAccount(keychain, provider, username);
  return keychain.getPassword(SERVICE_NAME, account);
}

/**
 * Delete repository access token from keychain.
 */
export async function deleteRepoToken(
  provider: RepoProvider,
  username?: string
): Promise<boolean> {
  const keychain = await getKeychainService();
  const account = await resolveStoredAccount(keychain, provider, username);
  
  const deleted = await keychain.deletePassword(SERVICE_NAME, account);
  logger.info('repo-auth', 'Token deleted', { provider, account, deleted });
  return deleted;
}

/**
 * Check if a repository token exists.
 */
export async function hasRepoToken(
  provider: RepoProvider,
  username?: string
): Promise<boolean> {
  const token = await getRepoToken(provider, username);
  return token !== null;
}

/**
 * List all stored repository tokens.
 */
export async function listStoredRepoTokens(): Promise<Array<{ provider: RepoProvider; account: string }>> {
  const keychain = await getKeychainService();
  const credentials = await keychain.findCredentials(SERVICE_NAME);
  
  return credentials
    .filter(c => c.account.startsWith('github:') || c.account.startsWith('gitlab:'))
    .map(c => ({
      provider: c.account.startsWith('github:') ? 'github' as RepoProvider : 'gitlab' as RepoProvider,
      account: c.account,
    }));
}

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Validate GitHub token by calling /user endpoint.
 */
async function validateGitHubToken(token: string): Promise<TokenValidationResult> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ScreenshotAI',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, error: 'Invalid token - authentication failed' };
      }
      if (response.status === 403) {
        return { valid: false, error: 'Token lacks required permissions' };
      }
      return { valid: false, error: `GitHub API error: ${response.status}` };
    }

    const user = await response.json();
    const scopes = response.headers.get('X-OAuth-Scopes')?.split(', ') || [];

    return {
      valid: true,
      username: user.login,
      scopes,
    };
  } catch (error) {
    logger.error('repo-auth', 'GitHub token validation failed', error instanceof Error ? error : undefined);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Network error during validation',
    };
  }
}

/**
 * Validate GitLab token by calling /user endpoint.
 */
async function validateGitLabToken(token: string): Promise<TokenValidationResult> {
  try {
    // Try GitLab.com first, could be extended for self-hosted instances
    const response = await fetch('https://gitlab.com/api/v4/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, error: 'Invalid token - authentication failed' };
      }
      if (response.status === 403) {
        return { valid: false, error: 'Token lacks required permissions' };
      }
      return { valid: false, error: `GitLab API error: ${response.status}` };
    }

    const user = await response.json();
    // GitLab tokens don't expose scopes in the same way, but we can check if user endpoint works
    const scopes: string[] = []; // GitLab API doesn't return scopes in /user endpoint

    return {
      valid: true,
      username: user.username,
      scopes,
    };
  } catch (error) {
    logger.error('repo-auth', 'GitLab token validation failed', error instanceof Error ? error : undefined);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Network error during validation',
    };
  }
}

/**
 * Validate a repository access token.
 */
export async function validateRepoToken(
  provider: RepoProvider,
  token: string
): Promise<TokenValidationResult> {
  switch (provider) {
    case 'github':
      return validateGitHubToken(token);
    case 'gitlab':
      return validateGitLabToken(token);
    default:
      return { valid: false, error: `Unknown provider: ${provider}` };
  }
}

/**
 * Test a repository token (validate and return status).
 */
export async function testRepoToken(
  provider: RepoProvider,
  token: string
): Promise<{ success: boolean; username?: string; scopes?: string[]; error?: string }> {
  const validation = await validateRepoToken(provider, token);
  
  if (validation.valid) {
    return {
      success: true,
      username: validation.username,
      scopes: validation.scopes,
    };
  }
  
  return {
    success: false,
    error: validation.error,
  };
}

/**
 * Get authentication status for a provider.
 */
export async function getAuthStatus(
  provider: RepoProvider,
  username?: string
): Promise<AuthStatus> {
  const token = await getRepoToken(provider, username);
  
  if (!token) {
    return { authenticated: false };
  }
  
  // Validate the stored token
  const validation = await validateRepoToken(provider, token);
  
  if (validation.valid) {
    return {
      authenticated: true,
      username: validation.username || username,
      tokenType: 'pat', // Could be enhanced to detect OAuth vs PAT
      scopes: validation.scopes,
    };
  }
  
  // Token exists but is invalid
  return {
    authenticated: false,
  };
}
