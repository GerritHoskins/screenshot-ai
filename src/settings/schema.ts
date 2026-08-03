/**
 * Settings Schema - Phase 0
 * Versioned settings schema with migration support
 */

// ============================================================================
// Settings Schema Version
// ============================================================================

export const SETTINGS_VERSION = 2; // Incremented for GitHub/GitLab support

// ============================================================================
// Settings Schema Types
// ============================================================================

export interface SettingsSchema {
  version: number;
  provider: {
    selectedProvider: 'openai' | 'anthropic';
    selectedModel?: string;
  };
  credentials: {
    openai?: {
      apiKeyStored: boolean; // Flag indicating key is stored in keychain
      lastTested?: number; // Timestamp
      lastTestStatus?: 'success' | 'failure';
      lastTestError?: string;
      lastTestLatency?: number;
    };
    anthropic?: {
      apiKeyStored: boolean;
      lastTested?: number;
      lastTestStatus?: 'success' | 'failure';
      lastTestError?: string;
      lastTestLatency?: number;
    };
  };
  context: {
    enabled: boolean;
    workspaceRoot?: string; // Legacy: kept for backward compatibility
    includeFileTree: boolean;
    includeFileContents: boolean;
    excludes: string[]; // Patterns to exclude
    sources?: ContextSource[]; // New: multiple context sources
    github?: {
      defaultOrg?: string;
      defaultUser?: string;
    };
    gitlab?: {
      defaultGroup?: string;
      defaultUser?: string;
    };
  };
  prompt: {
    useCustom: boolean;
    customText?: string;
  };
  advanced?: {
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
  };
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_SETTINGS: SettingsSchema = {
  version: SETTINGS_VERSION,
  provider: {
    selectedProvider: 'openai',
  },
  credentials: {},
  context: {
    enabled: false,
    includeFileTree: true,
    includeFileContents: true,
    excludes: [
      '.env',
      'node_modules',
      'dist',
      'build',
      'out',
      '.git',
      'secrets.*',
      '*.key',
      '*.pem',
      '*.p12',
    ],
    sources: [],
    github: {},
    gitlab: {},
  },
  prompt: {
    useCustom: false,
  },
};

// ============================================================================
// Settings Migration
// ============================================================================

/**
 * Migrate settings from old version to current version.
 */
export function migrateSettings(data: any): SettingsSchema {
  // If no version, assume it's the old format
  if (!data.version) {
    return migrateFromLegacy(data);
  }

  // Current version
  if (data.version === SETTINGS_VERSION) {
    return data as SettingsSchema;
  }

  // Migrate from version 1 to version 2 (add GitHub/GitLab support)
  if (data.version === 1) {
    return migrateFromV1ToV2(data);
  }

  // If unknown version, return defaults
  return DEFAULT_SETTINGS;
}

/**
 * Migrate from legacy settings format (pre-versioned).
 */
function migrateFromLegacy(data: any): SettingsSchema {
  // Preserve existing sources if present, otherwise create from legacy workspaceRoot
  let sources: ContextSource[] = [];

  // First, check if context.sources already exists (from newer code paths)
  if (data.context?.sources && Array.isArray(data.context.sources) && data.context.sources.length > 0) {
    sources = data.context.sources;
  }
  // Otherwise, create sources from legacy workspaceRoot or context.workspaceRoot
  else {
    const workspaceRoot = data.context?.workspaceRoot || data.workspaceRoot;
    const enabled = data.context?.enabled ?? data.workspaceContextEnabled ?? false;
    if (workspaceRoot) {
      sources.push({
        id: 'local-default',
        type: 'local',
        enabled,
        scope: {
          path: workspaceRoot,
          includeFileTree: true,
          includeFileContents: true,
          excludes: DEFAULT_SETTINGS.context.excludes,
        },
      });
    }
  }

  const migrated: SettingsSchema = {
    ...DEFAULT_SETTINGS,
    provider: {
      selectedProvider: typeof data.provider === 'string' ? data.provider : (data.provider?.selectedProvider || 'openai'),
      selectedModel: typeof data.provider === 'object' ? data.provider?.selectedModel : data.model,
    },
    context: {
      enabled: data.context?.enabled ?? data.workspaceContextEnabled ?? false,
      workspaceRoot: data.context?.workspaceRoot ?? data.workspaceRoot,
      includeFileTree: data.context?.includeFileTree ?? true,
      includeFileContents: data.context?.includeFileContents ?? true,
      excludes: data.context?.excludes ?? DEFAULT_SETTINGS.context.excludes,
      sources,
    },
    prompt: {
      useCustom: data.promptEnabled ?? data.prompt?.useCustom ?? false,
      customText: data.prompt?.customText,
    },
    advanced: {
      maxTokens: data.advanced?.maxTokens ?? data.maxTokens,
      temperature: data.advanced?.temperature ?? data.temperature,
      timeout: data.advanced?.timeout ?? data.timeout,
    },
  };

  return migrated;
}

/**
 * Migrate from version 1 to version 2 (add GitHub/GitLab support).
 */
function migrateFromV1ToV2(data: any): SettingsSchema {
  // Preserve existing sources if present, otherwise create from workspaceRoot
  let sources: ContextSource[] = [];

  if (data.context?.sources && Array.isArray(data.context.sources) && data.context.sources.length > 0) {
    sources = data.context.sources;
  } else if (data.context?.workspaceRoot) {
    sources = [
      {
        id: 'local-default',
        type: 'local' as const,
        enabled: data.context.enabled ?? false,
        scope: {
          path: data.context.workspaceRoot,
          includeFileTree: data.context.includeFileTree ?? true,
          includeFileContents: data.context.includeFileContents ?? true,
          excludes: data.context.excludes || DEFAULT_SETTINGS.context.excludes,
        },
      },
    ];
  }

  const migrated: SettingsSchema = {
    ...data,
    version: SETTINGS_VERSION,
    context: {
      ...data.context,
      sources,
      github: data.context?.github || {},
      gitlab: data.context?.gitlab || {},
    },
  };

  return migrated;
}

// ============================================================================
// Settings Validation
// ============================================================================

// ============================================================================
// Context Source Types
// ============================================================================

export type ContextSourceType = 'local' | 'github' | 'gitlab';

export interface ContextSource {
  id: string; // Unique identifier for this source
  type: ContextSourceType;
  enabled: boolean;
  scope?: ContextSourceScope;
  authRef?: string; // Reference to auth token in keychain (e.g., 'github:user:token')
}

export interface ContextSourceScope {
  // For local sources
  path?: string; // Local file system path
  
