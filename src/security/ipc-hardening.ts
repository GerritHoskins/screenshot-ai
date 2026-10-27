/**
 * IPC Hardening - Workstream F
 * Security rules and utilities for Electron IPC.
 */
import { resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';

/** Only the application's own top-level documents may use the preload bridge. */
export function isTrustedRendererUrl(url: string, rendererDirectory: string, pages = ['index.html', 'settings.html'], devUrl = process.env.ELECTRON_RENDERER_URL): boolean {
  try {
    const candidate = new URL(url);
    if (candidate.username || candidate.password) return false;
    if (devUrl) {
      const development = new URL(devUrl);
      return candidate.origin === development.origin && pages.some(page =>
        candidate.pathname === new URL(page, `${development.href.replace(/\/$/, '')}/`).pathname ||
        (page === 'index.html' && candidate.pathname === development.pathname));
    }
    return candidate.protocol === 'file:' && !candidate.host && pages.some(page =>
      resolve(fileURLToPath(candidate)) === resolve(rendererDirectory, page));
  } catch {
    return false;
  }
}

export function isTrustedIpcSender(event: IpcMainEvent | IpcMainInvokeEvent, rendererDirectory: string, pages?: string[], owner?: BrowserWindow): boolean {
  return !event.sender.isDestroyed() && (!owner || event.sender === owner.webContents) &&
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame &&
    isTrustedRendererUrl(event.senderFrame.url, rendererDirectory, pages);
}

export function hardenWindow(window: BrowserWindow, rendererDirectory: string, pages?: string[]): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererDirectory, pages)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererDirectory, pages)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).every(key => !['__proto__', 'constructor', 'prototype'].includes(key));
}
function text(value: unknown, maximum = 4096): value is string {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\0');
}
function optionalText(value: unknown): boolean { return value === undefined || text(value); }
function patterns(value: unknown): boolean { return Array.isArray(value) && value.length <= 200 && value.every(entry => text(entry, 512)); }
function contextOptions(value: unknown): boolean {
  return record(value) && Object.entries(value).every(([key, entry]) =>
    key === 'excludes' ? patterns(entry) : ['includeFileTree', 'includeFileContents'].includes(key) && typeof entry === 'boolean');
}
function source(value: unknown, partial = false): boolean {
  if (!record(value)) return false;
  if (!partial && (!['local', 'github', 'gitlab'].includes(String(value.type)) || typeof value.enabled !== 'boolean')) return false;
  return Object.entries(value).every(([key, entry]) => {
    if (key === 'enabled') return typeof entry === 'boolean';
    if (key === 'type') return !partial && ['local', 'github', 'gitlab'].includes(String(entry));
    if (key === 'authRef') return optionalText(entry);
    if (key !== 'scope' || !record(entry)) return false;
    return Object.entries(entry).every(([name, data]) => {
      if (['includeFileTree', 'includeFileContents'].includes(name)) return typeof data === 'boolean';
      if (name === 'excludes') return patterns(data);
      return ['path', 'provider', 'owner', 'repo', 'defaultBranch', 'pathScope'].includes(name) && text(data);
    });
  });
}

