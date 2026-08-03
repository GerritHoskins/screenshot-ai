/**
 * IPC Hardening - Workstream F
 * Security rules and utilities for Electron IPC.
 */

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
