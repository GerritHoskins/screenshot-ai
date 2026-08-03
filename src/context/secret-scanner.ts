/**
 * Secret Scanner - Phase 4
 * Detects potential secrets and sensitive data in context files
 */

import { getLogger } from '@logging';
import type { LoadedFile } from './file-loader';
import type { RepoFile } from './repo-fetcher';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface SecretMatch {
  file: string;
  line: number;
  pattern: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  content: string; // Matched line content (truncated)
}

export interface ScanResult {
  matches: SecretMatch[];
  hasSecrets: boolean;
  riskLevel: 'high' | 'medium' | 'low' | 'none';
  summary: {
    high: number;
    medium: number;
    low: number;
  };
}

// ============================================================================
// Secret Patterns
// ============================================================================

interface SecretPattern {
  pattern: RegExp;
  severity: 'high' | 'medium' | 'low';
  description: string;
  filePattern?: RegExp; // Optional: only match in specific files
}

const SECRET_PATTERNS: SecretPattern[] = [
  // API Keys
  {
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/i,
    severity: 'high',
    description: 'Potential API key detected',
  },
  {
    pattern: /(?:secret|secret[_-]?key)\s*[=:]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/i,
    severity: 'high',
    description: 'Potential secret key detected',
  },
  {
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]?([^\s'"]{8,})['"]?/i,
    severity: 'high',
    description: 'Potential password detected',
  },
  {
    pattern: /(?:token|access[_-]?token)\s*[=:]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/i,
    severity: 'high',
    description: 'Potential access token detected',
  },
  
  // AWS
  {
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'high',
    description: 'AWS Access Key ID detected',
  },
  {
    pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*['"]?([a-zA-Z0-9/+=]{40})['"]?/i,
    severity: 'high',
    description: 'AWS Secret Access Key detected',
  },
  
  // GitHub/GitLab tokens
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/,
    severity: 'high',
    description: 'GitHub Personal Access Token detected',
  },
  {
    pattern: /gho_[a-zA-Z0-9]{36}/,
    severity: 'high',
    description: 'GitHub OAuth token detected',
  },
  {
    pattern: /glpat-[a-zA-Z0-9_-]{20}/,
    severity: 'high',
    description: 'GitLab Personal Access Token detected',
  },
  
  // Private keys
  {
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
    severity: 'high',
    description: 'Private key detected',
    filePattern: /\.(key|pem|p12|pfx)$/i,
  },
  
  // Environment files with sensitive patterns
  {
    pattern: /\.env$/,
    severity: 'medium',
    description: '.env file detected',
    filePattern: /\.env$/,
  },
  {
    pattern: /(?:db|database)[_-]?(?:password|passwd|pwd)\s*[=:]\s*['"]?([^\s'"]{4,})['"]?/i,
    severity: 'high',
    description: 'Database password detected',
  },
  
  // OAuth secrets
  {
    pattern: /(?:oauth[_-]?)?client[_-]?secret\s*[=:]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/i,
    severity: 'high',
    description: 'OAuth client secret detected',
  },
  
  // JWT secrets
  {
    pattern: /jwt[_-]?secret\s*[=:]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/i,
    severity: 'high',
    description: 'JWT secret detected',
  },
  
  // Credit card numbers (basic pattern)
  {
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
    severity: 'high',
    description: 'Potential credit card number detected',
  },
  
  // Email addresses in config (might be sensitive)
  {
    pattern: /(?:email|mail)\s*[=:]\s*['"]?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['"]?/i,
    severity: 'low',
    description: 'Email address in configuration',
  },
  
  // Connection strings
  {
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/i,
    severity: 'medium',
    description: 'Database connection string detected',
  },
];

// ============================================================================
// Secret Scanning
// ============================================================================

/**
 * Scan files for potential secrets.
 */
export function scanForSecrets(files: (LoadedFile | RepoFile)[]): ScanResult {
  const matches: SecretMatch[] = [];

  for (const file of files) {
    // Skip if file is too large (might be false positives)
    if (file.size > 500 * 1024) {
      continue;
    }

    const lines = file.content.split('\n');
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      
      for (const pattern of SECRET_PATTERNS) {
        // Check file pattern if specified
        if (pattern.filePattern && !pattern.filePattern.test(file.path)) {
          continue;
        }
        
        // Check if pattern matches
        const match = pattern.pattern.exec(line);
        if (match) {
          // Extract matched content (truncate if too long)
          const matchedContent = line.length > 100 
            ? line.substring(0, 97) + '...' 
            : line;
          
          matches.push({
            file: file.path,
            line: lineNum + 1,
            pattern: pattern.pattern.source,
            severity: pattern.severity,
            description: pattern.description,
            content: matchedContent.trim(),
          });
          
          // Only report first match per line
          break;
        }
      }
    }
  }

  // Calculate summary
  const summary = {
    high: matches.filter(m => m.severity === 'high').length,
    medium: matches.filter(m => m.severity === 'medium').length,
    low: matches.filter(m => m.severity === 'low').length,
  };

  // Determine risk level
  let riskLevel: 'high' | 'medium' | 'low' | 'none';
  if (summary.high > 0) {
    riskLevel = 'high';
  } else if (summary.medium > 0) {
    riskLevel = 'medium';
  } else if (summary.low > 0) {
    riskLevel = 'low';
  } else {
    riskLevel = 'none';
  }

  logger.info('secret-scanner', 'Secret scan completed', {
    fileCount: files.length,
    matchCount: matches.length,
    riskLevel,
    summary,
  });

  return {
    matches,
    hasSecrets: matches.length > 0,
    riskLevel,
    summary,
  };
}

/**
 * Check if a file path should be excluded from secret scanning.
 */
export function shouldExcludeFromScan(filePath: string, excludePatterns: RegExp[]): boolean {
  return excludePatterns.some(pattern => pattern.test(filePath));
}

/**
 * Format scan result for display.
 */
export function formatScanResult(result: ScanResult): string {
  if (!result.hasSecrets) {
    return 'No secrets detected.';
  }

  const parts: string[] = [];
  parts.push(`⚠️ ${result.matches.length} potential secret(s) detected:`);
  parts.push(`  • High risk: ${result.summary.high}`);
  parts.push(`  • Medium risk: ${result.summary.medium}`);
  parts.push(`  • Low risk: ${result.summary.low}`);
  
  if (result.matches.length > 0) {
    parts.push('\nTop matches:');
    for (const match of result.matches.slice(0, 5)) {
      parts.push(`  • ${match.file}:${match.line} - ${match.description}`);
    }
    if (result.matches.length > 5) {
      parts.push(`  ... and ${result.matches.length - 5} more`);
    }
  }

  return parts.join('\n');
}
