/**
 * File Loader Module
 * Loads and processes relevant files from workspace for context
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '@logging';
import type { WorkspaceContext } from './workspace';

const logger = getLogger({ minLevel: 0 });

// ============================================================================
// Types
// ============================================================================

export interface LoadedFile {
  path: string;
  content: string;
  size: number;
  language?: string;
  truncated: boolean;
}

export interface FileLoadOptions {
  maxFileSize: number; // Max size per file in bytes
  maxTotalSize: number; // Max total size in bytes
  maxFiles: number;
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
}

const DEFAULT_OPTIONS: Required<FileLoadOptions> = {
  maxFileSize: 100 * 1024, // 100 KB per file
  maxTotalSize: 500 * 1024, // 500 KB total
  maxFiles: 10,
  includePatterns: [],
  excludePatterns: [],
};

// ============================================================================
// File Loading
// ============================================================================

/**
 * Detect programming language from file extension.
 */
function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.sql': 'sql',
    '.sh': 'bash',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.css': 'css',
    '.md': 'markdown',
  };
  return languageMap[ext];
}

/**
 * Check if a file should be included based on patterns.
 */
function shouldIncludeFile(
  filePath: string,
  includePatterns: RegExp[],
  excludePatterns: RegExp[]
): boolean {
  // If include patterns exist, file must match at least one
  if (includePatterns.length > 0) {
    const matchesInclude = includePatterns.some(pattern => pattern.test(filePath));
    if (!matchesInclude) return false;
  }

  // File must not match any exclude pattern
  if (excludePatterns.some(pattern => pattern.test(filePath))) {
    return false;
  }

  return true;
}

/**
 * Load a single file with size limits and truncation.
 */
function loadFile(
  workspaceRoot: string,
  filePath: string,
  maxSize: number
): LoadedFile | null {
  const fullPath = path.join(workspaceRoot, filePath);
  
  try {
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      return null;
    }

    // Check file size
    if (stats.size > maxSize * 2) {
      // File is too large, skip it
      logger.debug('context', 'File too large, skipping', { filePath, size: stats.size });
      return null;
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    const originalSize = content.length;
    let truncated = false;

    // Truncate if necessary
    if (content.length > maxSize) {
      // Try to truncate at a line boundary
      const truncatedContent = content.slice(0, maxSize);
      const lastNewline = truncatedContent.lastIndexOf('\n');
      if (lastNewline > maxSize * 0.8) {
        // Truncate at last newline if it's not too far back
        content = content.slice(0, lastNewline) + '\n... [truncated]';
      } else {
        // Otherwise truncate at maxSize
        content = content.slice(0, maxSize) + '... [truncated]';
      }
      truncated = true;
    }

    const language = detectLanguage(filePath);

    return {
      path: filePath,
      content,
      size: originalSize,
      language,
      truncated,
    };
  } catch (error) {
    logger.debug('context', 'Failed to load file', { filePath, error });
    return null;
  }
}

/**
 * Load relevant files from workspace context.
 */
export function loadRelevantFiles(
  workspaceContext: WorkspaceContext,
  options: Partial<FileLoadOptions> = {}
): LoadedFile[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const loadedFiles: LoadedFile[] = [];
  let totalSize = 0;

  // Default include patterns for common source/config files
  const defaultIncludePatterns: RegExp[] = [
    /\.(ts|tsx|js|jsx|py|java|go|rs|rb|php)$/,
    /\.(json|yaml|yml|toml)$/,
    /^(README|CHANGELOG|LICENSE)\.(md|txt)$/i,
  ];

  const includePatterns = opts.includePatterns.length > 0
    ? opts.includePatterns
    : defaultIncludePatterns;

  // Default exclude patterns
  const defaultExcludePatterns: RegExp[] = [
    /node_modules/,
    /\.git/,
    /dist/,
    /build/,
    /out/,
    /\.next/,
    /\.cache/,
    /coverage/,
    /\.log$/,
    /\.lock$/,
  ];

  const excludePatterns = [
    ...defaultExcludePatterns,
    ...opts.excludePatterns,
  ];

  // Prioritize files from relevantFiles list, then scan fileTree
  const filesToLoad = new Set<string>();

  // Add relevant files first
  for (const filePath of workspaceContext.relevantFiles) {
    if (shouldIncludeFile(filePath, includePatterns, excludePatterns)) {
      filesToLoad.add(filePath);
    }
  }

  // Add files from fileTree if we need more
  if (filesToLoad.size < opts.maxFiles) {
    for (const entry of workspaceContext.fileTree) {
      if (entry.type === 'file' && entry.path) {
        if (shouldIncludeFile(entry.path, includePatterns, excludePatterns)) {
          filesToLoad.add(entry.path);
          if (filesToLoad.size >= opts.maxFiles) break;
        }
      }
    }
  }

  // Load files
  for (const filePath of Array.from(filesToLoad).slice(0, opts.maxFiles)) {
    if (loadedFiles.length >= opts.maxFiles) break;
    if (totalSize >= opts.maxTotalSize) break;

    const loaded = loadFile(workspaceContext.info.root, filePath, opts.maxFileSize);
    if (loaded) {
      const newTotalSize = totalSize + loaded.size;
      if (newTotalSize > opts.maxTotalSize) {
        // Would exceed total size limit
        break;
      }

      loadedFiles.push(loaded);
      totalSize = newTotalSize;
    }
  }

  logger.info('context', 'Loaded relevant files', {
    count: loadedFiles.length,
    totalSize,
    workspaceRoot: workspaceContext.info.root,
  });

  return loadedFiles;
}

/**
 * Format loaded files as context text for prompts.
 */
export function formatFilesAsContext(files: LoadedFile[]): string {
  if (files.length === 0) {
    return '';
  }

  const parts: string[] = [];
  parts.push('## Workspace Context\n');
  parts.push('The following files from the workspace are provided for context:\n');

  for (const file of files) {
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
