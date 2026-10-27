/**
 * Settings Management - Workstream E
 * Handles API key storage, provider selection, and settings persistence.
 */

import { ipcMain, app, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import { isTrustedIpcSender, validateDesktopIpcArgs } from '@security/ipc-hardening';
import { migrateSettings, type ContextSource, type SettingsSchema } from '@settings/schema';
import * as fs from 'fs';
import * as path from 'path';
import {
  storeApiKey,
  getApiKey,
  deleteApiKey,
  hasApiKey,
  validateApiKeyFormat,
  maskApiKey,
  type ProviderKey,
} from '@security/keychain';
import { getLogger } from '@logging';
import { createProvider } from '@providers';
import { loadUnifiedContext } from '@context/unified-loader';
import { scanForSecrets } from '@context/secret-scanner';
import { listSources, addSource, updateSource, removeSource } from '@context/sources';
import { wrapRepoError, formatRepoErrorForLog } from '@context/repo-errors';
import { storeRepoToken, validateRepoToken, testRepoToken, getAuthStatus, deleteRepoToken } from '@security/repo-auth';
import { invalidateCache } from '@context/repo-cache';
import { startGitHubDeviceFlow, startGitLabDeviceFlow, pollGitHubToken, pollGitLabToken } from '@security/oauth';

const logger = getLogger();

// ============================================================================
// Settings Storage
// ============================================================================

// Settings version - increment when schema changes
const SETTINGS_VERSION = 2;

interface AppSettings extends SettingsSchema {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  promptEnabled?: boolean;
  workspaceContextEnabled?: boolean;
  workspaceRoot?: string;
}

function normalizeAppSettings(raw: Record<string, unknown>): AppSettings {
  const canonical = migrateSettings(raw);
  return {
    ...raw,
    ...canonical,
    model: canonical.provider.selectedModel,
    promptEnabled: canonical.prompt.useCustom,
    workspaceContextEnabled: canonical.context.enabled,
    workspaceRoot: canonical.context.workspaceRoot,
  };
}

/**
 * Get settings file path.
 */
function getSettingsPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'settings.json');
}

/**
 * Get app settings from persistent storage.
 */
function getSettings(): AppSettings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      return normalizeAppSettings(JSON.parse(content));
    }
  } catch (error) {
    logger.error('settings', 'Failed to load settings', error instanceof Error ? error : undefined);
  }
  
  return normalizeAppSettings({});
}

/**
 * Save app settings to persistent storage.
 */
