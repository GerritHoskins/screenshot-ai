/**
 * Context Sources API - Phase 0
 * Manages multiple context sources (local, GitHub, GitLab)
 */

import { getSettings, updateSettings } from '@settings/store';
import type { ContextSource, ContextSourceScope, ContextSourceType } from '@settings/schema';
import { getLogger } from '@logging';

const logger = getLogger();

// ============================================================================
// Context Sources API
// ============================================================================

/**
 * List all context sources.
 */
export function listSources(): ContextSource[] {
  const settings = getSettings();
  return settings.context.sources || [];
}

/**
 * Get a specific context source by ID.
 */
export function getSource(sourceId: string): ContextSource | null {
  const sources = listSources();
  return sources.find(s => s.id === sourceId) || null;
}

/**
 * Add a new context source.
 */
export function addSource(source: Omit<ContextSource, 'id'>): { success: boolean; sourceId?: string; error?: string } {
  try {
    const settings = getSettings();
    const sources = settings.context.sources || [];
    
    // Generate unique ID
    const sourceId = generateSourceId(source.type, source.scope);
    
    // Check for duplicates
    if (sources.some(s => s.id === sourceId)) {
      return { success: false, error: 'Source with this ID already exists' };
    }
    
    const newSource: ContextSource = {
      ...source,
      id: sourceId,
    };
    
    const updated = {
      ...settings,
      context: {
        ...settings.context,
        sources: [...sources, newSource],
      },
    };
    
    const result = updateSettings(updated);
    if (!result.valid) {
      return { success: false, error: result.errors?.join(', ') || 'Validation failed' };
    }
    
    logger.info('context-sources', 'Source added', { sourceId, type: source.type });
    return { success: true, sourceId };
  } catch (error) {
    logger.error('context-sources', 'Failed to add source', error instanceof Error ? error : undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Update an existing context source.
 */
export function updateSource(sourceId: string, updates: Partial<Omit<ContextSource, 'id'>>): { success: boolean; error?: string } {
  try {
    const settings = getSettings();
    const sources = settings.context.sources || [];
    
    const index = sources.findIndex(s => s.id === sourceId);
    if (index === -1) {
      return { success: false, error: 'Source not found' };
    }
    
    const updatedSources = [...sources];
    updatedSources[index] = {
      ...updatedSources[index],
      ...updates,
      id: sourceId, // Ensure ID doesn't change
    };
    
    const updated = {
      ...settings,
      context: {
        ...settings.context,
        sources: updatedSources,
      },
    };
    
    const result = updateSettings(updated);
    if (!result.valid) {
      return { success: false, error: result.errors?.join(', ') || 'Validation failed' };
    }
    
    logger.info('context-sources', 'Source updated', { sourceId });
    return { success: true };
  } catch (error) {
    logger.error('context-sources', 'Failed to update source', error instanceof Error ? error : undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Remove a context source.
 */
export function removeSource(sourceId: string): { success: boolean; error?: string } {
  try {
    const settings = getSettings();
    const sources = settings.context.sources || [];
    
    const filtered = sources.filter(s => s.id !== sourceId);
    if (filtered.length === sources.length) {
      return { success: false, error: 'Source not found' };
    }
    
    const updated = {
      ...settings,
      context: {
        ...settings.context,
        sources: filtered,
      },
    };
    
    const result = updateSettings(updated);
    if (!result.valid) {
      return { success: false, error: result.errors?.join(', ') || 'Validation failed' };
    }
    
    logger.info('context-sources', 'Source removed', { sourceId });
    return { success: true };
  } catch (error) {
    logger.error('context-sources', 'Failed to remove source', error instanceof Error ? error : undefined);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Enable or disable a context source.
 */
export function setSourceEnabled(sourceId: string, enabled: boolean): { success: boolean; error?: string } {
  return updateSource(sourceId, { enabled });
}

/**
 * Generate a unique source ID based on type and scope.
 */
function generateSourceId(type: ContextSourceType, scope?: ContextSourceScope): string {
  if (type === 'local' && scope?.path) {
    // For local sources, use a hash of the path
    return `local-${hashString(scope.path)}`;
  }
  
  if ((type === 'github' || type === 'gitlab') && scope?.owner && scope?.repo) {
    // For GitHub/GitLab, use provider-owner-repo format
    const branch = scope.defaultBranch || 'main';
    const pathScope = scope.pathScope ? `-${hashString(scope.pathScope)}` : '';
    return `${type}-${scope.owner}-${scope.repo}-${branch}${pathScope}`;
  }
  
  // Fallback: generate timestamp-based ID
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Simple string hash function.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get enabled sources only.
 */
export function getEnabledSources(): ContextSource[] {
  return listSources().filter(s => s.enabled);
}

/**
 * Get sources by type.
 */
export function getSourcesByType(type: ContextSourceType): ContextSource[] {
  return listSources().filter(s => s.type === type);
}
