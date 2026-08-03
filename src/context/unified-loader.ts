/**
 * Unified Context Loader - Phase 3
 * Loads context from multiple sources (local, GitHub, GitLab) with caching
 */

import { getLogger } from '@logging';
import { getEnabledSources } from './sources';
import { loadWorkspaceContext } from './workspace';
import { loadRelevantFiles, formatFilesAsContext, type LoadedFile } from './file-loader';
import { fetchRepoContext, type RepoContext } from './repo-fetcher';
import { getCachedContext, setCachedContext } from './repo-cache';
import { wrapRepoError, formatRepoErrorForLog, type RepoError } from './repo-errors';
import type { ContextSource } from '@settings/schema';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface UnifiedContext {
  files: LoadedFile[];
  tree: Array<{ path: string; type: 'file' | 'dir' }>;
  stats: {
    totalFiles: number;
    totalSize: number;
    sources: Array<{
      sourceId: string;
      type: string;
      fileCount: number;
      size: number;
    }>;
  };
}

export interface LoadOptions {
  includeFileTree?: boolean;
  includeFileContents?: boolean;
  maxFileSize?: number;
  maxTotalSize?: number;
  maxFiles?: number;
  excludePatterns?: RegExp[];
  cacheTTL?: number; // Cache TTL in milliseconds
}

const DEFAULT_OPTIONS: Required<LoadOptions> = {
  includeFileTree: true,
  includeFileContents: true,
  maxFileSize: 100 * 1024, // 100 KB per file
  maxTotalSize: 500 * 1024, // 500 KB total
  maxFiles: 10,
  excludePatterns: [],
  cacheTTL: 60 * 60 * 1000, // 1 hour
};

// ============================================================================
// Unified Context Loading
// ============================================================================

/**
 * Load context from all enabled sources.
 */
export async function loadUnifiedContext(options: Partial<LoadOptions> = {}): Promise<UnifiedContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sources = getEnabledSources();

  console.log('[UnifiedLoader] Enabled sources:', sources.length);
  sources.forEach((s, i) => {
    console.log(`[UnifiedLoader] Source ${i}:`, {
      id: s.id,
      type: s.type,
      enabled: s.enabled,
      scopePath: (s.scope as any)?.path,
    });
  });

  if (sources.length === 0) {
    logger.debug('unified-loader', 'No enabled sources found');
    console.log('[UnifiedLoader] No enabled sources, returning empty context');
    return {
      files: [],
      tree: [],
      stats: {
        totalFiles: 0,
        totalSize: 0,
        sources: [],
      },
    };
  }

  const allFiles: LoadedFile[] = [];
  const allTree: Array<{ path: string; type: 'file' | 'dir' }> = [];
  const sourceStats: Array<{ sourceId: string; type: string; fileCount: number; size: number }> = [];
  let totalSize = 0;
  let remainingFiles = opts.maxFiles;
  let remainingSize = opts.maxTotalSize;

  // Process each source
  for (const source of sources) {
    if (remainingFiles <= 0 || remainingSize <= 0) {
      logger.debug('unified-loader', 'Reached file/size limits, skipping remaining sources');
      break;
    }

    try {
      const sourceOptions = {
        includeFileTree: opts.includeFileTree,
        includeFileContents: opts.includeFileContents,
        maxFileSize: opts.maxFileSize,
        maxTotalSize: remainingSize,
        maxFiles: remainingFiles,
        excludePatterns: opts.excludePatterns,
      };

      let repoContext: RepoContext | null = null;

      if (source.type === 'local') {
        // Load from local filesystem
        repoContext = await loadLocalContext(source, sourceOptions);
      } else if (source.type === 'github' || source.type === 'gitlab') {
        // Load from GitHub/GitLab with caching
        repoContext = await loadRemoteContext(source, sourceOptions, opts.cacheTTL);
      }

      if (repoContext) {
        // Convert repo files to loaded files
        const loadedFiles: LoadedFile[] = repoContext.files.map(file => ({
          path: file.path,
          content: file.content,
          size: file.size,
          language: file.language,
          truncated: file.truncated,
        }));

        // Add tree entries
        const treeEntries = repoContext.tree.map(entry => ({
          path: entry.path,
          type: entry.type,
        }));

        // Add files and tree (respecting limits)
        const filesToAdd = loadedFiles.slice(0, remainingFiles);
        const treeToAdd = treeEntries.slice(0, remainingFiles * 2); // Allow more tree entries

        allFiles.push(...filesToAdd);
        allTree.push(...treeToAdd);

        const sourceSize = filesToAdd.reduce((sum, f) => sum + f.size, 0);
        totalSize += sourceSize;
        remainingFiles -= filesToAdd.length;
        remainingSize -= sourceSize;

        sourceStats.push({
          sourceId: source.id,
          type: source.type,
          fileCount: filesToAdd.length,
          size: sourceSize,
        });

        logger.info('unified-loader', 'Loaded context from source', {
          sourceId: source.id,
          type: source.type,
          fileCount: filesToAdd.length,
          treeCount: treeToAdd.length,
          size: sourceSize,
        });
      }
    } catch (error) {
      const repoError = error instanceof Error && 'code' in error ? error as RepoError : wrapRepoError(error, {
        provider: source.type === 'github' ? 'github' : source.type === 'gitlab' ? 'gitlab' : undefined,
        operation: 'loadContext',
      });
      logger.error('unified-loader', 'Failed to load context from source', {
        sourceId: source.id,
        type: source.type,
        ...formatRepoErrorForLog(repoError),
      });
      // Continue with other sources
    }
  }

  logger.info('unified-loader', 'Unified context loaded', {
    totalFiles: allFiles.length,
    totalSize,
    sourceCount: sourceStats.length,
  });

  return {
    files: allFiles,
    tree: allTree,
    stats: {
      totalFiles: allFiles.length,
      totalSize,
      sources: sourceStats,
    },
  };
}