/** Runtime validation for the actual desktop bridge, separate from legacy channels. */
export function validateDesktopIpcArgs(channel: string, args: unknown[]): boolean {
  const provider = (value: unknown) => value === 'openai' || value === 'anthropic';
  const repoProvider = (value: unknown) => value === 'github' || value === 'gitlab';
  const noArgs = ['capture:start', 'analysis:retry', 'settings:getPromptStatus', 'settings:getPromptText', 'settings:clearPrompt', 'settings:getWorkspaceContext', 'settings:getContextOptions', 'settings:openLogsFolder', 'settings:resetAllSettings', 'settings:listContextSources', 'settings:pickWorkspaceFolder'];
  if (noArgs.includes(channel)) return args.length === 0;
  if (['settings:getApiKeyStatus', 'settings:deleteApiKey', 'settings:getApiKeyTestStatus'].includes(channel)) return args.length === 1 && provider(args[0]);
  if (['settings:storeApiKey', 'settings:validateApiKey', 'settings:testApiKey'].includes(channel)) return args.length === 2 && provider(args[0]) && text(args[1], 8192);
  if (channel === 'settings:get') return args.length <= 1 && optionalText(args[0]) && !['__proto__', 'constructor', 'prototype'].includes(String(args[0]));
  if (channel === 'settings:set') {
    const [key, value] = args;
    if (args.length !== 2) return false;
    if (key === 'provider') return provider(value);
    if (key === 'model') return text(value, 200) && value.length > 0;
    if (['promptEnabled', 'workspaceContextEnabled'].includes(String(key))) return typeof value === 'boolean';
    if (key === 'workspaceRoot') return text(value);
    if (key === 'maxTokens') return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 32768;
    if (key === 'temperature') return typeof value === 'number' && value >= 0 && value <= 2;
    return key === 'timeout' && Number.isInteger(value) && Number(value) > 0 && Number(value) <= 300000;
  }
  if (channel === 'settings:importPrompt') return args.length === 1 && text(args[0], 1000000);
  if (channel === 'settings:setPromptEnabled') return args.length === 1 && typeof args[0] === 'boolean';
  if (channel === 'settings:setWorkspaceContext') return args.length <= 2 && typeof args[0] === 'boolean' && optionalText(args[1]);
  if (channel === 'settings:setContextOptions') return args.length === 1 && contextOptions(args[0]);
  if (channel === 'settings:getContextPreview') return args.length <= 1 && optionalText(args[0]);
  if (channel === 'settings:connectRepoProvider') return args.length <= 3 && repoProvider(args[0]) && text(args[1], 8192) && optionalText(args[2]);
  if (channel === 'settings:testRepoToken') return args.length === 2 && repoProvider(args[0]) && text(args[1], 8192);
  if (['settings:getRepoAuthStatus', 'settings:disconnectRepoProvider'].includes(channel)) return args.length <= 2 && repoProvider(args[0]) && optionalText(args[1]);
  if (channel === 'settings:startOAuthFlow') return args.length === 1 && repoProvider(args[0]);
  if (channel === 'settings:pollOAuthToken') return args.length === 3 && repoProvider(args[0]) && text(args[1]) && Number.isInteger(args[2]) && Number(args[2]) >= 1 && Number(args[2]) <= 60;
  if (channel === 'settings:addContextSource') return args.length === 1 && source(args[0]);
  if (channel === 'settings:updateContextSource') return args.length === 2 && text(args[0]) && source(args[1], true);
  if (channel === 'settings:removeContextSource') return args.length === 1 && text(args[0]);
  if (channel === 'feedback:submit') return args.length === 1 && record(args[0]) && typeof args[0].positive === 'boolean' && Object.keys(args[0]).length === 1;
  if (channel === 'file:saveText') {
    const value = args[0];
    if (args.length !== 1 || !record(value) || !text(value.content, 10000000)) return false;
    if (value.defaultFileName !== undefined && (!text(value.defaultFileName, 255) || basename(value.defaultFileName) !== value.defaultFileName || /[/\\:]/.test(value.defaultFileName))) return false;
    return value.filters === undefined || (Array.isArray(value.filters) && value.filters.length <= 10 && value.filters.every(filter =>
      record(filter) && text(filter.name, 100) && Array.isArray(filter.extensions) && filter.extensions.length <= 10 && filter.extensions.every(extension => typeof extension === 'string' && /^[a-zA-Z0-9]+$/.test(extension))));
  }
  return false;
}

export function isValidSelectionRect(value: unknown): value is { x: number; y: number; w: number; h: number } {
  return record(value) && ['x', 'y', 'w', 'h'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0) && Object.keys(value).length === 4;
}

// ============================================================================
// IPC Channel Whitelist
// ============================================================================

/**
 * Allowed IPC channels for main -> renderer communication.
 */
export const ALLOWED_MAIN_TO_RENDERER_CHANNELS = [
  'capture:started',
  'capture:completed',
  'capture:cancelled',
  'capture:error',
  'ai:processing',
  'ai:result',
  'ai:error',
  'settings:updated',
] as const;

/**
 * Allowed IPC channels for renderer -> main communication.
 */
