/**
 * Keychain Storage - Workstream F
 * Secure credential storage using OS keychain.
 */

// Note: In production, this would use 'keytar' package
// import * as keytar from 'keytar';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_NAME = 'screenshot-ai';

export type ProviderKey = 'openai' | 'anthropic';

// ============================================================================
// Keychain Interface
// ============================================================================

export interface KeychainService {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

// ============================================================================
// Default Keychain Implementation (using keytar)
// ============================================================================

/**
 * Create a keychain service using the keytar library.
 * In production, fails if keytar is not available (no fallback).
 * In development, falls back to mock for testing.
 */
export async function createKeychainService(): Promise<KeychainService> {
  const isProduction = process.env.NODE_ENV === 'production' || !process.env.DEV;
  
  try {
    // Use require for keytar - native modules work better with require in Electron
    // Dynamic import can fail with native modules that need to be rebuilt for Electron
    let keytar: any;
    
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      keytar = require('keytar');
    } catch (requireError) {
      // If require fails, try dynamic import as fallback
      try {
        const keytarModule = await import('keytar');
        keytar = keytarModule.default || keytarModule;
      } catch (importError) {
        throw new Error(
          `Failed to load keytar: require error: ${requireError instanceof Error ? requireError.message : String(requireError)}, ` +
          `import error: ${importError instanceof Error ? importError.message : String(importError)}`
        );
      }
    }
    
    // Verify keytar exports are available
    if (!keytar) {
      throw new Error('keytar module loaded but is null/undefined');
    }
    
    // Check for functions - they might be on default export or directly
    // Handle both CommonJS and ES module exports
    let setPassword: any;
    let getPassword: any;
    let deletePassword: any;
    let findCredentials: any;
    
    // Try direct access first (CommonJS)
    if (typeof keytar.setPassword === 'function') {
      setPassword = keytar.setPassword;
      getPassword = keytar.getPassword;
      deletePassword = keytar.deletePassword;
      findCredentials = keytar.findCredentials;
    } 
    // Try default export (ES modules)
    else if (keytar.default && typeof keytar.default.setPassword === 'function') {
      setPassword = keytar.default.setPassword;
      getPassword = keytar.default.getPassword;
      deletePassword = keytar.default.deletePassword;
      findCredentials = keytar.default.findCredentials;
    }
    // Try named exports (ES modules)
    else if (typeof (keytar as any).setPassword === 'function') {
      setPassword = (keytar as any).setPassword;
      getPassword = (keytar as any).getPassword;
      deletePassword = (keytar as any).deletePassword;
      findCredentials = (keytar as any).findCredentials;
    }
    
    if (!setPassword || !getPassword || !deletePassword || !findCredentials) {
      const availableKeys = Object.keys(keytar).join(', ');
      const keytarType = typeof keytar;
      const hasDefault = !!keytar.default;
      throw new Error(
        `keytar functions not found. Module type: ${keytarType}, has default: ${hasDefault}, ` +
        `available keys: ${availableKeys}. ` +
        `Try running: npm run rebuild`
      );
    }
    
    return {
      getPassword,
      setPassword,
      deletePassword,
      findCredentials,
    };
  } catch (error) {
    if (isProduction) {
      // In production, fail hard if keytar is unavailable
      throw new Error(
        'Keychain service unavailable. keytar module is required for secure API key storage. ' +
        'Please ensure keytar is properly installed and native dependencies are built for Electron. ' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    } else {
      // In development, allow mock fallback for testing
      console.warn('keytar not available, using in-memory storage (DEV ONLY - NOT SECURE)', error);
      return createMockKeychainService();
    }
  }
}

// ============================================================================
// Mock Keychain (for development/testing)
// ============================================================================

/**
 * In-memory keychain for development/testing only.
 * WARNING: Not secure - do not use in production.
 */
export function createMockKeychainService(): KeychainService {
  const store = new Map<string, Map<string, string>>();

  const getServiceStore = (service: string): Map<string, string> => {
    if (!store.has(service)) {
      store.set(service, new Map());
    }
    return store.get(service)!;
  };

  return {
    async getPassword(service: string, account: string): Promise<string | null> {
      return getServiceStore(service).get(account) ?? null;
    },

    async setPassword(service: string, account: string, password: string): Promise<void> {
      getServiceStore(service).set(account, password);
    },

    async deletePassword(service: string, account: string): Promise<boolean> {
      return getServiceStore(service).delete(account);
    },

    async findCredentials(service: string): Promise<Array<{ account: string; password: string }>> {
      const serviceStore = getServiceStore(service);
      return Array.from(serviceStore.entries()).map(([account, password]) => ({
        account,
        password,
      }));
    },
  };
}

// ============================================================================
// API Key Management
// ============================================================================

let keychainService: KeychainService | null = null;

/**
 * Get or initialize the keychain service.
 */
async function getKeychainService(): Promise<KeychainService> {
  if (!keychainService) {
    keychainService = await createKeychainService();
  }
  return keychainService;
}

/**
 * Store an API key in the keychain.
 */
export async function storeApiKey(provider: ProviderKey, apiKey: string): Promise<void> {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Invalid API key');
  }

  // Validate key format
  if (provider === 'openai' && !apiKey.startsWith('sk-')) {
    throw new Error('Invalid OpenAI API key format');
  }
  if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
    throw new Error('Invalid Anthropic API key format');
  }

  const keychain = await getKeychainService();
  
  // Verify keychain service is properly initialized
  if (!keychain || typeof keychain.setPassword !== 'function') {
    throw new Error('Keychain service is not properly initialized. Please restart the application.');
  }
  
  await keychain.setPassword(SERVICE_NAME, provider, apiKey);
}

/**
 * Retrieve an API key from the keychain.
 */
export async function getApiKey(provider: ProviderKey): Promise<string | null> {
  // Validate provider is a valid string
  if (!provider || typeof provider !== 'string') {
    console.error('[Keychain] Invalid provider:', provider);
    return null;
  }
  if (provider !== 'openai' && provider !== 'anthropic') {
    console.error('[Keychain] Unknown provider:', provider);
    return null;
  }

  const keychain = await getKeychainService();
  return keychain.getPassword(SERVICE_NAME, provider);
}

/**
 * Delete an API key from the keychain.
 */
export async function deleteApiKey(provider: ProviderKey): Promise<boolean> {
  const keychain = await getKeychainService();
  return keychain.deletePassword(SERVICE_NAME, provider);
}

/**
 * Check if an API key exists in the keychain.
 */
export async function hasApiKey(provider: ProviderKey): Promise<boolean> {
  const key = await getApiKey(provider);
  return key !== null;
}

/**
 * List all stored provider keys.
 */
export async function listStoredProviders(): Promise<ProviderKey[]> {
  const keychain = await getKeychainService();
  const credentials = await keychain.findCredentials(SERVICE_NAME);
  return credentials.map(c => c.account as ProviderKey);
}

// ============================================================================
// Key Validation
// ============================================================================

/**
 * Validate an API key format without storing it.
 */
export function validateApiKeyFormat(provider: ProviderKey, apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  switch (provider) {
    case 'openai':
      return apiKey.startsWith('sk-') && apiKey.length > 20;
    case 'anthropic':
      return apiKey.startsWith('sk-ant-') && apiKey.length > 50;
    default:
      return false;
  }
}

/**
 * Mask an API key for display (show first 7 and last 4 characters).
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length < 15) {
    return '***';
  }
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}
