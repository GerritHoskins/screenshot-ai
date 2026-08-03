/**
 * Settings Management - Workstream E
 * Handles API key storage, provider selection, and settings persistence.
 */

import { ipcMain, app, dialog, shell } from 'electron';
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
import { getAnalysisService } from './analysis';
import { createProvider } from '@providers';
import { loadWorkspaceContext } from '@context/workspace';
import { loadRelevantFiles } from '@context/file-loader';
import { loadUnifiedContext } from '@context/unified-loader';
import { scanForSecrets } from '@context/secret-scanner';
import { listSources, addSource, updateSource, removeSource } from '@context/sources';
import { wrapRepoError, formatRepoErrorForLog } from '@context/repo-errors';
import { storeRepoToken, validateRepoToken, testRepoToken, getAuthStatus, deleteRepoToken } from '@security/repo-auth';
import { startGitHubDeviceFlow, startGitLabDeviceFlow, pollGitHubToken, pollGitLabToken } from '@security/oauth';

const logger = getLogger();

// ============================================================================
// Settings Storage
// ============================================================================

// Settings version - increment when schema changes
const SETTINGS_VERSION = 2;

interface AppSettings {
  version?: number;
  provider: 'openai' | 'anthropic';
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  promptEnabled?: boolean;
  workspaceContextEnabled?: boolean;
  workspaceRoot?: string;
  context?: {
    enabled: boolean;
    workspaceRoot?: string;
    includeFileTree: boolean;
    includeFileContents: boolean;
    excludes: string[];
    sources?: any[];
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
      return JSON.parse(content);
    }
  } catch (error) {
    logger.error('settings', 'Failed to load settings', error instanceof Error ? error : undefined);
  }
  
  return {
    provider: 'openai',
    promptEnabled: false,
    workspaceContextEnabled: false, // Disabled until user selects a folder
  };
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
    // Ensure version is set
    settings.version = SETTINGS_VERSION;
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
export function registerSettingsHandlers(): void {
  // Get API key status
  ipcMain.handle('settings:getApiKeyStatus', async (_event, provider: ProviderKey) => {
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
  ipcMain.handle('settings:storeApiKey', async (_event, provider: ProviderKey, apiKey: string) => {
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
  ipcMain.handle('settings:deleteApiKey', async (_event, provider: ProviderKey) => {
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
  ipcMain.handle('settings:validateApiKey', async (_event, provider: ProviderKey, apiKey: string) => {
    return { valid: validateApiKeyFormat(provider, apiKey) };
  });

  // Get current settings
  ipcMain.handle('settings:get', async (_event, key?: string) => {
    if (key === '_path') {
      // Return settings file path for diagnostics
      return path.join(app.getPath('userData'), 'settings.json');
    }
    const settings = getSettings();
    return key ? settings[key as keyof AppSettings] : settings;
  });

  // Set settings
  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    const settings = getSettings();
    (settings as Record<string, unknown>)[key] = value;
    saveSettings(settings);
    
    logger.info('settings', 'Setting updated', { key, value });
    return { success: true };
  });

  // Custom prompt status
  ipcMain.handle('settings:getPromptStatus', async () => {
    const settings = getSettings();
    const promptText = loadPromptText();
    return { enabled: settings.promptEnabled ?? false, length: promptText.length };
  });

  // Get prompt text
  ipcMain.handle('settings:getPromptText', async () => {
    const promptText = loadPromptText();
    return { text: promptText };
  });

  // Import prompt text
  ipcMain.handle('settings:importPrompt', async (_event, text: string) => {
    try {
      if (!text || !text.trim()) return { success: false, error: 'Prompt is empty' };
      savePromptText(text);
      const settings = getSettings();
      settings.promptEnabled = true;
      saveSettings(settings);
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to import prompt', error instanceof Error ? error : undefined);
      return { success: false, error: 'Failed to import prompt' };
    }
  });

  // Clear prompt
  ipcMain.handle('settings:clearPrompt', async () => {
    try {
      deletePromptText();
      const settings = getSettings();
      settings.promptEnabled = false;
      saveSettings(settings);
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to clear prompt', error instanceof Error ? error : undefined);
      return { success: false, error: 'Failed to clear prompt' };
    }
  });

  // Enable or disable prompt
  ipcMain.handle('settings:setPromptEnabled', async (_event, enabled: boolean) => {
    const settings = getSettings();
    settings.promptEnabled = !!enabled;
    saveSettings(settings);
    return { success: true };
  });

  // Test API key (make a simple request)
  ipcMain.handle('settings:testApiKey', async (_event, provider: ProviderKey, apiKey: string) => {
    const startTime = Date.now();
    let testStatus: 'success' | 'failure' = 'failure';
    let testError: string | undefined;
    let latency: number | undefined;

    try {
      // Trim whitespace
      const trimmedKey = apiKey.trim();
      
      // Validate format first
      if (!validateApiKeyFormat(provider, trimmedKey)) {
        testError = 'Invalid API key format';
        await saveTestStatus(provider, startTime, 'failure', undefined, testError);
        return { success: false, error: testError, errorCode: 'invalid_key' as const };
      }

      // Temporarily store key and test
      const originalKey = await getApiKey(provider);
      await storeApiKey(provider, trimmedKey);

      try {
        // Create provider instance with the test key
        const testProvider = createProvider(provider, {
          model: provider === 'openai' ? 'gpt-5.2' : 'claude-sonnet-4-5-20250929',
          maxTokens: 10,
          temperature: 0.1,
          timeout: 5000, // Short timeout for test
          maxRetries: 0, // No retries for test
          retryBaseDelay: 1000,
          retryMaxDelay: 5000,
          apiKey: trimmedKey,
        } as any);

        // Validate config format
        const isValidFormat = await testProvider.validateConfig();
        if (!isValidFormat) {
          // Restore original key
          if (originalKey) {
            await storeApiKey(provider, originalKey);
          } else {
            await deleteApiKey(provider);
          }
          testError = 'Invalid API key format';
          await saveTestStatus(provider, startTime, 'failure', undefined, testError);
          return { success: false, error: testError, errorCode: 'invalid_key' as const };
        }

        // Make a minimal test request
        const testPrompt = 'Respond with only the word "test"';
        try {
          const testResponse = await Promise.race([
            testProvider.complete<{ text: string }>(testPrompt),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 10000)
            ),
          ]);
          
          latency = Date.now() - startTime;
          
          // Restore original key
          if (originalKey) {
            await storeApiKey(provider, originalKey);
          } else {
            await deleteApiKey(provider);
          }

          // Check for auth errors
          if (testResponse.error?.code === 'AUTH_ERROR') {
            testError = 'Invalid API key - authentication failed';
            await saveTestStatus(provider, startTime, 'failure', latency, testError);
            return { success: false, error: testError, errorCode: 'invalid_key', latency };
          }
          
          // Check for rate limit errors
          if (testResponse.error?.code === 'RATE_LIMIT') {
            testError = 'Rate limit exceeded - please try again later';
            await saveTestStatus(provider, startTime, 'failure', latency, testError);
            return { success: false, error: testError, errorCode: 'rate_limited', latency };
          }
          
          testStatus = 'success';
          await saveTestStatus(provider, startTime, 'success', latency);
          return { success: true, latency };
        } catch (testError_) {
          latency = Date.now() - startTime;
          // Restore original key on error
          if (originalKey) {
            await storeApiKey(provider, originalKey);
          } else {
            await deleteApiKey(provider);
          }
          
          // Standardize error codes
          const errorMessage = testError_ instanceof Error ? testError_.message : 'API key test failed';
          let errorCode: 'invalid_key' | 'rate_limited' | 'network' | 'timeout' | 'unknown' = 'unknown';
          
          if (errorMessage.includes('timeout') || errorMessage === 'timeout') {
            testError = 'Connection timeout - check your internet connection';
            errorCode = 'timeout';
          } else if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
            testError = 'Network error - check your internet connection';
            errorCode = 'network';
          } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
            testError = 'Invalid API key - authentication failed';
            errorCode = 'invalid_key';
          } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
            testError = 'Rate limit exceeded - please try again later';
            errorCode = 'rate_limited';
          } else {
            testError = errorMessage;
            errorCode = 'unknown';
          }
          
          await saveTestStatus(provider, startTime, 'failure', latency, testError);
          return { success: false, error: testError, errorCode, latency };
        }
      } catch (error) {
        latency = Date.now() - startTime;
        // Restore original key on error
        if (originalKey) {
          await storeApiKey(provider, originalKey);
        } else {
          await deleteApiKey(provider);
        }
        
        // Standardize error codes
        const errorMessage = error instanceof Error ? error.message : 'API key test failed';
        let errorCode: 'invalid_key' | 'rate_limited' | 'network' | 'timeout' | 'unknown' = 'unknown';
        
        if (errorMessage.includes('timeout')) {
          testError = 'Connection timeout - check your internet connection';
          errorCode = 'timeout';
        } else if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
          testError = 'Network error - check your internet connection';
          errorCode = 'network';
        } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
          testError = 'Invalid API key - authentication failed';
          errorCode = 'invalid_key';
        } else {
          testError = errorMessage;
          errorCode = 'unknown';
        }
        
        logger.error('settings', 'API key test failed', error instanceof Error ? error : undefined);
        await saveTestStatus(provider, startTime, 'failure', latency, testError);
        return {
          success: false,
          error: testError,
          errorCode,
          latency,
        };
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'API key test failed';
      let errorCode: 'invalid_key' | 'rate_limited' | 'network' | 'timeout' | 'unknown' = 'unknown';
      
      if (errorMessage.includes('timeout')) {
        testError = 'Connection timeout - check your internet connection';
        errorCode = 'timeout';
      } else if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
        testError = 'Network error - check your internet connection';
        errorCode = 'network';
      } else {
        testError = errorMessage;
        errorCode = 'unknown';
      }
      
      logger.error('settings', 'API key test failed', error instanceof Error ? error : undefined);
      await saveTestStatus(provider, startTime, 'failure', latency, testError);
      return {
        success: false,
        error: testError,
        errorCode,
        latency,
      };
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
  ipcMain.handle('settings:getApiKeyTestStatus', async (_event, provider: ProviderKey) => {
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
  ipcMain.handle('settings:getWorkspaceContext', async () => {
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
  ipcMain.handle('settings:setWorkspaceContext', async (_event, enabled: boolean, workspaceRoot?: string) => {
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
  ipcMain.handle('settings:getContextOptions', async () => {
    const settings = getSettings();
    const contextSettings = (settings as any).context || {};
    return {
      includeFileTree: contextSettings.includeFileTree ?? true,
      includeFileContents: contextSettings.includeFileContents ?? true,
      excludes: contextSettings.excludes || [],
    };
  });

  // Set context options
  ipcMain.handle('settings:setContextOptions', async (_event, options: { includeFileTree?: boolean; includeFileContents?: boolean; excludes?: string[] }) => {
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
  ipcMain.handle('settings:getContextPreview', async (_event, workspaceRoot?: string) => {
    try {
      const settings = getSettings();
      const contextSettings = (settings as any).context || {};
      const excludes = contextSettings.excludes || [];
      
      // Convert exclude strings to RegExp patterns
      const excludePatterns = excludes.map((pattern: string) => {
        try {
          // Convert glob-like patterns to regex
          const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
          return new RegExp(regexPattern, 'i');
        } catch {
          return new RegExp(pattern, 'i');
        }
      });

      // Try unified context first (supports multiple sources)
      let unifiedContext;
      try {
        unifiedContext = await loadUnifiedContext({
          includeFileTree: contextSettings.includeFileTree !== false,
          includeFileContents: contextSettings.includeFileContents !== false,
          maxFiles: 50,
          maxFileSize: 50 * 1024,
          maxTotalSize: 200 * 1024,
          excludePatterns,
        });
      } catch (error) {
        logger.debug('settings', 'Unified context not available, falling back to local', { error });
        unifiedContext = null;
      }

      // Fallback to legacy local workspace if unified context is empty
      if (!unifiedContext || unifiedContext.files.length === 0) {
        if (workspaceRoot && fs.existsSync(workspaceRoot)) {
          const workspaceContext = await loadWorkspaceContext(workspaceRoot);
          if (workspaceContext) {
            const loadedFiles = loadRelevantFiles(workspaceContext, {
              maxFiles: 50,
              maxFileSize: 50 * 1024,
              maxTotalSize: 200 * 1024,
              excludePatterns,
            });

            const fileCount = loadedFiles.length;
            const totalSize = loadedFiles.reduce((sum, file) => sum + (file.size || 0), 0);
            const topFiles = loadedFiles.slice(0, 10).map(f => ({
              path: f.path,
              size: f.size || 0,
            }));

            // Scan for secrets
            const scanResult = scanForSecrets(loadedFiles);

            return {
              success: true,
              fileCount,
              totalSize,
              topFiles,
              treeEntryCount: workspaceContext.fileTree.length,
              sources: [{ type: 'local', fileCount, size: totalSize }],
              secrets: scanResult,
            };
          }
        }
        return { success: false, error: 'No context sources available' };
      }

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
  ipcMain.handle('settings:openLogsFolder', async () => {
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
  ipcMain.handle('settings:resetAllSettings', async () => {
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
  ipcMain.handle('settings:connectRepoProvider', async (_event, provider: 'github' | 'gitlab', token: string, username?: string) => {
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
  ipcMain.handle('settings:testRepoToken', async (_event, provider: 'github' | 'gitlab', token: string) => {
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
  ipcMain.handle('settings:getRepoAuthStatus', async (_event, provider: 'github' | 'gitlab', username?: string) => {
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
  ipcMain.handle('settings:disconnectRepoProvider', async (_event, provider: 'github' | 'gitlab', username?: string) => {
    try {
      const deleted = await deleteRepoToken(provider, username);
      
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
  ipcMain.handle('settings:startOAuthFlow', async (_event, provider: 'github' | 'gitlab') => {
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
  ipcMain.handle('settings:pollOAuthToken', async (_event, provider: 'github' | 'gitlab', deviceCode: string, interval: number) => {
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
  ipcMain.handle('settings:listContextSources', async () => {
    try {
      const sources = listSources();
      return sources;
    } catch (error) {
      logger.error('settings', 'Failed to list context sources', error instanceof Error ? error : undefined);
      return [];
    }
  });

  // Add context source
  ipcMain.handle('settings:addContextSource', async (_event, source: { type: string; enabled: boolean; scope?: any; authRef?: string }) => {
    try {
      const result = addSource(source);
      return result;
    } catch (error) {
      const repoError = wrapRepoError(error, {
        provider: source.type === 'github' ? 'github' : source.type === 'gitlab' ? 'gitlab' : undefined,
        operation: 'addContextSource',
      });
      logger.error('settings', 'Failed to add context source', formatRepoErrorForLog(repoError));
      return {
        success: false,
        error: repoError.userMessage,
        errorCode: repoError.code,
        actionHint: repoError.actionHint,
      };
    }
  });

  // Update context source
  ipcMain.handle('settings:updateContextSource', async (_event, sourceId: string, updates: Partial<{ enabled: boolean; scope?: any; authRef?: string }>) => {
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
  ipcMain.handle('settings:removeContextSource', async (_event, sourceId: string) => {
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
  ipcMain.handle('settings:pickWorkspaceFolder', async () => {
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
      } catch (error) {
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
