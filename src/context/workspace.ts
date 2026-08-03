/**
 * Workspace Context Module
 * Detects and loads workspace/project context for enhanced AI analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '@logging';

const logger = getLogger({ minLevel: 0 });

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceInfo {
  root: string;
  name: string;
  type: 'git' | 'npm' | 'python' | 'unknown';
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  hasConfigFiles: string[];
}

export interface WorkspaceContext {
  info: WorkspaceInfo;
  fileTree: FileTreeEntry[];
  relevantFiles: string[]; // Paths to potentially relevant files
  summary: string; // Text summary of the workspace
}

export interface FileTreeEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeEntry[];
}

// ============================================================================
// Workspace Detection
// ============================================================================

/**
 * Detect workspace root from a given directory.
 * Looks for common project markers (git, package.json, etc.)
 */
export function detectWorkspaceRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    // Check for common project markers
    const markers = [
      '.git',
      'package.json',
      'pyproject.toml',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      '.vscode',
      '.idea',
    ];

    for (const marker of markers) {
      const markerPath = path.join(current, marker);
      if (fs.existsSync(markerPath)) {
        return current;
      }
    }

    // Move up one directory
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Analyze workspace and return workspace info.
 */
export function analyzeWorkspace(workspaceRoot: string): WorkspaceInfo | null {
  try {
    if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
      return null;
    }

    const name = path.basename(workspaceRoot);
    const hasConfigFiles: string[] = [];
    let type: WorkspaceInfo['type'] = 'unknown';
    let packageManager: WorkspaceInfo['packageManager'];

    // Check for Git
    if (fs.existsSync(path.join(workspaceRoot, '.git'))) {
      type = 'git';
    }

    // Check for Node.js/npm
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      hasConfigFiles.push('package.json');
      type = 'npm';
      
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        // Detect package manager from lock files
        if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) {
          packageManager = 'yarn';
        } else if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
          packageManager = 'pnpm';
        } else if (fs.existsSync(path.join(workspaceRoot, 'package-lock.json'))) {
          packageManager = 'npm';
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Check for Python
    if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) ||
        fs.existsSync(path.join(workspaceRoot, 'requirements.txt')) ||
        fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
      hasConfigFiles.push('pyproject.toml', 'requirements.txt', 'setup.py');
      type = 'python';
    }

    // Check for other config files
    const otherConfigs = [
      'tsconfig.json',
      'jsconfig.json',
      '.eslintrc.js',
      '.eslintrc.json',
      'webpack.config.js',
      'vite.config.ts',
      'electron.vite.config.ts',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
    ];

    for (const config of otherConfigs) {
      if (fs.existsSync(path.join(workspaceRoot, config))) {
        hasConfigFiles.push(config);
      }
    }

    return {
      root: workspaceRoot,
      name,
      type,
      packageManager,
      hasConfigFiles: [...new Set(hasConfigFiles)], // Remove duplicates
    };
  } catch (error) {
    logger.error('context', 'Failed to analyze workspace', { error, workspaceRoot });
    return null;
  }
}

/**
 * Build a file tree representation of the workspace.
 * Limited depth and excludes common ignore patterns.
 */