/**
 * Load context from a local source.
 */
async function loadLocalContext(
  source: ContextSource,
  options: {
    includeFileTree?: boolean;
    includeFileContents?: boolean;
    maxFileSize?: number;
    maxTotalSize?: number;
    maxFiles?: number;
    excludePatterns?: RegExp[];
  }
): Promise<RepoContext | null> {
  const scope = source.scope as any;
  const workspaceRoot = scope?.path;

  if (!workspaceRoot) {
    logger.warn('unified-loader', 'Local source missing path', { sourceId: source.id });
    return null;
  }

  try {
    const workspaceContext = await loadWorkspaceContext(workspaceRoot);
    if (!workspaceContext) {
      return null;
    }

    const loadedFiles = loadRelevantFiles(workspaceContext, {
      maxFiles: options.maxFiles || 10,
      maxFileSize: options.maxFileSize || 100 * 1024,
      maxTotalSize: options.maxTotalSize || 500 * 1024,
      excludePatterns: options.excludePatterns,
    });

    const tree = options.includeFileTree ? workspaceContext.fileTree.map(entry => ({
      path: entry.path || '',
      type: entry.type,
      size: entry.size,
    })) : [];

    const files = loadedFiles.map(file => ({
      path: file.path,
      content: file.content,
      size: file.size,
      sha: undefined,
      language: file.language,
      truncated: file.truncated,
    }));

    return {
      files,
      tree,
      stats: {
        totalFiles: loadedFiles.length,
        totalSize: loadedFiles.reduce((sum, f) => sum + f.size, 0),
        branch: 'local',
        lastFetched: Date.now(),
      },
    };
  } catch (error) {
    logger.error('unified-loader', 'Failed to load local context', {
      sourceId: source.id,
      workspaceRoot,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Load context from a remote source (GitHub/GitLab) with caching.
 */
async function loadRemoteContext(
  source: ContextSource,
  options: {
    includeFileTree?: boolean;
    includeFileContents?: boolean;
    maxFileSize?: number;
    maxTotalSize?: number;
    maxFiles?: number;
    excludePatterns?: RegExp[];
  },
  cacheTTL: number
): Promise<RepoContext | null> {
  // Check cache first
  const cached = getCachedContext(source, cacheTTL);
  if (cached) {
    logger.debug('unified-loader', 'Using cached context', { sourceId: source.id });
    return cached;
  }

  // Fetch from remote
  try {
    const repoContext = await fetchRepoContext(source, options);
    
    // Store in cache
    setCachedContext(source, repoContext, cacheTTL);
    
    return repoContext;
  } catch (error) {
    logger.error('unified-loader', 'Failed to fetch remote context', {
      sourceId: source.id,
      type: source.type,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Format unified context as text for prompts.
 */
export function formatUnifiedContextAsText(context: UnifiedContext): string {
  if (context.files.length === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push('## Workspace Context\n');
  parts.push(`Loaded from ${context.stats.sources.length} source(s):\n`);

  for (const sourceStat of context.stats.sources) {
    parts.push(`- ${sourceStat.type}: ${sourceStat.fileCount} files (${formatSize(sourceStat.size)})\n`);
  }

  parts.push('\nThe following files are provided for context:\n');

  for (const file of context.files) {
    parts.push(`### ${file.path}`);
    if (file.language) {
      parts.push(`Language: ${file.language}`);
    }
    if (file.truncated) {
      parts.push(`(File truncated - original size: ${file.size} bytes)`);
    }
    parts.push('```' + (file.language || '') + '\n' + file.content + '\n```\n');
  }

  return parts.join('\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
