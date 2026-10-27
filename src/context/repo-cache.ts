/**
 * Repository Content Cache - Phase 3
 * Caches repository content with TTL and ETag support
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { app } from 'electron';
import { getLogger } from '@logging';
import type { ContextSource } from '@settings/schema';
import type { RepoContext, FetchOptions } from './repo-fetcher';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

interface CacheEntry {
  sourceId: string;
  context: RepoContext;
  etag?: string;
  cachedAt: number;
  expiresAt: number;
}

interface CacheMetadata {
  version: number;
  entries: Record<string, CacheEntry>;
}

const CACHE_VERSION = 2;
const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50 MB

// ============================================================================
// Cache File Management
// ============================================================================

function getCacheDir(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'repo-cache');
}

function getCacheFilePath(): string {
  return path.join(getCacheDir(), 'cache.json');
}

function ensureCacheDir(): void {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

function loadCache(): CacheMetadata {
  ensureCacheDir();
  const cachePath = getCacheFilePath();
  
  if (!fs.existsSync(cachePath)) {
    return {
      version: CACHE_VERSION,
      entries: {},
    };
  }

  try {
    const data = fs.readFileSync(cachePath, 'utf8');
    const metadata: CacheMetadata = JSON.parse(data);
    
    // Validate version
    if (metadata.version !== CACHE_VERSION) {
      logger.warn('repo-cache', 'Cache version mismatch, clearing cache');
      return {
        version: CACHE_VERSION,
        entries: {},
      };
    }

    // Clean expired entries
    const now = Date.now();
    const cleanedEntries: Record<string, CacheEntry> = {};
    
    for (const [key, entry] of Object.entries(metadata.entries)) {
      if (entry.expiresAt > now) {
        cleanedEntries[key] = entry;
      }
    }

    if (Object.keys(cleanedEntries).length !== Object.keys(metadata.entries).length) {
      logger.debug('repo-cache', 'Cleaned expired cache entries', {
        before: Object.keys(metadata.entries).length,
        after: Object.keys(cleanedEntries).length,
      });
    }

    return {
      version: CACHE_VERSION,
      entries: cleanedEntries,
    };
  } catch (error) {
    logger.error('repo-cache', 'Failed to load cache', error instanceof Error ? error : undefined);
    return {
      version: CACHE_VERSION,
      entries: {},
    };
  }
}

function saveCache(metadata: CacheMetadata): void {
  ensureCacheDir();
  const cachePath = getCacheFilePath();
  
  try {
    // Calculate cache size
    const cacheSize = JSON.stringify(metadata).length;
    
    // If cache is too large, remove oldest entries
    if (cacheSize > MAX_CACHE_SIZE) {
      const entries = Object.entries(metadata.entries);
      entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);
      
      // Remove oldest 25% of entries
      const removeCount = Math.floor(entries.length * 0.25);
      for (let i = 0; i < removeCount; i++) {
        delete metadata.entries[entries[i][0]];
      }
      
      logger.info('repo-cache', 'Cache size exceeded limit, removed oldest entries', {
        removed: removeCount,
        remaining: Object.keys(metadata.entries).length,
      });
    }

    fs.writeFileSync(cachePath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch (error) {
    logger.error('repo-cache', 'Failed to save cache', error instanceof Error ? error : undefined);
  }
}

// ============================================================================
// Cache API
// ============================================================================

/**
 * Get cache key for a source.
 */
export function getCacheKey(source: ContextSource, options: FetchOptions = {}): string {
  return createHash('sha256').update(JSON.stringify({
    source,
    options: { ...options, excludePatterns: options.excludePatterns?.map(pattern => pattern.toString()) },
  })).digest('hex');
}

/**
 * Get cached repository context.
 */
export function getCachedContext(source: ContextSource, ttl: number = DEFAULT_TTL, options: FetchOptions = {}): RepoContext | null {
  const metadata = loadCache();
  const key = getCacheKey(source, options);
  const entry = metadata.entries[key];

  if (!entry) {
    return null;
  }

  const now = Date.now();

  // Check if expired
  if (entry.expiresAt <= now || entry.cachedAt + ttl <= now) {
    logger.debug('repo-cache', 'Cache entry expired', { sourceId: source.id });
    delete metadata.entries[key];
    saveCache(metadata);
    return null;
  }

  logger.debug('repo-cache', 'Cache hit', {
    sourceId: source.id,
    age: now - entry.cachedAt,
    expiresIn: entry.expiresAt - now,
  });

  return entry.context;
}

/**
 * Store repository context in cache.
 */
export function setCachedContext(
  source: ContextSource,
  context: RepoContext,
  ttl: number = DEFAULT_TTL,
  etag?: string,
  options: FetchOptions = {}
): void {
  const metadata = loadCache();
  const key = getCacheKey(source, options);
  const now = Date.now();

  metadata.entries[key] = {
    sourceId: source.id,
    context,
    etag,
    cachedAt: now,
    expiresAt: now + ttl,
  };

  saveCache(metadata);

  logger.debug('repo-cache', 'Cache entry stored', {
    sourceId: source.id,
    ttl,
    expiresAt: metadata.entries[key].expiresAt,
  });
}

/**
 * Invalidate cache for a source.
 */
export function invalidateCache(source: ContextSource): void {
  const metadata = loadCache();
  const keys = Object.keys(metadata.entries).filter(key => metadata.entries[key].sourceId === source.id);
  if (keys.length) {
    for (const key of keys) delete metadata.entries[key];
    saveCache(metadata);
    logger.debug('repo-cache', 'Cache invalidated', { sourceId: source.id });
  }
}

/**
 * Clear all cache entries.
 */
export function clearCache(): void {
  const metadata: CacheMetadata = {
    version: CACHE_VERSION,
    entries: {},
  };
  saveCache(metadata);
  logger.info('repo-cache', 'Cache cleared');
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): {
  entryCount: number;
  totalSize: number;
  oldestEntry: number | null;
  newestEntry: number | null;
} {
  const metadata = loadCache();
  const entries = Object.values(metadata.entries);
  
  if (entries.length === 0) {
    return {
      entryCount: 0,
      totalSize: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }

  const cachedAts = entries.map(e => e.cachedAt);
  const totalSize = JSON.stringify(metadata).length;

  return {
    entryCount: entries.length,
    totalSize,
    oldestEntry: Math.min(...cachedAts),
    newestEntry: Math.max(...cachedAts),
  };
}