export const ALLOWED_RENDERER_TO_MAIN_CHANNELS = [
  'capture:request',
  'capture:cancel',
  'ai:retry',
  'result:copy',
  'feedback:submit',
  'settings:get',
  'settings:set',
  'apikey:store',
  'apikey:delete',
  'apikey:validate',
] as const;

export type MainToRendererChannel = typeof ALLOWED_MAIN_TO_RENDERER_CHANNELS[number];
export type RendererToMainChannel = typeof ALLOWED_RENDERER_TO_MAIN_CHANNELS[number];

// ============================================================================
// Channel Validation
// ============================================================================

/**
 * Check if a channel is allowed for main -> renderer.
 */
export function isValidMainToRendererChannel(channel: string): channel is MainToRendererChannel {
  return (ALLOWED_MAIN_TO_RENDERER_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Check if a channel is allowed for renderer -> main.
 */
export function isValidRendererToMainChannel(channel: string): channel is RendererToMainChannel {
  return (ALLOWED_RENDERER_TO_MAIN_CHANNELS as readonly string[]).includes(channel);
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * IPC message payload validators.
 */
export const IPC_VALIDATORS: Record<RendererToMainChannel, (payload: unknown) => boolean> = {
  'capture:request': () => true, // No payload expected
  'capture:cancel': () => true,  // No payload expected
  'ai:retry': () => true,        // No payload expected
  'result:copy': (payload) => typeof payload === 'string',
  'feedback:submit': (payload) => {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return typeof p.positive === 'boolean';
  },
  'settings:get': (payload) => typeof payload === 'string',
  'settings:set': (payload) => {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return typeof p.key === 'string' && p.value !== undefined;
  },
  'apikey:store': (payload) => {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return (
      (p.provider === 'openai' || p.provider === 'anthropic') &&
      typeof p.apiKey === 'string'
    );
  },
  'apikey:delete': (payload) => payload === 'openai' || payload === 'anthropic',
  'apikey:validate': (payload) => {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return (
      (p.provider === 'openai' || p.provider === 'anthropic') &&
      typeof p.apiKey === 'string'
    );
  },
};

/**
 * Validate an IPC message payload.
 */
export function validateIpcPayload(channel: RendererToMainChannel, payload: unknown): boolean {
  const validator = IPC_VALIDATORS[channel];
  if (!validator) {
    return false;
  }
  return validator(payload);
}

// ============================================================================
// BrowserWindow Security Config
// ============================================================================

/**
 * Recommended webPreferences for secure BrowserWindow.
 */
export const SECURE_WEB_PREFERENCES = {
  // Required: Isolate preload script context from renderer
  contextIsolation: true,
  
  // Required: Disable Node.js in renderer
  nodeIntegration: false,
  
  // Recommended: Enable sandbox for additional isolation
  sandbox: true,
  
  // Recommended: Disable remote module (deprecated but may still be enabled)
  enableRemoteModule: false,
  
  // Recommended: Disable webview tag
  webviewTag: false,
  
  // Navigation restrictions
  navigateOnDragDrop: false,
} as const;

/**
 * Content Security Policy for renderer.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// ============================================================================
// Security Audit
// ============================================================================

export interface SecurityAuditResult {
  passed: boolean;
  issues: string[];
  recommendations: string[];
}

/**
 * Audit webPreferences for security issues.
 */
export function auditWebPreferences(
  webPreferences: Record<string, unknown>
): SecurityAuditResult {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Critical checks
  if (webPreferences.contextIsolation !== true) {
    issues.push('contextIsolation must be true');
  }
  if (webPreferences.nodeIntegration === true) {
    issues.push('nodeIntegration must be false');
  }

  // Recommended checks
  if (webPreferences.sandbox !== true) {
    recommendations.push('Consider enabling sandbox for additional isolation');
  }
  if (webPreferences.webviewTag === true) {
    recommendations.push('Consider disabling webviewTag if not needed');
  }
  if (!webPreferences.preload) {
    recommendations.push('Use a preload script with contextBridge');
  }

  return {
    passed: issues.length === 0,
    issues,
    recommendations,
  };
}
