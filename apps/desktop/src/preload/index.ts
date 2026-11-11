/**
 * Preload Bridge - Secure IPC for Renderer
 * Implements contextBridge pattern for secure communication
 */

import { contextBridge, ipcRenderer } from "electron";
import type { AIResponse, ScreenshotAnalysis } from "@shared-types/ai-response";

// ============================================================================
// Type-safe API Interface
// ============================================================================

export type FeedbackReason = 'too-verbose' | 'incorrect' | 'missing-context' | 'wrong-format' | 'other';

export interface FeedbackDetails {
  reason?: FeedbackReason;
  /** Free text, at most 500 characters. Never logged by the main process. */
  comment?: string;
}

export interface AnalysisProcessingPayload {
  stage: 'capture' | 'analyzing' | 'cancelled';
  /** Present on 'analyzing'. */
  provider?: 'openai' | 'anthropic';
  /** Effective model (the provider default when none is set). Present on 'analyzing'. */
  model?: string;
}

export interface AnalysisErrorPayload {
  /** Core AIErrorCode (incl. AUTH_ERROR, CANCELLED), CAPTURE_ERROR, or PRIVACY_BLOCKED (nothing was sent). */
  code: string;
  message: string;
  retryable: boolean;
  metadata?: unknown;
  /** What was sent besides the image; null when nothing was sent. */
  sent?: { contextFiles: number; customPrompt: boolean } | null;
}

/** Agent access (MCP server mode) status, mirrored from apps/desktop/src/main/mcp.ts. */
export interface McpStatus {
  enabled: boolean;
  forcedByEnv: boolean;
  running: boolean;
  url: string | null;
  port: number;
  connectionFile: string;
  error: string | null;
}

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
    onProcessing: (callback: (payload: AnalysisProcessingPayload) => void) => void;
    onScreenshot: (callback: (payload: { dataUrl: string }) => void) => void;
    onResult: (callback: (response: AIResponse<ScreenshotAnalysis>) => void) => void;
    onError: (callback: (payload: AnalysisErrorPayload) => void) => void;
    retry: () => void;
    /** Abort the in-flight analysis. No-op while idle or during region selection. */
    cancel: () => void;
    /** @deprecated Use feedback.submit. Kept for the positive-only call shape. */
    submitFeedback: (positive: boolean) => Promise<void>;
  };
  feedback: {
    submit: (positive: boolean, details?: FeedbackDetails) => Promise<void>;
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
    // Agent access (MCP server mode)
    getMcpStatus: () => Promise<McpStatus>;
    setMcpEnabled: (enabled: boolean) => Promise<McpStatus>;
    copyMcpSetupCommand: () => Promise<{ success: boolean; error?: string }>;
    resetMcpToken: () => Promise<McpStatus>;
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

/** Build the feedback:submit payload with only the known keys, so callers cannot smuggle extra fields. */
function submitFeedback(positive: boolean, details?: FeedbackDetails): Promise<void> {
  const payload: { positive: boolean; reason?: FeedbackReason; comment?: string } = { positive };
  if (details?.reason !== undefined) payload.reason = details.reason;
  if (details?.comment !== undefined) payload.comment = details.comment;
  return ipcRenderer.invoke("feedback:submit", payload) as Promise<void>;
}

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
    cancel: () => {
      ipcRenderer.send("analysis:cancel");
    },
    submitFeedback: (positive) => submitFeedback(positive),
  },
  feedback: {
    submit: (positive, details) => submitFeedback(positive, details),
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
    getMcpStatus: () => ipcRenderer.invoke("settings:getMcpStatus"),
    setMcpEnabled: (enabled) => ipcRenderer.invoke("settings:setMcpEnabled", enabled),
    copyMcpSetupCommand: () => ipcRenderer.invoke("settings:copyMcpSetupCommand"),
    resetMcpToken: () => ipcRenderer.invoke("settings:resetMcpToken"),
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
