/**
 * Preload Bridge - Secure IPC for Renderer
 * Implements contextBridge pattern for secure communication
 */

import { contextBridge, ipcRenderer } from "electron";
import type { AIResponse, ScreenshotAnalysis } from "@types/ai-response";

// ============================================================================
// Type-safe API Interface
// ============================================================================

export interface ExposedAPI {
  capture: {
    start: () => void;
  };
  files: {
    saveTextFile: (params: {
      content: string;
      defaultFileName?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<{ success: boolean; cancelled?: boolean; filePath?: string; error?: string }>;
  };
  analysis: {
    onProcessing: (callback: (payload: { stage: string; screenshotDataUrl?: string }) => void) => void;
    onScreenshot: (callback: (payload: { dataUrl: string }) => void) => void;
    onResult: (callback: (response: AIResponse<ScreenshotAnalysis>) => void) => void;
    onError: (callback: (payload: { code: string; message: string; retryable: boolean; metadata?: unknown }) => void) => void;
    retry: () => void;
    submitFeedback: (positive: boolean) => Promise<void>;
  };
  settings: {
    getApiKeyStatus: (provider: 'openai' | 'anthropic') => Promise<{ hasKey: boolean; masked: string | null }>;
    storeApiKey: (provider: 'openai' | 'anthropic', apiKey: string) => Promise<{ success: boolean; error?: string }>;
    deleteApiKey: (provider: 'openai' | 'anthropic') => Promise<{ success: boolean }>;
    validateApiKey: (provider: 'openai' | 'anthropic', apiKey: string) => Promise<{ valid: boolean }>;
    testApiKey: (provider: 'openai' | 'anthropic', apiKey: string) => Promise<{ 
      success: boolean; 
      error?: string; 
      errorCode?: 'invalid_key' | 'rate_limited' | 'network' | 'timeout' | 'unknown';
      latency?: number;
    }>;
    getPromptStatus: () => Promise<{ enabled: boolean; length: number }>;
    importPrompt: (text: string) => Promise<{ success: boolean; error?: string }>;
    clearPrompt: () => Promise<{ success: boolean; error?: string }>;
    setPromptEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
    getPromptText: () => Promise<{ text: string }>;
    get: (key?: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<{ success: boolean }>;
    getWorkspaceContext: () => Promise<{ 
      enabled: boolean; 
      workspaceRoot: string | null;
      includeFileTree?: boolean;
      includeFileContents?: boolean;
      excludes?: string[];
    }>;
    setWorkspaceContext: (enabled: boolean, workspaceRoot?: string) => Promise<{ success: boolean }>;
    getContextOptions: () => Promise<{ includeFileTree: boolean; includeFileContents: boolean; excludes: string[] }>;
    setContextOptions: (options: { includeFileTree?: boolean; includeFileContents?: boolean; excludes?: string[] }) => Promise<{ success: boolean }>;
    getContextPreview: (workspaceRoot?: string) => Promise<{ 
      success: boolean; 
      error?: string;
      fileCount?: number;
      totalSize?: number;
      topFiles?: Array<{ path: string; size: number }>;
      treeEntryCount?: number;
      sources?: Array<{ type: string; fileCount: number; size: number }>;
      secrets?: {
        matches: Array<{ file: string; line: number; pattern: string; severity: 'high' | 'medium' | 'low'; description: string; content: string }>;
        hasSecrets: boolean;
        riskLevel: 'high' | 'medium' | 'low' | 'none';
        summary: { high: number; medium: number; low: number };
      };
    }>;
    pickWorkspaceFolder: () => Promise<{ success: boolean; workspaceRoot?: string; cancelled?: boolean; error?: string }>;
    getApiKeyTestStatus: (provider: 'openai' | 'anthropic') => Promise<{ lastTested: number | null; lastTestStatus: string | null; lastTestLatency: number | null; lastTestError: string | null }>;
    openLogsFolder: () => Promise<{ success: boolean; error?: string }>;
    resetAllSettings: () => Promise<{ success: boolean; error?: string }>;
    // Repository authentication
    connectRepoProvider: (provider: 'github' | 'gitlab', token: string, username?: string) => Promise<{ 
      success: boolean; 
      username?: string; 
      scopes?: string[]; 
      error?: string;
    }>;
    testRepoToken: (provider: 'github' | 'gitlab', token: string) => Promise<{ 
      success: boolean; 
      username?: string; 
      scopes?: string[]; 
      error?: string;
    }>;
    getRepoAuthStatus: (provider: 'github' | 'gitlab', username?: string) => Promise<{ 
      authenticated: boolean; 
      username?: string; 
      tokenType?: 'pat' | 'oauth'; 
      scopes?: string[];
    }>;
    disconnectRepoProvider: (provider: 'github' | 'gitlab', username?: string) => Promise<{ success: boolean; error?: string }>;
    startOAuthFlow: (provider: 'github' | 'gitlab') => Promise<{ 
      success: boolean; 
      deviceCode?: string; 
      userCode?: string; 
      verificationUri?: string; 
      verificationUriComplete?: string; 
      expiresIn?: number; 
      interval?: number; 
      error?: string;
    }>;
    pollOAuthToken: (provider: 'github' | 'gitlab', deviceCode: string, interval: number) => Promise<{ 
      success: boolean; 
      accessToken?: string; 
      tokenType?: string; 
      scope?: string; 
      error?: string; 
      errorCode?: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | 'network' | 'unknown';
    }>;
    // Context sources
    listContextSources: () => Promise<Array<{ id: string; type: string; enabled: boolean; scope?: any; authRef?: string }>>;
    addContextSource: (source: { type: string; enabled: boolean; scope?: any; authRef?: string }) => Promise<{ success: boolean; sourceId?: string; error?: string; errorCode?: string; actionHint?: string }>;
    updateContextSource: (sourceId: string, updates: Partial<{ enabled: boolean; scope?: any; authRef?: string }>) => Promise<{ success: boolean; error?: string }>;
    removeContextSource: (sourceId: string) => Promise<{ success: boolean; error?: string }>;
  };
}

// ============================================================================
// Expose Secure API
// ============================================================================

const api: ExposedAPI = {
  capture: {
    start: () => {
      ipcRenderer.send("capture:start");
    },
  },
  files: {
    saveTextFile: (params) => ipcRenderer.invoke("file:saveText", params),
  },
  analysis: {
    onProcessing: (callback) => {
      ipcRenderer.on("analysis:processing", (_event, payload) => callback(payload));
    },
    onScreenshot: (callback) => {
      ipcRenderer.on("analysis:screenshot", (_event, payload) => callback(payload));
    },
    onResult: (callback) => {
      ipcRenderer.on("analysis:result", (_event, payload) => callback(payload));
    },
    onError: (callback) => {
      ipcRenderer.on("analysis:error", (_event, payload) => callback(payload));
    },
    retry: () => {
      ipcRenderer.send("analysis:retry");
    },
    submitFeedback: (positive) => {
      return ipcRenderer.invoke("feedback:submit", { positive }) as Promise<void>;
    },
  },
  settings: {
    getApiKeyStatus: (provider) => ipcRenderer.invoke("settings:getApiKeyStatus", provider),
    storeApiKey: (provider, apiKey) => ipcRenderer.invoke("settings:storeApiKey", provider, apiKey),
    deleteApiKey: (provider) => ipcRenderer.invoke("settings:deleteApiKey", provider),
    validateApiKey: (provider, apiKey) => ipcRenderer.invoke("settings:validateApiKey", provider, apiKey),
    testApiKey: (provider, apiKey) => ipcRenderer.invoke("settings:testApiKey", provider, apiKey),
    getPromptStatus: () => ipcRenderer.invoke("settings:getPromptStatus"),
    importPrompt: (text) => ipcRenderer.invoke("settings:importPrompt", text),
    clearPrompt: () => ipcRenderer.invoke("settings:clearPrompt"),
    setPromptEnabled: (enabled) => ipcRenderer.invoke("settings:setPromptEnabled", enabled),
    getPromptText: () => ipcRenderer.invoke("settings:getPromptText"),
    get: (key) => ipcRenderer.invoke("settings:get", key),
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value),
    getWorkspaceContext: () => ipcRenderer.invoke("settings:getWorkspaceContext"),
    setWorkspaceContext: (enabled, workspaceRoot) => ipcRenderer.invoke("settings:setWorkspaceContext", enabled, workspaceRoot),
    pickWorkspaceFolder: () => ipcRenderer.invoke("settings:pickWorkspaceFolder"),
    getContextOptions: () => ipcRenderer.invoke("settings:getContextOptions"),
    setContextOptions: (options) => ipcRenderer.invoke("settings:setContextOptions", options),
    getContextPreview: (workspaceRoot) => ipcRenderer.invoke("settings:getContextPreview", workspaceRoot),
    getApiKeyTestStatus: (provider) => ipcRenderer.invoke("settings:getApiKeyTestStatus", provider),
    openLogsFolder: () => ipcRenderer.invoke("settings:openLogsFolder"),
    resetAllSettings: () => ipcRenderer.invoke("settings:resetAllSettings"),
    connectRepoProvider: (provider, token, username) => ipcRenderer.invoke("settings:connectRepoProvider", provider, token, username),
    testRepoToken: (provider, token) => ipcRenderer.invoke("settings:testRepoToken", provider, token),
    getRepoAuthStatus: (provider, username) => ipcRenderer.invoke("settings:getRepoAuthStatus", provider, username),
    disconnectRepoProvider: (provider, username) => ipcRenderer.invoke("settings:disconnectRepoProvider", provider, username),
    startOAuthFlow: (provider) => ipcRenderer.invoke("settings:startOAuthFlow", provider),
    pollOAuthToken: (provider, deviceCode, interval) => ipcRenderer.invoke("settings:pollOAuthToken", provider, deviceCode, interval),
    listContextSources: () => ipcRenderer.invoke("settings:listContextSources"),
    addContextSource: (source) => ipcRenderer.invoke("settings:addContextSource", source),
    updateContextSource: (sourceId, updates) => ipcRenderer.invoke("settings:updateContextSource", sourceId, updates),
    removeContextSource: (sourceId) => ipcRenderer.invoke("settings:removeContextSource", sourceId),
  },
};

contextBridge.exposeInMainWorld("api", api);

// Type declaration for renderer
declare global {
  interface Window {
    api: ExposedAPI;
  }
}
