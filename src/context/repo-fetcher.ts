/**
 * Repository Content Fetcher - Phase 3
 * Fetches file trees and contents from GitHub/GitLab repositories
 */

import { getLogger } from '@logging';
import { getRepoToken } from '@security/repo-auth';
import type { ContextSource } from '@settings/schema';
import { wrapRepoError } from './repo-errors';
import { isExcluded } from './policy';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface RepoFile {
  path: string;
  content: string;
  size: number;
  sha?: string; // Git SHA for the file
  language?: string;
  truncated: boolean;
}

export interface RepoTreeEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha?: string;
}

export interface RepoContext {
  files: RepoFile[];
  tree: RepoTreeEntry[];
  stats: {
    totalFiles: number;
    totalSize: number;
    branch: string;
    lastFetched: number;
  };
}

export interface FetchOptions {
  includeFileTree?: boolean;
  includeFileContents?: boolean;
  maxFileSize?: number;
  maxTotalSize?: number;
  maxFiles?: number;
  excludePatterns?: RegExp[];
}

const DEFAULT_FETCH_OPTIONS: Required<FetchOptions> = {
  includeFileTree: true,
  includeFileContents: true,
  maxFileSize: 100 * 1024, // 100 KB per file
  maxTotalSize: 500 * 1024, // 500 KB total
  maxFiles: 10,
  excludePatterns: [],
};

// ============================================================================
// GitHub API
// ============================================================================

async function fetchGitHubTree(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token: string
): Promise<RepoTreeEntry[]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'screenshot-ai',
      },
    });
  } catch (error) {
    throw wrapRepoError(error, {
      provider: 'github',
      operation: 'fetchTree',
    });
  }

  if (!response.ok) {
    const error = wrapRepoError(new Error(`GitHub API error: ${response.status} ${response.statusText}`), {
      statusCode: response.status,
      provider: 'github',
      operation: 'fetchTree',
    });
    throw error;
  }

  const data = await response.json();
  const entries: RepoTreeEntry[] = [];

  if (data.tree) {
    for (const item of data.tree) {
      if (item.type === 'blob') {
        entries.push({
          path: item.path,
          type: 'file',
          size: item.size,
          sha: item.sha,
        });
      } else if (item.type === 'tree') {
        entries.push({
          path: item.path,
          type: 'dir',
        });
      }
    }
  }

  return entries.filter(entry => isWithinScope(entry.path, path));
}

async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string,
  token: string,
  ref: string
): Promise<{ content: string; sha: string; size: number }> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'screenshot-ai',
      },
    });
  } catch (error) {
    throw wrapRepoError(error, {
      provider: 'github',
      operation: 'fetchFile',
    });
  }

  if (!response.ok) {
    const error = wrapRepoError(new Error(`GitHub API error: ${response.status} ${response.statusText}`), {
      statusCode: response.status,
      provider: 'github',
      operation: 'fetchFile',
    });
    throw error;
  }

  const data = await response.json();
  
  if (data.encoding === 'base64') {
    // Use TextDecoder for browser compatibility, or Buffer in Node.js
    let content: string;
    if (typeof Buffer !== 'undefined') {
      content = Buffer.from(data.content, 'base64').toString('utf8');
    } else {
      // Browser fallback (though this shouldn't run in Electron main process)
      const binaryString = atob(data.content);
      content = decodeURIComponent(escape(binaryString));
    }
    return {
      content,
      sha: data.sha,
      size: content.length,
    };
  }

  throw new Error(`Unsupported encoding: ${data.encoding}`);
}

async function getGitHubBranchSha(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<string> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'screenshot-ai',
      },
    });
  } catch (error) {
    throw wrapRepoError(error, {
      provider: 'github',
      operation: 'getBranchSha',
    });
  }

  if (!response.ok) {
    const error = wrapRepoError(new Error(`GitHub API error: ${response.status} ${response.statusText}`), {
      statusCode: response.status,
      provider: 'github',
      operation: 'getBranchSha',
    });
    throw error;
  }

  const data = await response.json();
  return data.object.sha;
}

// ============================================================================
// GitLab API
// ============================================================================