  // For GitHub/GitLab sources
  provider?: 'github' | 'gitlab';
  owner?: string; // GitHub org/user or GitLab group/user
  repo?: string; // Repository name
  defaultBranch?: string; // Default branch (e.g., 'main', 'master')
  pathScope?: string; // Subdirectory path within repo (optional)
  
  // Common options
  includeFileTree?: boolean;
  includeFileContents?: boolean;
  excludes?: string[]; // Patterns to exclude
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate settings schema.
 */
export function validateSettings(settings: Partial<SettingsSchema>): ValidationResult {
  const errors: string[] = [];

  if (settings.provider) {
    if (!['openai', 'anthropic'].includes(settings.provider.selectedProvider)) {
      errors.push('Invalid provider selected');
    }
  }

  if (settings.context) {
    if (typeof settings.context.enabled !== 'boolean') {
      errors.push('Context enabled must be boolean');
    }
    if (settings.context.enabled && !settings.context.workspaceRoot && !settings.context.sources?.length) {
      // This is OK - workspace root can be auto-detected or sources can be added later
    }
    
    // Validate sources if present
    if (settings.context.sources) {
      if (!Array.isArray(settings.context.sources)) {
        errors.push('Context sources must be an array');
      } else {
        settings.context.sources.forEach((source, index) => {
          if (!source.id) {
            errors.push(`Context source ${index} missing id`);
          }
          if (!['local', 'github', 'gitlab'].includes(source.type)) {
            errors.push(`Context source ${index} has invalid type: ${source.type}`);
          }
          if (typeof source.enabled !== 'boolean') {
            errors.push(`Context source ${index} enabled must be boolean`);
          }
          if (source.type === 'local' && !source.scope?.path) {
            errors.push(`Local context source ${index} missing path`);
          }
          if ((source.type === 'github' || source.type === 'gitlab') && (!source.scope?.owner || !source.scope?.repo)) {
            errors.push(`${source.type} context source ${index} missing owner or repo`);
          }
        });
      }
    }
  }

  if (settings.prompt) {
    if (typeof settings.prompt.useCustom !== 'boolean') {
      errors.push('Prompt useCustom must be boolean');
    }
    if (settings.prompt.useCustom && !settings.prompt.customText) {
      // This is OK - custom text might be loaded from file
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}
