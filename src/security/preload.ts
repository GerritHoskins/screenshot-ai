/**
 * Preload Bridge - Workstream F
 * Secure IPC bridge for renderer process.
 * 
 * This file should be used as the preload script in Electron.
 * It exposes a safe, typed API to the renderer via contextBridge.
 */

// Note: In actual Electron app, uncomment the imports below
// import { contextBridge, ipcRenderer } from 'electron';

import type { AIResponse, ScreenshotAnalysis } from '../types/ai-response';
import {
  isValidMainToRendererChannel,
  isValidRendererToMainChannel,
  MainToRendererChannel,
  RendererToMainChannel,
} from './ipc-hardening';

// ============================================================================
// Type Definitions for Exposed API
// ============================================================================

export interface CaptureAPI {
  /** Request a new screenshot capture */
  start: () => Promise<void>;
  /** Cancel ongoing capture */
  cancel: () => void;
  /** Listen for capture events */
  onStarted: (callback: () => void) => void;
  onCompleted: (callback: (imageData: string) => void) => void;
  onCancelled: (callback: () => void) => void;
  onError: (callback: (error: { code: string; message: string }) => void) => void;
}

export interface AIAPI {
  /** Retry the last AI request */
  retry: () => Promise<void>;
  /** Listen for AI processing events */
  onProcessing: (callback: () => void) => void;
  onResult: (callback: (result: AIResponse<ScreenshotAnalysis>) => void) => void;
  onError: (callback: (error: { code: string; message: string }) => void) => void;
}

export interface ResultAPI {
  /** Copy content to clipboard */
  copy: (content: string) => Promise<void>;
  /** Submit feedback */
  submitFeedback: (positive: boolean) => Promise<void>;
}

export interface SettingsAPI {
  /** Get a setting value */
  get: <T>(key: string) => Promise<T | null>;
  /** Set a setting value */
  set: <T>(key: string, value: T) => Promise<void>;
  /** Listen for settings updates */
  onUpdated: (callback: (settings: Record<string, unknown>) => void) => void;
}

export interface ApiKeyAPI {
  /** Store an API key */
  store: (provider: 'openai' | 'anthropic', apiKey: string) => Promise<void>;
  /** Delete an API key */
  delete: (provider: 'openai' | 'anthropic') => Promise<boolean>;
  /** Validate an API key format */
  validate: (provider: 'openai' | 'anthropic', apiKey: string) => Promise<boolean>;
}

export interface ExposedAPI {
  capture: CaptureAPI;
  ai: AIAPI;
  result: ResultAPI;
  settings: SettingsAPI;
  apiKey: ApiKeyAPI;
}

// ============================================================================
// Preload Implementation
// ============================================================================

/**
 * Create the preload bridge.
 * Call this in your preload script to expose the API.
 */
export function createPreloadBridge(
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => void },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    send: (channel: string, ...args: unknown[]) => void;
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
  }
): void {
  // Helper to safely invoke IPC
  const safeInvoke = async (channel: RendererToMainChannel, ...args: unknown[]): Promise<unknown> => {
    if (!isValidRendererToMainChannel(channel)) {
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  };

  // Helper to safely send IPC
  const safeSend = (channel: RendererToMainChannel, ...args: unknown[]): void => {
    if (!isValidRendererToMainChannel(channel)) {
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  };

  // Helper to safely listen for IPC
  const safeOn = (
    channel: MainToRendererChannel,
    callback: (...args: unknown[]) => void
  ): void => {
    if (!isValidMainToRendererChannel(channel)) {
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  };

  // Define the exposed API
  const api: ExposedAPI = {
    capture: {
      start: () => safeInvoke('capture:request') as Promise<void>,
      cancel: () => safeSend('capture:cancel'),
      onStarted: (cb) => safeOn('capture:started', cb),
      onCompleted: (cb) => safeOn('capture:completed', cb as (...args: unknown[]) => void),
      onCancelled: (cb) => safeOn('capture:cancelled', cb),
      onError: (cb) => safeOn('capture:error', cb as (...args: unknown[]) => void),
    },

    ai: {
      retry: () => safeInvoke('ai:retry') as Promise<void>,
      onProcessing: (cb) => safeOn('ai:processing', cb),
      onResult: (cb) => safeOn('ai:result', cb as (...args: unknown[]) => void),
      onError: (cb) => safeOn('ai:error', cb as (...args: unknown[]) => void),
    },

    result: {
      copy: (content) => safeInvoke('result:copy', content) as Promise<void>,
      submitFeedback: (positive) => safeInvoke('feedback:submit', { positive }) as Promise<void>,
    },

    settings: {
      get: <T>(key: string) => safeInvoke('settings:get', key) as Promise<T | null>,
      set: (key, value) => safeInvoke('settings:set', { key, value }) as Promise<void>,
      onUpdated: (cb) => safeOn('settings:updated', cb as (...args: unknown[]) => void),
    },

    apiKey: {
      store: (provider, apiKey) =>
        safeInvoke('apikey:store', { provider, apiKey }) as Promise<void>,
      delete: (provider) => safeInvoke('apikey:delete', provider) as Promise<boolean>,
      validate: (provider, apiKey) =>
        safeInvoke('apikey:validate', { provider, apiKey }) as Promise<boolean>,
    },
  };

  // Expose to renderer
  contextBridge.exposeInMainWorld('api', api);
}

// ============================================================================
// Type Declaration for Renderer
// ============================================================================

/**
 * Declare the global API type for renderer TypeScript files.
 * Add this to your renderer's global.d.ts:
 * 
 * declare global {
 *   interface Window {
 *     api: import('./security/preload').ExposedAPI;
 *   }
 * }
 */