function saveSettings(settings: AppSettings): void {
  try {
    const settingsPath = getSettingsPath();
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Canonical fields own the state; legacy aliases remain coherent for older readers.
    settings.version = SETTINGS_VERSION;
    settings.model = settings.provider.selectedModel;
    settings.promptEnabled = settings.prompt.useCustom;
    settings.workspaceContextEnabled = settings.context.enabled;
    settings.workspaceRoot = settings.context.workspaceRoot;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    logger.info('settings', 'Settings saved', { provider: settings.provider, version: settings.version });
  } catch (error) {
    logger.error('settings', 'Failed to save settings', error instanceof Error ? error : undefined);
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Register settings IPC handlers.
 */
export function registerSettingsHandlers(rendererDirectory: string): void {
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event, rendererDirectory) || !validateDesktopIpcArgs(channel, args)) {
        throw new Error('Invalid or untrusted IPC request');
      }
      return handler(event, ...args);
    });
  };
  // Get API key status
  handle('settings:getApiKeyStatus', async (_event, provider: ProviderKey) => {
    try {
      const hasKey = await hasApiKey(provider);
      const masked = hasKey ? await getApiKey(provider).then(k => k ? maskApiKey(k) : null) : null;
      return { hasKey, masked };
    } catch (error) {
      logger.error('settings', 'Failed to get API key status', error instanceof Error ? error : undefined);
      return { hasKey: false, masked: null };
    }
  });

  // Store API key
  handle('settings:storeApiKey', async (_event, provider: ProviderKey, apiKey: string) => {
    try {
      // Validate format
      if (!validateApiKeyFormat(provider, apiKey)) {
        return { success: false, error: 'Invalid API key format' };
      }

      await storeApiKey(provider, apiKey);
      logger.info('settings', 'API key stored', { provider });
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to store API key', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store API key',
      };
    }
  });

  // Delete API key
  handle('settings:deleteApiKey', async (_event, provider: ProviderKey) => {
    try {
      const deleted = await deleteApiKey(provider);
      logger.info('settings', 'API key deleted', { provider, deleted });
      return { success: deleted };
    } catch (error) {
      logger.error('settings', 'Failed to delete API key', error instanceof Error ? error : undefined);
      return { success: false, error: 'Failed to delete API key' };
    }
  });

  // Validate API key format
  handle('settings:validateApiKey', async (_event, provider: ProviderKey, apiKey: string) => {
    return { valid: validateApiKeyFormat(provider, apiKey) };
  });

  // Get current settings
  handle('settings:get', async (_event, key?: string) => {
    if (key === '_path') {
      // Return settings file path for diagnostics
      return path.join(app.getPath('userData'), 'settings.json');
    }
    const settings = getSettings();
    if (key === 'provider') return settings.provider.selectedProvider;
    if (key === 'model') return settings.provider.selectedModel;
    if (key === 'providerModels') return settings.provider.models || {};
    return key ? settings[key as keyof AppSettings] : { ...settings, provider: settings.provider.selectedProvider };
  });

  // Set settings
  handle('settings:set', async (_event, key: string, value: unknown) => {
    const settings = getSettings();
    if (key === 'provider') {
      const current = settings.provider.selectedProvider;
      const models = { ...settings.provider.models };
      if (settings.provider.selectedModel) models[current] = settings.provider.selectedModel;
      const selectedProvider = value as ProviderKey;
      settings.provider = { selectedProvider, selectedModel: models[selectedProvider], models };
    } else if (key === 'model') {
      settings.provider.selectedModel = value as string;
      settings.provider.models = { ...settings.provider.models, [settings.provider.selectedProvider]: value as string };
    } else if (key === 'promptEnabled') {
      settings.prompt.useCustom = value as boolean;
    } else if (key === 'workspaceContextEnabled') {
      settings.context.enabled = value as boolean;
    } else if (key === 'workspaceRoot') {
      settings.context.workspaceRoot = value as string;
    } else {
      settings.advanced = { ...settings.advanced, [key]: value };
      Object.assign(settings, { [key]: value });
    }
    saveSettings(settings);
    
    logger.info('settings', 'Setting updated', { key });
    return { success: true };
  });

  // Custom prompt status
  handle('settings:getPromptStatus', async () => {
    const settings = getSettings();
    const promptText = settings.prompt.customText ?? loadPromptText();
    return { enabled: settings.promptEnabled ?? false, length: promptText.length };
  });

  // Get prompt text
  handle('settings:getPromptText', async () => {
    const promptText = getSettings().prompt.customText ?? loadPromptText();
    return { text: promptText };
  });

  // Import prompt text
  handle('settings:importPrompt', async (_event, text: string) => {
    try {
      if (!text || !text.trim()) return { success: false, error: 'Prompt is empty' };
      savePromptText(text);
      const settings = getSettings();
      settings.prompt.useCustom = true;
      settings.prompt.customText = text;
      saveSettings(settings);
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to import prompt', error instanceof Error ? error : undefined);
      return { success: false, error: 'Failed to import prompt' };
    }
  });

  // Clear prompt
  handle('settings:clearPrompt', async () => {
    try {
      deletePromptText();
      const settings = getSettings();
      settings.prompt.useCustom = false;
      delete settings.prompt.customText;
      saveSettings(settings);
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to clear prompt', error instanceof Error ? error : undefined);
      return { success: false, error: 'Failed to clear prompt' };
    }
  });

  // Enable or disable prompt
  handle('settings:setPromptEnabled', async (_event, enabled: boolean) => {
    const settings = getSettings();
    settings.prompt.useCustom = enabled;
    saveSettings(settings);
    return { success: true };
  });

  // Test with the supplied key directly; never replace the user's saved credential.
  handle('settings:testApiKey', async (_event, provider: ProviderKey, apiKey: string) => {
    const started = Date.now();
    const key = apiKey.trim();
    if (!validateApiKeyFormat(provider, key)) {
      return { success: false, error: 'Invalid API key format', errorCode: 'invalid_key' };
    }
    try {
      const client = createProvider(provider, {
        apiKey: key,
        model: provider === 'openai' ? 'gpt-5.2' : 'claude-sonnet-4-5-20250929',
        maxTokens: 64,
        temperature: 0.1,
        timeout: 5000,
        maxRetries: 0,
        retryBaseDelay: 1000,
        retryMaxDelay: 5000,
      });
      const response = await client.complete('Return only valid JSON: {"text":"test","confidence":1}');
      const latency = Date.now() - started;
      const codes: Record<string, { code: string; message: string }> = {
        AUTH_ERROR: { code: 'invalid_key', message: 'Authentication failed' },
        RATE_LIMIT: { code: 'rate_limited', message: 'Rate limit exceeded; try again later' },
        TIMEOUT: { code: 'timeout', message: 'Connection timed out' },
        NETWORK_ERROR: { code: 'network', message: 'Network request failed' },
      };
      if (!response.success) {
        const failure = codes[response.error?.code || ''] || { code: 'unknown', message: 'Provider test failed' };
        await saveTestStatus(provider, started, 'failure', latency, failure.message);
        return { success: false, error: failure.message, errorCode: failure.code, latency };
      }
      await saveTestStatus(provider, started, 'success', latency);
      return { success: true, latency };
    } catch {
      const latency = Date.now() - started;
      await saveTestStatus(provider, started, 'failure', latency, 'Provider test failed');
      return { success: false, error: 'Provider test failed', errorCode: 'unknown', latency };
    }
  });

  // Helper to save test status to settings
  async function saveTestStatus(
    provider: ProviderKey,
    timestamp: number,
    status: 'success' | 'failure',
    latency?: number,
    error?: string
  ): Promise<void> {
    try {
      const settings = getSettings();
      if (!(settings as any).credentials) {
        (settings as any).credentials = {};
      }
      if (!(settings as any).credentials[provider]) {
        (settings as any).credentials[provider] = { apiKeyStored: false };
      }
      
      (settings as any).credentials[provider].lastTested = timestamp;
      (settings as any).credentials[provider].lastTestStatus = status;
      if (latency !== undefined) {
        (settings as any).credentials[provider].lastTestLatency = latency;
      }
      if (error) {
        (settings as any).credentials[provider].lastTestError = error;
      } else {
        delete (settings as any).credentials[provider].lastTestError;
      }
      
      saveSettings(settings);
    } catch (error) {
      logger.warn('settings', 'Failed to save test status', error instanceof Error ? error : undefined);
    }
  }

  // Get API key test status (last tested info)
  handle('settings:getApiKeyTestStatus', async (_event, provider: ProviderKey) => {
    try {
      // Load from settings schema (Phase 0)
      const settings = getSettings();
      const credentials = (settings as any).credentials?.[provider];
      
      if (credentials) {
        return {
          lastTested: credentials.lastTested || null,
          lastTestStatus: credentials.lastTestStatus || null,
          lastTestLatency: credentials.lastTestLatency || null,
          lastTestError: credentials.lastTestError || null,
        };
      }
      
      return {
        lastTested: null,
        lastTestStatus: null,
        lastTestLatency: null,
        lastTestError: null,
      };
    } catch (error) {
      logger.error('settings', 'Failed to get API key test status', error instanceof Error ? error : undefined);
      return {
        lastTested: null,
        lastTestStatus: null,
        lastTestLatency: null,
        lastTestError: null,
      };
    }
  });

  // Get workspace context status
  handle('settings:getWorkspaceContext', async () => {
    const settings = getSettings();
    // Use new schema format if available
    const contextSettings = (settings as any).context || {};
    return {
      enabled: contextSettings.enabled ?? settings.workspaceContextEnabled ?? false,
      workspaceRoot: contextSettings.workspaceRoot || settings.workspaceRoot || null,
      includeFileTree: contextSettings.includeFileTree ?? true,
      includeFileContents: contextSettings.includeFileContents ?? true,
      excludes: contextSettings.excludes || [],
    };
  });

  // Set workspace context settings
  handle('settings:setWorkspaceContext', async (_event, enabled: boolean, workspaceRoot?: string) => {
    const settings = getSettings();
    // Migrate to new schema format
    if (!(settings as any).context) {
      (settings as any).context = {
        enabled: false,
        includeFileTree: true,
        includeFileContents: true,
        excludes: [],
        sources: [],
      };
    }

    (settings as any).context.enabled = enabled;
    if (workspaceRoot !== undefined) {
      if (workspaceRoot === '') {
        delete (settings as any).context.workspaceRoot;
      } else {
        (settings as any).context.workspaceRoot = workspaceRoot;
      }
    }

    // Keep legacy fields for backward compatibility
    settings.workspaceContextEnabled = enabled;
    if (workspaceRoot !== undefined) {
      if (workspaceRoot === '') {
        delete settings.workspaceRoot;
      } else {
        settings.workspaceRoot = workspaceRoot;
      }
    }

    // Update local source in context.sources to match
    if (!(settings as any).context.sources) {
      (settings as any).context.sources = [];
    }
    const sources = (settings as any).context.sources as any[];
    const existingLocalSource = sources.find((s: any) => s.type === 'local');

    const effectiveWorkspaceRoot = workspaceRoot || (settings as any).context.workspaceRoot || settings.workspaceRoot;

    if (enabled && effectiveWorkspaceRoot) {
      if (existingLocalSource) {
        // Update existing local source
        existingLocalSource.enabled = true;
        existingLocalSource.scope = existingLocalSource.scope || {};
        existingLocalSource.scope.path = effectiveWorkspaceRoot;
      } else {
        // Create new local source
        sources.push({
          id: `local-${Date.now()}`,
          type: 'local',
          enabled: true,
          scope: {
            path: effectiveWorkspaceRoot,
            includeFileTree: true,
            includeFileContents: true,
          },
        });
      }
    } else if (!enabled && existingLocalSource) {
      // Disable local source when context is disabled
      existingLocalSource.enabled = false;
    }

    saveSettings(settings);
    logger.info('settings', 'Workspace context settings updated', { enabled, workspaceRoot });
    return { success: true };
  });

  // Get context options
  handle('settings:getContextOptions', async () => {
    const settings = getSettings();
    const contextSettings = (settings as any).context || {};
    return {
      includeFileTree: contextSettings.includeFileTree ?? true,
      includeFileContents: contextSettings.includeFileContents ?? true,
      excludes: contextSettings.excludes || [],
    };
  });

  // Set context options
  handle('settings:setContextOptions', async (_event, options: { includeFileTree?: boolean; includeFileContents?: boolean; excludes?: string[] }) => {
    const settings = getSettings();
    if (!(settings as any).context) {
      (settings as any).context = {
        enabled: false,
        includeFileTree: true,
        includeFileContents: true,
        excludes: [],
      };
    }
    
    if (options.includeFileTree !== undefined) {
      (settings as any).context.includeFileTree = options.includeFileTree;
    }
    if (options.includeFileContents !== undefined) {
      (settings as any).context.includeFileContents = options.includeFileContents;
    }
    if (options.excludes !== undefined) {
      (settings as any).context.excludes = options.excludes;
    }
    
    saveSettings(settings);
    return { success: true };
  });

  // Get context preview (file count and size estimate) - Enhanced for unified context
  handle('settings:getContextPreview', async (_event, workspaceRoot?: string) => {
    try {
      // Use exactly the same settings-derived loader as actual analysis.
      const unifiedContext = await loadUnifiedContext({ workspaceRoot });
      // Process unified context
      const fileCount = unifiedContext.files.length;
      const totalSize = unifiedContext.stats.totalSize;
      const topFiles = unifiedContext.files.slice(0, 10).map(f => ({
        path: f.path,
        size: f.size || 0,
      }));

      // Scan for secrets
      const scanResult = scanForSecrets(unifiedContext.files);

      return {
        success: true,
        fileCount,
        totalSize,
        topFiles,
        treeEntryCount: unifiedContext.tree.length,
        sources: unifiedContext.stats.sources,
        secrets: scanResult,
      };
    } catch (error) {
      logger.error('settings', 'Failed to get context preview', error instanceof Error ? error : undefined);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Open logs folder
  handle('settings:openLogsFolder', async () => {
    try {
      let logsPath: string;
      if (process.platform === 'darwin') {
        logsPath = path.join(process.env.HOME || '', 'Library', 'Logs', 'ScreenshotAI');
      } else if (process.platform === 'win32') {
        logsPath = path.join(process.env.APPDATA || '', 'ScreenshotAI', 'logs');
      } else {
        logsPath = path.join(process.env.HOME || '', '.local', 'share', 'ScreenshotAI', 'logs');
      }
      
      // Ensure logs directory exists
      if (!fs.existsSync(logsPath)) {
        fs.mkdirSync(logsPath, { recursive: true });
      }
      
      await shell.openPath(logsPath);
      logger.info('settings', 'Logs folder opened', { path: logsPath });
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to open logs folder', error instanceof Error ? error : undefined);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Reset all settings
  handle('settings:resetAllSettings', async () => {
    try {
      // Delete API keys
      await deleteApiKey('openai');
      await deleteApiKey('anthropic');
      
      // Delete settings file
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(settingsPath)) {
        fs.unlinkSync(settingsPath);
      }
      
      // Delete prompt file
      const promptPath = path.join(app.getPath('userData'), 'custom-prompt.txt');
      if (fs.existsSync(promptPath)) {
        fs.unlinkSync(promptPath);
      }
      
      logger.info('settings', 'All settings reset');
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to reset all settings', error instanceof Error ? error : undefined);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // Repository Authentication (GitHub/GitLab)
  // ============================================================================

  // Connect repository provider (store token)
  handle('settings:connectRepoProvider', async (_event, provider: 'github' | 'gitlab', token: string, username?: string) => {
    try {
      // Validate token first
      const validation = await validateRepoToken(provider, token);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || 'Token validation failed',
        };
      }
      
      // Store token
      await storeRepoToken(provider, token, username || validation.username);
      
      logger.info('settings', 'Repository provider connected', { provider, username: username || validation.username });
      return {
        success: true,
        username: validation.username,
        scopes: validation.scopes,
      };
    } catch (error) {
      logger.error('settings', 'Failed to connect repository provider', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Test repository token
  handle('settings:testRepoToken', async (_event, provider: 'github' | 'gitlab', token: string) => {
    try {
      const result = await testRepoToken(provider, token);
      
      return result;
    } catch (error) {
      logger.error('settings', 'Failed to test repository token', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Get repository authentication status
  handle('settings:getRepoAuthStatus', async (_event, provider: 'github' | 'gitlab', username?: string) => {
    try {
      const status = await getAuthStatus(provider, username);
      
      return status;
    } catch (error) {
      logger.error('settings', 'Failed to get repository auth status', error instanceof Error ? error : undefined);
      return {
        authenticated: false,
      };
    }
  });

  // Disconnect repository provider (delete token)
  handle('settings:disconnectRepoProvider', async (_event, provider: 'github' | 'gitlab', username?: string) => {
    try {
      const deleted = await deleteRepoToken(provider, username);
      if (deleted) {
        for (const source of listSources().filter(source => source.type === provider)) invalidateCache(source);
      }
      
      logger.info('settings', 'Repository provider disconnected', { provider, username, deleted });
      return { success: deleted };
    } catch (error) {
      logger.error('settings', 'Failed to disconnect repository provider', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Start OAuth device flow
  handle('settings:startOAuthFlow', async (_event, provider: 'github' | 'gitlab') => {
    try {
      if (provider === 'github') {
        const deviceCode = await startGitHubDeviceFlow();
        return {
          success: true,
          deviceCode: deviceCode.device_code,
          userCode: deviceCode.user_code,
          verificationUri: deviceCode.verification_uri,
          verificationUriComplete: deviceCode.verification_uri_complete,
          expiresIn: deviceCode.expires_in,
          interval: deviceCode.interval,
        };
      } else if (provider === 'gitlab') {
        const deviceCode = await startGitLabDeviceFlow();
        return {
          success: true,
          deviceCode: deviceCode.device_code,
          userCode: deviceCode.user_code,
          verificationUri: deviceCode.verification_uri,
          verificationUriComplete: deviceCode.verification_uri_complete,
          expiresIn: deviceCode.expires_in,
          interval: deviceCode.interval,
        };
      }
      
      return {
        success: false,
        error: `Unsupported provider: ${provider}`,
      };
    } catch (error) {
      logger.error('settings', 'Failed to start OAuth flow', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Poll for OAuth token
  handle('settings:pollOAuthToken', async (_event, provider: 'github' | 'gitlab', deviceCode: string, interval: number) => {
    try {
      if (provider === 'github') {
        const tokenResponse = await pollGitHubToken(deviceCode, interval);
        return {
          success: true,
          accessToken: tokenResponse.access_token,
          tokenType: tokenResponse.token_type,
          scope: tokenResponse.scope,
        };
      } else if (provider === 'gitlab') {
        const tokenResponse = await pollGitLabToken(deviceCode, interval);
        return {
          success: true,
          accessToken: tokenResponse.access_token,
          tokenType: tokenResponse.token_type,
          scope: tokenResponse.scope,
        };
      }
      
      return {
        success: false,
        error: `Unsupported provider: ${provider}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Map error messages to error codes
      let errorCode: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | 'network' | 'unknown' = 'unknown';
      if (errorMessage.includes('expired')) {
        errorCode = 'expired_token';
      } else if (errorMessage.includes('denied')) {
        errorCode = 'access_denied';
      } else if (errorMessage.includes('timeout')) {
        errorCode = 'network';
      }
      
      logger.error('settings', 'Failed to poll OAuth token', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: errorMessage,
        errorCode,
      };
    }
  });

  // ============================================================================
  // Context Sources Management
  // ============================================================================

  // List context sources
  handle('settings:listContextSources', async () => {
    try {
      const sources = listSources();
      return sources;
    } catch (error) {
      logger.error('settings', 'Failed to list context sources', error instanceof Error ? error : undefined);
      return [];
    }
  });

  // Add context source
  handle('settings:addContextSource', async (_event, source: Omit<ContextSource, 'id'>) => {
    try {
      const result = addSource(source);
      return result;
    } catch (error) {
      const repoError = wrapRepoError(error, {
        provider: source.type === 'github' ? 'github' : source.type === 'gitlab' ? 'gitlab' : undefined,
        operation: 'addContextSource',
      });
      logger.error('settings', 'Failed to add context source', undefined, formatRepoErrorForLog(repoError));
      return {
        success: false,
        error: repoError.userMessage,
        errorCode: repoError.code,
        actionHint: repoError.actionHint,
      };
    }
  });

  // Update context source
  handle('settings:updateContextSource', async (_event, sourceId: string, updates: Partial<{ enabled: boolean; scope?: any; authRef?: string }>) => {
    try {
      const result = updateSource(sourceId, updates);
      return result;
    } catch (error) {
      logger.error('settings', 'Failed to update context source', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Remove context source
  handle('settings:removeContextSource', async (_event, sourceId: string) => {
    try {
      const result = removeSource(sourceId);
      return result;
    } catch (error) {
      logger.error('settings', 'Failed to remove context source', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Open folder picker dialog for workspace root selection
  handle('settings:pickWorkspaceFolder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Workspace Folder',
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      const selectedPath = result.filePaths[0];
      
      // Validate that the selected path exists and is a directory
      try {
        const stats = fs.statSync(selectedPath);
        if (!stats.isDirectory()) {
          return { success: false, error: 'Selected path is not a directory' };
        }
      } catch {
        return { success: false, error: 'Invalid directory path' };
      }

      // Update settings with selected folder - update both legacy and new schema fields
      const settings = getSettings();

      // Update legacy fields for backward compatibility
      settings.workspaceContextEnabled = true; // Auto-enable when folder is selected
      settings.workspaceRoot = selectedPath;

      // Update new schema fields
      if (!(settings as any).context) {
        (settings as any).context = {
          enabled: false,
          includeFileTree: true,
          includeFileContents: true,
          excludes: [],
          sources: [],
        };
      }
      (settings as any).context.enabled = true;
      (settings as any).context.workspaceRoot = selectedPath;

      // Ensure a local source exists for this workspace
      if (!(settings as any).context.sources) {
        (settings as any).context.sources = [];
      }
      const sources = (settings as any).context.sources as any[];
      const existingLocalSource = sources.find((s: any) => s.type === 'local');
      if (existingLocalSource) {
        // Update existing local source
        existingLocalSource.enabled = true;
        existingLocalSource.scope = existingLocalSource.scope || {};
        existingLocalSource.scope.path = selectedPath;
      } else {
        // Create new local source
        sources.push({
          id: `local-${Date.now()}`,
          type: 'local',
          enabled: true,
          scope: {
            path: selectedPath,
            includeFileTree: true,
            includeFileContents: true,
          },
        });
      }

      saveSettings(settings);

      logger.info('settings', 'Workspace folder selected', { workspaceRoot: selectedPath });
      return { success: true, workspaceRoot: selectedPath };
    } catch (error) {
      logger.error('settings', 'Failed to pick workspace folder', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pick workspace folder',
      };
    }
  });
}

// ============================================================================
// Prompt File Helpers
// ============================================================================

const PROMPT_FILE = 'custom-prompt.txt';

function getPromptPath(): string {
  return path.join(app.getPath('userData'), PROMPT_FILE);
}

function loadPromptText(): string {
  try {
    const promptPath = getPromptPath();
    if (!fs.existsSync(promptPath)) return '';
    return fs.readFileSync(promptPath, 'utf8');
  } catch {
    return '';
  }
}

function savePromptText(text: string): void {
  const promptPath = getPromptPath();
  const dir = path.dirname(promptPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(promptPath, text, 'utf8');
}

function deletePromptText(): void {
  const promptPath = getPromptPath();
  if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath);
}
