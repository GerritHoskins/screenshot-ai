/**
 * Settings Store - Phase 0
 * Centralized settings storage with versioning and migration
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getLogger } from '@logging';
import type { SettingsSchema, ValidationResult } from './schema';
import { DEFAULT_SETTINGS, migrateSettings, validateSettings } from './schema';

const logger = getLogger();

// ============================================================================
// Settings Store API
// ============================================================================

/**
 * Get settings file path.
 */
function getSettingsPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'settings.json');
}

/**
 * Get all settings.
 */
export function getSettings(): SettingsSchema {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      const raw = JSON.parse(content);
      const migrated = migrateSettings(raw);
      return migrated;
    }
  } catch (error) {
    logger.error('settings', 'Failed to load settings', error instanceof Error ? error : undefined);
  }
  
  return DEFAULT_SETTINGS;
}

/**
 * Update settings (partial update).
 */
export function updateSettings(partial: Partial<SettingsSchema>): ValidationResult {
  const current = getSettings();
  const updated = { ...current, ...partial };
  
  // Validate before saving
  const validation = validateSettings(updated);
  if (!validation.valid) {
    logger.warn('settings', 'Settings validation failed', { errors: validation.errors });
    return validation;
  }

  try {
    const settingsPath = getSettingsPath();
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Ensure version is set
    updated.version = DEFAULT_SETTINGS.version;
    
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf8');
    logger.info('settings', 'Settings updated', { version: updated.version });
    return { valid: true };
  } catch (error) {
    logger.error('settings', 'Failed to save settings', error instanceof Error ? error : undefined);
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Failed to save settings'],
    };
  }
}

/**
 * Reset a specific section of settings.
 */
export function resetSection(sectionId: keyof SettingsSchema): ValidationResult {
  const current = getSettings();
  const defaults = DEFAULT_SETTINGS;
  
  if (!(sectionId in defaults)) {
    return {
      valid: false,
      errors: [`Unknown section: ${sectionId}`],
    };
  }

  const updated = {
    ...current,
    [sectionId]: defaults[sectionId],
  };

  return updateSettings(updated);
}

/**
 * Get a specific setting value.
 */
export function getSetting<K extends keyof SettingsSchema>(
  key: K
): SettingsSchema[K] {
  const settings = getSettings();
  return settings[key];
}

/**
 * Set a specific setting value.
 */
export function setSetting<K extends keyof SettingsSchema>(
  key: K,
  value: SettingsSchema[K]
): ValidationResult {
  return updateSettings({ [key]: value } as Partial<SettingsSchema>);
}