async function fetchGitLabTree(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token: string
): Promise<RepoTreeEntry[]> {
  const pathParam = path ? `&path=${encodeURIComponent(path)}` : '';
  const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true${pathParam}`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'PRIVATE-TOKEN': token,
      },
    });
  } catch (error) {
    throw wrapRepoError(error, {
      provider: 'gitlab',
      operation: 'fetchTree',
    });
  }

  if (!response.ok) {
    const error = wrapRepoError(new Error(`GitLab API error: ${response.status} ${response.statusText}`), {
      statusCode: response.status,
      provider: 'gitlab',
      operation: 'fetchTree',
    });
    throw error;
  }

  const data = await response.json();
  const entries: RepoTreeEntry[] = [];

  for (const item of data) {
    if (item.type === 'blob') {
      entries.push({
        path: item.path,
        type: 'file',
        size: item.size,
      });
    } else if (item.type === 'tree') {
      entries.push({
        path: item.path,
        type: 'dir',
      });
    }
  }

  return entries;
}

async function fetchGitLabFile(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  token: string
): Promise<{ content: string; size: number }> {
  const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'PRIVATE-TOKEN': token,
      },
    });
  } catch (error) {
    throw wrapRepoError(error, {
      provider: 'gitlab',
      operation: 'fetchFile',
    });
  }

  if (!response.ok) {
    const error = wrapRepoError(new Error(`GitLab API error: ${response.status} ${response.statusText}`), {
      statusCode: response.status,
      provider: 'gitlab',
      operation: 'fetchFile',
    });
    throw error;
  }

  const content = await response.text();
  return {
    content,
    size: content.length,
  };
}

// ============================================================================
// Language Detection
// ============================================================================

function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'r': 'r',
    'sql': 'sql',
    'sh': 'bash',
    'yaml': 'yaml',
    'yml': 'yaml',
    'json': 'json',
    'xml': 'xml',
    'html': 'html',
    'css': 'css',
    'md': 'markdown',
  };
  return ext ? languageMap[ext] : undefined;
}

// ============================================================================
// Pattern Matching
// ============================================================================

function shouldIncludeFile(filePath: string, excludePatterns: RegExp[]): boolean {
  return !isExcluded(filePath, excludePatterns);
}

function isWithinScope(filePath: string, pathScope: string = ''): boolean {
  const scope = pathScope.replace(/^\/+|\/+$/g, '');
  return !scope || filePath === scope || filePath.startsWith(`${scope}/`);
}

// ============================================================================
// Unified Fetcher
// ============================================================================

/**
 * Fetch repository context from GitHub or GitLab.
 */
export async function fetchRepoContext(
  source: ContextSource,
  options: Partial<FetchOptions> = {},
  authToken?: string,
): Promise<RepoContext> {
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options };
  const scope = source.scope as any;

  if (source.type === 'github') {
    return fetchGitHubContext(source, scope, opts, authToken);
  } else if (source.type === 'gitlab') {
    return fetchGitLabContext(source, scope, opts, authToken);
  } else {
    throw wrapRepoError(new Error(`Unsupported source type: ${source.type}`), {
      operation: 'fetchRepoContext',
    });
  }
}

async function fetchGitHubContext(
  source: ContextSource,
  scope: any,
  options: Required<FetchOptions>,
  authToken?: string,
): Promise<RepoContext> {
  const { owner, repo, defaultBranch = 'main', pathScope } = scope;
  const branch = defaultBranch;

  if (!owner || !repo) {
    throw wrapRepoError(new Error('GitHub source missing owner or repo'), {
      provider: 'github',
      operation: 'fetchGitHubContext',
    });
  }

  // Get auth token
  const authRef = source.authRef || 'github:default';
  const token = authToken ?? await getRepoToken('github', authRef);
  if (!token) {
    throw wrapRepoError(new Error('GitHub authentication token not found'), {
      provider: 'github',
      operation: 'fetchGitHubContext',
    });
  }

  const tree: RepoTreeEntry[] = [];
  const files: RepoFile[] = [];
  let totalSize = 0;

  try {
    // Get branch SHA
    const branchSha = await getGitHubBranchSha(owner, repo, branch, token);

    // Fetch tree
    if (options.includeFileTree || options.includeFileContents) {
      const treeEntries = await fetchGitHubTree(owner, repo, branchSha, pathScope || '', token);
      tree.push(...treeEntries.filter(entry => isWithinScope(entry.path, pathScope) && shouldIncludeFile(entry.path, options.excludePatterns)));
    }

    // Filter files by path scope and exclusions
    const fileEntries = tree.filter(
      entry => entry.type === 'file' && shouldIncludeFile(entry.path, options.excludePatterns)
    );

    // Fetch file contents if requested
    if (options.includeFileContents && fileEntries.length > 0) {
      // Prioritize files (limit to maxFiles)
      const filesToFetch = fileEntries.slice(0, options.maxFiles);

      for (const entry of filesToFetch) {
        if (files.length >= options.maxFiles) break;
        if (totalSize >= options.maxTotalSize) break;

        try {
          const fileData = await fetchGitHubFile(owner, repo, entry.path, token, branchSha);
          
          // Check size limits
          if (fileData.size > options.maxFileSize * 2) {
            logger.debug('repo-fetcher', 'File too large, skipping', { path: entry.path, size: fileData.size });
            continue;
          }

          let content = fileData.content;
          let truncated = false;

          // Truncate if necessary
          if (content.length > options.maxFileSize) {
            const truncatedContent = content.slice(0, options.maxFileSize);
            const lastNewline = truncatedContent.lastIndexOf('\n');
            if (lastNewline > options.maxFileSize * 0.8) {
              content = content.slice(0, lastNewline) + '\n... [truncated]';
            } else {
              content = content.slice(0, options.maxFileSize) + '... [truncated]';
            }
            truncated = true;
          }

          const newTotalSize = totalSize + fileData.size;
          if (newTotalSize > options.maxTotalSize) {
            break;
          }

          files.push({
            path: entry.path,
            content,
            size: fileData.size,
            sha: fileData.sha,
            language: detectLanguage(entry.path),
            truncated,
          });

          totalSize = newTotalSize;
        } catch (error) {
          logger.debug('repo-fetcher', 'Failed to fetch file', { path: entry.path, error });
          // Continue with other files
        }
      }
    }

    logger.info('repo-fetcher', 'Fetched GitHub context', {
      owner,
      repo,
      branch,
      filesCount: files.length,
      treeCount: tree.length,
      totalSize,
    });

    return {
      files,
      tree: options.includeFileTree ? tree : [],
      stats: {
        totalFiles: fileEntries.length,
        totalSize,
        branch,
        lastFetched: Date.now(),
      },
    };
  } catch (error) {
    const repoError = wrapRepoError(error, {
      provider: 'github',
      operation: 'fetchGitHubContext',
    });
    logger.error('repo-fetcher', 'Failed to fetch GitHub context', {
      code: repoError.code,
      message: repoError.message,
      details: repoError.details,
    });
    throw repoError;
  }
}

async function fetchGitLabContext(
  source: ContextSource,
  scope: any,
  options: Required<FetchOptions>,
  authToken?: string,
): Promise<RepoContext> {
  const { owner, repo, defaultBranch = 'main', pathScope } = scope;
  const branch = defaultBranch;

  if (!owner || !repo) {
    throw wrapRepoError(new Error('GitLab source missing owner or repo'), {
      provider: 'gitlab',
      operation: 'fetchGitLabContext',
    });
  }

  // Get auth token
  const authRef = source.authRef || 'gitlab:default';
  const token = authToken ?? await getRepoToken('gitlab', authRef);
  if (!token) {
    throw wrapRepoError(new Error('GitLab authentication token not found'), {
      provider: 'gitlab',
      operation: 'fetchGitLabContext',
    });
  }

  const tree: RepoTreeEntry[] = [];
  const files: RepoFile[] = [];
  let totalSize = 0;

  try {
    // Fetch tree
    if (options.includeFileTree || options.includeFileContents) {
      const treeEntries = await fetchGitLabTree(owner, repo, branch, pathScope || '', token);
      tree.push(...treeEntries.filter(entry => isWithinScope(entry.path, pathScope) && shouldIncludeFile(entry.path, options.excludePatterns)));
    }

    // Filter files by path scope and exclusions
    const fileEntries = tree.filter(
      entry => entry.type === 'file' && shouldIncludeFile(entry.path, options.excludePatterns)
    );

    // Fetch file contents if requested
    if (options.includeFileContents && fileEntries.length > 0) {
      // Prioritize files (limit to maxFiles)
      const filesToFetch = fileEntries.slice(0, options.maxFiles);

      for (const entry of filesToFetch) {
        if (files.length >= options.maxFiles) break;
        if (totalSize >= options.maxTotalSize) break;

        try {
          const fileData = await fetchGitLabFile(owner, repo, entry.path, branch, token);
          
          // Check size limits
          if (fileData.size > options.maxFileSize * 2) {
            logger.debug('repo-fetcher', 'File too large, skipping', { path: entry.path, size: fileData.size });
            continue;
          }

          let content = fileData.content;
          let truncated = false;

          // Truncate if necessary
          if (content.length > options.maxFileSize) {
            const truncatedContent = content.slice(0, options.maxFileSize);
            const lastNewline = truncatedContent.lastIndexOf('\n');
            if (lastNewline > options.maxFileSize * 0.8) {
              content = content.slice(0, lastNewline) + '\n... [truncated]';
            } else {
              content = content.slice(0, options.maxFileSize) + '... [truncated]';
            }
            truncated = true;
          }

          const newTotalSize = totalSize + fileData.size;
          if (newTotalSize > options.maxTotalSize) {
            break;
          }

          files.push({
            path: entry.path,
            content,
            size: fileData.size,
            language: detectLanguage(entry.path),
            truncated,
          });

          totalSize = newTotalSize;
        } catch (error) {
          logger.debug('repo-fetcher', 'Failed to fetch file', { path: entry.path, error });
          // Continue with other files
        }
      }
    }

    logger.info('repo-fetcher', 'Fetched GitLab context', {
      owner,
      repo,
      branch,
      filesCount: files.length,
      treeCount: tree.length,
      totalSize,
    });

    return {
      files,
      tree: options.includeFileTree ? tree : [],
      stats: {
        totalFiles: fileEntries.length,
        totalSize,
        branch,
        lastFetched: Date.now(),
      },
    };
  } catch (error) {
    const repoError = wrapRepoError(error, {
      provider: 'gitlab',
      operation: 'fetchGitLabContext',
    });
    logger.error('repo-fetcher', 'Failed to fetch GitLab context', {
      code: repoError.code,
      message: repoError.message,
      details: repoError.details,
    });
    throw repoError;
  }
}
