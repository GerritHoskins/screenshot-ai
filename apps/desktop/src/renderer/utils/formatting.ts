/**
 * Text Formatting Utilities
 */

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format answer with markdown-style code blocks
 */
export function formatAnswer(text: string): string {
  let formatted = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
    return `<div class="code-block">${langLabel}<pre><code>${escapeHtml(code.trim())}</code></pre></div>`;
  });
  
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  formatted = formatted.replace(/\n/g, '<br>');
  
  return formatted;
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
