/**
 * Redaction Filters - Workstream F
 * Pattern-based sensitive data filtering.
 */

// ============================================================================
// Redaction Rule Types
// ============================================================================

export interface RedactionRule {
  /** Rule identifier */
  name: string;
  /** Pattern to match */
  pattern: RegExp;
  /** Replacement text */
  replacement: string;
  /** Whether this rule is enabled by default */
  enabled: boolean;
  /** Category for grouping */
  category: 'api-keys' | 'credentials' | 'pii' | 'cloud';
}

// ============================================================================
// Default Redaction Rules
// ============================================================================

export const REDACTION_RULES: RedactionRule[] = [
  // API Keys
  {
    name: 'openai-key',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: '[OPENAI_KEY_REDACTED]',
    enabled: true,
    category: 'api-keys',
  },
  {
    name: 'anthropic-key',
    pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g,
    replacement: '[ANTHROPIC_KEY_REDACTED]',
    enabled: true,
    category: 'api-keys',
  },
  {
    name: 'generic-api-key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
    replacement: 'api_key=[API_KEY_REDACTED]',
    enabled: true,
    category: 'api-keys',
  },

  // Credentials
  {
    name: 'password-field',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^"'\s]{1,}["']?/gi,
    replacement: 'password=[PASSWORD_REDACTED]',
    enabled: true,
    category: 'credentials',
  },
  {
    name: 'bearer-token',
    pattern: /Bearer\s+[a-zA-Z0-9._-]+/g,
    replacement: 'Bearer [TOKEN_REDACTED]',
    enabled: true,
    category: 'credentials',
  },
  {
    name: 'basic-auth',
    pattern: /Basic\s+[a-zA-Z0-9+/=]+/g,
    replacement: 'Basic [AUTH_REDACTED]',
    enabled: true,
    category: 'credentials',
  },
  {
    name: 'jwt-token',
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    replacement: '[JWT_REDACTED]',
    enabled: true,
    category: 'credentials',
  },

  // PII
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]',
    enabled: true,
    category: 'pii',
  },
  {
    name: 'phone-us',
    pattern: /\b(?:\+1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    replacement: '[PHONE_REDACTED]',
    enabled: true,
    category: 'pii',
  },
  {
    name: 'ssn',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: '[SSN_REDACTED]',
    enabled: true,
    category: 'pii',
  },
  {
    name: 'credit-card',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: '[CARD_REDACTED]',
    enabled: true,
    category: 'pii',
  },

  // Cloud Credentials
  {
    name: 'aws-access-key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[AWS_KEY_REDACTED]',
    enabled: true,
    category: 'cloud',
  },
  {
    name: 'aws-secret-key',
    pattern: /(?:aws[_-]?secret|secret[_-]?key)\s*[:=]\s*["']?[a-zA-Z0-9/+=]{40}["']?/gi,
    replacement: 'aws_secret=[AWS_SECRET_REDACTED]',
    enabled: true,
    category: 'cloud',
  },
  {
    name: 'github-token',
    pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
    replacement: '[GITHUB_TOKEN_REDACTED]',
    enabled: true,
    category: 'cloud',
  },
  {
    name: 'google-api-key',
    pattern: /AIza[a-zA-Z0-9_-]{35}/g,
    replacement: '[GOOGLE_KEY_REDACTED]',
    enabled: true,
    category: 'cloud',
  },
];

// ============================================================================
// Redaction Functions
// ============================================================================

/**
 * Apply redaction rules to text.
 * @param text - The text to redact
 * @param rules - Optional custom rules (defaults to REDACTION_RULES)
 * @returns Redacted text
 */
export function redactSensitiveData(
  text: string,
  rules: RedactionRule[] = REDACTION_RULES
): string {
  let redacted = text;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    // Reset regex lastIndex for global patterns
    rule.pattern.lastIndex = 0;
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }

  return redacted;
}

/**
 * Check if text contains sensitive data.
 */
export function containsSensitiveData(
  text: string,
  rules: RedactionRule[] = REDACTION_RULES
): boolean {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Find all sensitive data matches in text.
 */
export function findSensitiveData(
  text: string,
  rules: RedactionRule[] = REDACTION_RULES
): Array<{ rule: string; match: string; index: number }> {
  const matches: Array<{ rule: string; match: string; index: number }> = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    
    while ((match = rule.pattern.exec(text)) !== null) {
      matches.push({
        rule: rule.name,
        match: match[0],
        index: match.index,
      });
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

/**
 * Create a custom redaction rule.
 */
export function createRedactionRule(
  name: string,
  pattern: RegExp,
  replacement: string,
  category: RedactionRule['category'] = 'credentials'
): RedactionRule {
  // Ensure pattern has global flag
  const globalPattern = pattern.global
    ? pattern
    : new RegExp(pattern.source, pattern.flags + 'g');

  return {
    name,
    pattern: globalPattern,
    replacement,
    enabled: true,
    category,
  };
}
