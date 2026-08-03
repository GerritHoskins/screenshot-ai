/**
 * Settings Unit Tests - Phase 8
 * Tests settings migrations, validation, and store operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  migrateSettings,
  validateSettings,
  DEFAULT_SETTINGS,
  type SettingsSchema,
} from '../../src/settings/schema';
import * as store from '../../src/settings/store';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-user-data'),
  },
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock logger
vi.mock('../../src/logging', () => ({
  getLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  })),
}));

describe('Settings Migrations', () => {
  it('should migrate legacy settings to versioned format', () => {
    const legacy = {
      provider: 'openai',
      model: 'gpt-4o',
      workspaceContextEnabled: true,
      workspaceRoot: '/path/to/workspace',
      promptEnabled: true,
    };

    const migrated = migrateSettings(legacy);

    expect(migrated.version).toBe(DEFAULT_SETTINGS.version);
    expect(migrated.provider.selectedProvider).toBe('openai');
    expect(migrated.provider.selectedModel).toBe('gpt-4o');
    expect(migrated.context.enabled).toBe(true);
    expect(migrated.context.workspaceRoot).toBe('/path/to/workspace');
    expect(migrated.prompt.useCustom).toBe(true);
  });

  it('should handle empty legacy settings', () => {
    const migrated = migrateSettings({});
    
    expect(migrated.version).toBe(DEFAULT_SETTINGS.version);
    expect(migrated.provider.selectedProvider).toBe('openai');
    expect(migrated.context.enabled).toBe(false);
  });

  it('should preserve versioned settings', () => {
    const versioned: SettingsSchema = {
      ...DEFAULT_SETTINGS,
      provider: {
        selectedProvider: 'anthropic',
        selectedModel: 'claude-sonnet-4-5-20250929',
      },
    };

    const migrated = migrateSettings(versioned);
    
    expect(migrated.version).toBe(DEFAULT_SETTINGS.version);
    expect(migrated.provider.selectedProvider).toBe('anthropic');
    expect(migrated.provider.selectedModel).toBe('claude-sonnet-4-5-20250929');
  });

  it('should return defaults for unknown version', () => {
    const unknown = {
      version: 999,
      provider: { selectedProvider: 'openai' },
    };

    const migrated = migrateSettings(unknown);
    
    expect(migrated).toEqual(DEFAULT_SETTINGS);
  });
});

describe('Settings Validation', () => {
  it('should validate correct settings', () => {
    const valid: Partial<SettingsSchema> = {
      provider: {
        selectedProvider: 'openai',
        selectedModel: 'gpt-5.2',
      },
      context: {
        enabled: true,
        workspaceRoot: '/path/to/workspace',
        includeFileTree: true,
        includeFileContents: false,
        excludes: ['.env', 'node_modules'],
      },
    };

    const result = validateSettings(valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should reject invalid provider', () => {
    const invalid: Partial<SettingsSchema> = {
      provider: {
        selectedProvider: 'invalid' as any,
      },
    };

    const result = validateSettings(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid provider selected');
  });

  it('should validate context enabled boolean', () => {
    const invalid: Partial<SettingsSchema> = {
      context: {
        enabled: 'true' as any,
        includeFileTree: true,
        includeFileContents: true,
        excludes: [],
      },
    };

    const result = validateSettings(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Context enabled must be boolean');
  });

  it('should validate prompt useCustom boolean', () => {
    const invalid: Partial<SettingsSchema> = {
      prompt: {
        useCustom: 'yes' as any,
      },
    };

    const result = validateSettings(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Prompt useCustom must be boolean');
  });
});

describe('Settings Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return defaults when settings file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    const settings = store.getSettings();
    
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('should load and migrate settings from file', () => {
    const legacySettings = JSON.stringify({
      provider: 'openai',
      model: 'gpt-4o',
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(legacySettings);
    
    const settings = store.getSettings();
    
    expect(settings.version).toBe(DEFAULT_SETTINGS.version);
    expect(settings.provider.selectedProvider).toBe('openai');
  });

  it('should update settings and validate', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(DEFAULT_SETTINGS));
    
    const result = store.updateSettings({
      provider: {
        selectedProvider: 'anthropic',
        selectedModel: 'claude-sonnet-4-5-20250929',
      },
    });
    
    expect(result.valid).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should reject invalid settings updates', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(DEFAULT_SETTINGS));
    
    const result = store.updateSettings({
      provider: {
        selectedProvider: 'invalid' as any,
      },
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should reset section to defaults', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      ...DEFAULT_SETTINGS,
      context: {
        enabled: true,
        workspaceRoot: '/custom/path',
        includeFileTree: false,
        includeFileContents: false,
        excludes: ['custom'],
      },
    }));
    
    const result = store.resetSection('context');
    
    expect(result.valid).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should get specific setting', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      ...DEFAULT_SETTINGS,
      provider: {
        selectedProvider: 'anthropic',
        selectedModel: 'claude-sonnet-4-5-20250929',
      },
    }));
    
    const provider = store.getSetting('provider');
    
    expect(provider.selectedProvider).toBe('anthropic');
  });

  it('should set specific setting', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(DEFAULT_SETTINGS));
    
    const result = store.setSetting('provider', {
      selectedProvider: 'openai',
      selectedModel: 'gpt-5.2',
    });
    
    expect(result.valid).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});
