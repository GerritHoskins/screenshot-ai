/**
 * OAuth Device Flow - Phase 1
 * Implements OAuth device flow for GitHub and GitLab
 */

import { getLogger } from '@logging';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
}

export interface OAuthFlowResult {
  success: boolean;
  accessToken?: string;
  error?: string;
  errorCode?: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | 'network' | 'unknown';
}

// ============================================================================
// GitHub OAuth Device Flow
// ============================================================================

function getClientId(provider: 'github' | 'gitlab'): string {
  const id = process.env[`SCREENSHOT_AI_${provider.toUpperCase()}_CLIENT_ID`]?.trim();
  if (!id || id === 'example' || id === 'Iv1.8a61f9b3a7aba766') {
    throw new Error(`${provider} OAuth is not configured. Use a personal access token or configure a registered OAuth client ID.`);
  }
  return id;
}
const GITHUB_SCOPE = 'repo read:org read:user';

/**
 * Start GitHub OAuth device flow.
 */
export async function startGitHubDeviceFlow(): Promise<DeviceCodeResponse> {
  const clientId = getClientId('github');
  try {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: GITHUB_SCOPE,
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub device flow failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      verification_uri_complete: data.verification_uri_complete,
      expires_in: data.expires_in,
      interval: data.interval,
    };
  } catch (error) {
    logger.error('oauth', 'GitHub device flow start failed', error instanceof Error ? error : undefined);
    throw error;
  }
}

/**
 * Poll for GitHub OAuth token.
 */
export async function pollGitHubToken(deviceCode: string, interval: number): Promise<TokenResponse> {
  const clientId = getClientId('github');
  interval = Math.min(60, Math.max(5, Number.isFinite(interval) ? interval : 5));
  const maxAttempts = 60; // 5 minutes max (60 * 5 seconds)
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
      signal: AbortSignal.timeout(15000),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      if (!response.ok) {
        throw new Error(`GitHub token poll failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        if (data.error === 'authorization_pending') {
          // Wait and retry
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
          attempts++;
          continue;
        }
        if (data.error === 'slow_down') {
          // Increase interval
          interval += 5;
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
          attempts++;
          continue;
        }
        if (data.error === 'expired_token') {
          throw new Error('Device code expired');
        }
        if (data.error === 'access_denied') {
          throw new Error('User denied access');
        }
        throw new Error(`OAuth error: ${data.error}`);
      }

      if (data.access_token) {
        return {
          access_token: data.access_token,
          token_type: data.token_type,
          scope: data.scope,
        };
      }

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      attempts++;
    } catch (error) {
      if (error instanceof Error && (error.message.includes('expired') || error.message.includes('denied'))) {
        throw error;
      }
      logger.warn('oauth', 'GitHub token poll error', error instanceof Error ? error : undefined);
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      attempts++;
    }
  }

  throw new Error('Token polling timeout');
}

/**
 * Complete GitHub OAuth device flow.
 */
export async function completeGitHubDeviceFlow(): Promise<OAuthFlowResult> {
  try {
    await startGitHubDeviceFlow();
    
    // Return device code info for UI to display
    return {
      success: true,
      accessToken: undefined, // Will be polled separately
      // Store device code response for polling
    } as any; // Type will be extended with deviceCodeResponse
  } catch (error) {
    logger.error('oauth', 'GitHub OAuth flow failed', error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'network',
    };
  }
}

// ============================================================================
// GitLab OAuth Device Flow
// ============================================================================

const GITLAB_SCOPE = 'read_api read_repository';

/**
 * Start GitLab OAuth device flow.
 */
export async function startGitLabDeviceFlow(): Promise<DeviceCodeResponse> {
  const clientId = getClientId('gitlab');
  try {
    const response = await fetch('https://gitlab.com/oauth/device', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: GITLAB_SCOPE,
      }),
    });

    if (!response.ok) {
      throw new Error(`GitLab device flow failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      verification_uri_complete: data.verification_uri_complete,
      expires_in: data.expires_in,
      interval: data.interval,
    };
  } catch (error) {
    logger.error('oauth', 'GitLab device flow start failed', error instanceof Error ? error : undefined);
    throw error;
  }
}

/**
 * Poll for GitLab OAuth token.
 */
export async function pollGitLabToken(deviceCode: string, interval: number): Promise<TokenResponse> {
  const clientId = getClientId('gitlab');
  interval = Math.min(60, Math.max(5, Number.isFinite(interval) ? interval : 5));
  const maxAttempts = 60;
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await fetch('https://gitlab.com/oauth/token', {
        method: 'POST',
      signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      if (!response.ok) {
        throw new Error(`GitLab token poll failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        if (data.error === 'authorization_pending') {
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
          attempts++;
          continue;
        }
        if (data.error === 'slow_down') {
          interval += 5;
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
          attempts++;
          continue;
        }
        if (data.error === 'expired_token') {
          throw new Error('Device code expired');
        }
        if (data.error === 'access_denied') {
          throw new Error('User denied access');
        }
        throw new Error(`OAuth error: ${data.error}`);
      }

      if (data.access_token) {
        return {
          access_token: data.access_token,
          token_type: data.token_type,
          scope: data.scope,
        };
      }

      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      attempts++;
    } catch (error) {
      if (error instanceof Error && (error.message.includes('expired') || error.message.includes('denied'))) {
        throw error;
      }
      logger.warn('oauth', 'GitLab token poll error', error instanceof Error ? error : undefined);
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      attempts++;
    }
  }

  throw new Error('Token polling timeout');
}
