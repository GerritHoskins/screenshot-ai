/**
 * Text Formatting Utilities
 */

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/**
 * Format answer with markdown-style code blocks
 */
export function formatAnswer(text: unknown): string {
  // Escape each original text segment before adding our own limited markup.
  // Code blocks are kept separate so inline formatting cannot rewrite them.
  return String(text ?? '').split(/(```\w*\n[\s\S]*?```)/g).map(segment => {
    const block = /^```(\w*)\n([\s\S]*?)```$/.exec(segment);
    if (block) {
      const label = block[1] ? `<div class="code-lang">${escapeHtml(block[1])}</div>` : '';
      return `<div class="code-block">${label}<pre><code>${escapeHtml(block[2].trim())}</code></pre></div>`;
    }
    return escapeHtml(segment)
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }).join('');
}

export function normalizeSeverity(value: unknown): 'high' | 'medium' | 'low' {
  const severity = String(value ?? '').toLowerCase();
  return severity === 'high' || severity === 'low' ? severity : 'medium';
}

/**
 * Format camelCase keys to readable labels
 */
export function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Derive issue title from statement
 */
export function deriveIssueTitle(statement: string, maxLength: number = 80): string {
  if (statement.length <= maxLength) return statement;
  
  // Try to break at sentence boundary
  const truncated = statement.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastExclamation = truncated.lastIndexOf('!');
  const lastQuestion = truncated.lastIndexOf('?');
  const lastBreak = Math.max(lastPeriod, lastExclamation, lastQuestion);
  
  if (lastBreak > maxLength * 0.7) {
    return statement.substring(0, lastBreak + 1);
  }
  
  return truncated + '...';
}