export function buildFileTree(
  workspaceRoot: string,
  maxDepth: number = 3,
  maxEntries: number = 100
): FileTreeEntry[] {
  const entries: FileTreeEntry[] = [];
  const ignorePatterns = [
    /^node_modules$/,
    /^\.git$/,
    /^\.vscode$/,
    /^\.idea$/,
    /^dist$/,
    /^build$/,
    /^out$/,
    /^\.next$/,
    /^\.cache$/,
    /^coverage$/,
    /^\.nyc_output$/,
    /^\.env$/,
    /^\.DS_Store$/,
  ];

  function shouldIgnore(name: string): boolean {
    return ignorePatterns.some(pattern => pattern.test(name));
  }

  function traverse(dir: string, currentDepth: number, relativePath: string = ''): void {
    if (currentDepth > maxDepth || entries.length >= maxEntries) {
      return;
    }

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (entries.length >= maxEntries) break;
        if (shouldIgnore(item.name)) continue;

        const fullPath = path.join(dir, item.name);
        const relativeItemPath = path.join(relativePath, item.name).replace(/\\/g, '/');

        if (item.isDirectory()) {
          entries.push({
            path: relativeItemPath,
            type: 'directory',
          });
          traverse(fullPath, currentDepth + 1, relativeItemPath);
        } else if (item.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            entries.push({
              path: relativeItemPath,
              type: 'file',
              size: stats.size,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
      logger.debug('context', 'Failed to read directory', { dir, error });
    }
  }

  traverse(workspaceRoot, 0);
  return entries;
}

/**
 * Find potentially relevant files based on common patterns.
 * Looks for source files, config files, and documentation.
 */
export function findRelevantFiles(
  workspaceRoot: string,
  maxFiles: number = 20
): string[] {
  const relevantFiles: string[] = [];
  const patterns = [
    // Source files
    /\.(ts|tsx|js|jsx|py|java|go|rs|rb|php)$/,
    // Config files
    /\.(json|yaml|yml|toml|ini|conf)$/,
    // Documentation
    /^(README|CHANGELOG|LICENSE|CONTRIBUTING)\.(md|txt)$/i,
    // Build configs
    /^(webpack|vite|rollup|esbuild|tsconfig|jsconfig|babel)\./i,
  ];

  const ignoreDirs = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    '.next',
    '.cache',
    'coverage',
  ];

  function traverse(dir: string, relativePath: string = ''): void {
    if (relevantFiles.length >= maxFiles) return;

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        if (relevantFiles.length >= maxFiles) break;
        if (ignoreDirs.includes(item.name)) continue;

        const fullPath = path.join(dir, item.name);
        const relativeItemPath = path.join(relativePath, item.name).replace(/\\/g, '/');

        if (item.isDirectory()) {
          traverse(fullPath, relativeItemPath);
        } else if (item.isFile()) {
          if (patterns.some(pattern => pattern.test(item.name))) {
            relevantFiles.push(relativeItemPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  traverse(workspaceRoot);
  return relevantFiles.slice(0, maxFiles);
}

/**
 * Generate a text summary of the workspace.
 */
export function generateWorkspaceSummary(info: WorkspaceInfo, fileTree: FileTreeEntry[]): string {
  const parts: string[] = [];

  parts.push(`Workspace: ${info.name}`);
  parts.push(`Type: ${info.type}`);
  
  if (info.packageManager) {
    parts.push(`Package Manager: ${info.packageManager}`);
  }

  if (info.hasConfigFiles.length > 0) {
    parts.push(`Config Files: ${info.hasConfigFiles.join(', ')}`);
  }

  const fileCount = fileTree.filter(e => e.type === 'file').length;
  const dirCount = fileTree.filter(e => e.type === 'directory').length;
  parts.push(`Structure: ${fileCount} files, ${dirCount} directories`);

  return parts.join('\n');
}

/**
 * Load complete workspace context.
 */
export async function loadWorkspaceContext(
  startDir: string = process.cwd()
): Promise<WorkspaceContext | null> {
  try {
    const workspaceRoot = detectWorkspaceRoot(startDir);
    if (!workspaceRoot) {
      logger.debug('context', 'No workspace root detected', { startDir });
      return null;
    }

    const info = analyzeWorkspace(workspaceRoot);
    if (!info) {
      return null;
    }

    const fileTree = buildFileTree(workspaceRoot);
    const relevantFiles = findRelevantFiles(workspaceRoot);
    const summary = generateWorkspaceSummary(info, fileTree);

    logger.info('context', 'Workspace context loaded', {
      root: workspaceRoot,
      type: info.type,
      fileCount: fileTree.length,
      relevantFilesCount: relevantFiles.length,
    });

    return {
      info,
      fileTree,
      relevantFiles,
      summary,
    };
  } catch (error) {
    logger.error('context', 'Failed to load workspace context', { error, startDir });
    return null;
  }
}
