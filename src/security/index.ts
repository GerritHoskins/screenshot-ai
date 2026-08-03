/**
 * Security Module Index - Workstream F
 * Exports all security-related functionality.
 */

// Keychain storage
export {
  storeApiKey,
  getApiKey,
  deleteApiKey,
  hasApiKey,
  listStoredProviders,
  validateApiKeyFormat,
  maskApiKey,
  createKeychainService,
  createMockKeychainService,
  type KeychainService,
  type ProviderKey,
} from './keychain';

// IPC hardening
export {
  ALLOWED_MAIN_TO_RENDERER_CHANNELS,
  ALLOWED_RENDERER_TO_MAIN_CHANNELS,
  isValidMainToRendererChannel,
  isValidRendererToMainChannel,
  validateIpcPayload,
  IPC_VALIDATORS,
  SECURE_WEB_PREFERENCES,
  CONTENT_SECURITY_POLICY,
  auditWebPreferences,
  type MainToRendererChannel,
  type RendererToMainChannel,
  type SecurityAuditResult,
} from './ipc-hardening';

// Preload bridge
export {
  createPreloadBridge,
  type ExposedAPI,
  type CaptureAPI,
  type AIAPI,
  type ResultAPI,
  type SettingsAPI,
  type ApiKeyAPI,
} from './preload';

// Redaction (to be implemented)
export { redactSensitiveData, REDACTION_RULES, type RedactionRule } from './redaction';

// Repository Authentication
export * from './repo-auth';

// OAuth Device Flow
export * from './oauth';
