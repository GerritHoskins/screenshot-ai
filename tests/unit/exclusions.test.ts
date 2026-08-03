/**
 * Exclusions and Preview Calculations Unit Tests - Phase 8
 * Tests exclusion pattern matching and preview calculations
 */

import { describe, it, expect } from 'vitest';
import type { FileTreeEntry } from '../../src/context/workspace';
import type { LoadedFile } from '../../src/context/file-loader';

describe('Exclusion Pattern Matching', () => {
  const testFiles = [
    'src/index.ts',
    'src/utils/helper.ts',
    '.env',
    '.env.local',
    'node_modules/package/index.js',
    'dist/bundle.js',
    'build/output.js',
    'secrets.json',
    'config/secrets.yaml',
    'keys/private.key',
    'certs/cert.pem',
    'data/cert.p12',
    '.git/config',
    'package.json',
    'README.md',
  ];

  function matchesPattern(filePath: string, pattern: string): boolean {
    // Simple glob-like pattern matching
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(filePath);
    }
    
    // Exact match or directory match
    return filePath === pattern || filePath.startsWith(pattern + '/') || filePath.includes('/' + pattern + '/');
  }

  it('should match exact file patterns', () => {
    const pattern = '.env';
    const matches = testFiles.filter(f => matchesPattern(f, pattern));
    
    expect(matches).toContain('.env');
    expect(matches).toContain('.env.local');
  });

  it('should match wildcard patterns', () => {
    const pattern = '*.key';
    const matches = testFiles.filter(f => matchesPattern(f, pattern));
    
    expect(matches).toContain('keys/private.key');
  });

  it('should match directory patterns', () => {
    const pattern = 'node_modules';
    const matches = testFiles.filter(f => matchesPattern(f, pattern));
    
    expect(matches).toContain('node_modules/package/index.js');
  });

  it('should match prefix patterns', () => {
    const pattern = 'secrets.*';
    const matches = testFiles.filter(f => matchesPattern(f, pattern));
    
    expect(matches).toContain('secrets.json');
    expect(matches).toContain('config/secrets.yaml');
  });

  it('should exclude multiple patterns', () => {
    const excludes = ['.env', 'node_modules', 'dist', 'build', '*.key', '*.pem', '*.p12'];
    const filtered = testFiles.filter(f => 
      !excludes.some(pattern => matchesPattern(f, pattern))
    );
    
    expect(filtered).not.toContain('.env');
    expect(filtered).not.toContain('node_modules/package/index.js');
    expect(filtered).not.toContain('dist/bundle.js');
    expect(filtered).not.toContain('keys/private.key');
    expect(filtered).toContain('src/index.ts');
    expect(filtered).toContain('package.json');
  });
});

describe('Preview Calculations', () => {
  const mockFiles: LoadedFile[] = [
    { path: 'src/index.ts', content: 'export const x = 1;', size: 100, language: 'typescript', truncated: false },
    { path: 'src/utils.ts', content: 'export function helper() {}', size: 200, language: 'typescript', truncated: false },
    { path: 'package.json', content: '{"name": "test"}', size: 50, language: 'json', truncated: false },
    { path: 'README.md', content: '# Test', size: 30, language: 'markdown', truncated: false },
    { path: 'large-file.ts', content: 'x'.repeat(100000), size: 100000, language: 'typescript', truncated: true },
  ];

  it('should calculate total file count', () => {
    const fileCount = mockFiles.length;
    expect(fileCount).toBe(5);
  });

  it('should calculate total size', () => {
    const totalSize = mockFiles.reduce((sum, file) => sum + file.size, 0);
    expect(totalSize).toBe(100380);
  });

  it('should get top N files', () => {
    const topFiles = mockFiles
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
      .map(f => ({ path: f.path, size: f.size }));
    
    expect(topFiles).toHaveLength(3);
    expect(topFiles[0].path).toBe('large-file.ts');
    expect(topFiles[0].size).toBe(100000);
  });

  it('should format size in KB', () => {
    const totalSize = mockFiles.reduce((sum, file) => sum + file.size, 0);
    const sizeKB = Math.round(totalSize / 1024);
    
    expect(sizeKB).toBe(98); // 100380 / 1024 ≈ 98 KB
  });

  it('should handle empty file list', () => {
    const emptyFiles: LoadedFile[] = [];
    const fileCount = emptyFiles.length;
    const totalSize = emptyFiles.reduce((sum, file) => sum + file.size, 0);
    
    expect(fileCount).toBe(0);
    expect(totalSize).toBe(0);
  });
});

describe('File Tree Entry Count', () => {
  const mockTree: FileTreeEntry[] = [
    {
      path: 'src',
      type: 'directory',
      children: [
        { path: 'src/index.ts', type: 'file', size: 100 },
        { path: 'src/utils.ts', type: 'file', size: 200 },
      ],
    },
    { path: 'package.json', type: 'file', size: 50 },
    { path: 'README.md', type: 'file', size: 30 },
  ];

  it('should count all tree entries', () => {
    function countEntries(entries: FileTreeEntry[]): number {
      let count = entries.length;
      for (const entry of entries) {
        if (entry.children) {
          count += countEntries(entry.children);
        }
      }
      return count;
    }

    const count = countEntries(mockTree);
    expect(count).toBe(5); // 3 top-level + 2 children
  });

  it('should count only files', () => {
    function countFiles(entries: FileTreeEntry[]): number {
      let count = 0;
      for (const entry of entries) {
        if (entry.type === 'file') {
          count++;
        }
        if (entry.children) {
          count += countFiles(entry.children);
        }
      }
      return count;
    }

    const fileCount = countFiles(mockTree);
    expect(fileCount).toBe(4); // 4 files total
  });
});
