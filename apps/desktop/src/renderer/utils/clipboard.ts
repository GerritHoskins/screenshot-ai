/**
 * Clipboard Utilities
 */

/**
 * Copy text to clipboard with error handling
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    // Fallback for older browsers
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch (fallbackErr) {
      console.error('Fallback copy failed:', fallbackErr);
      return false;
    }
  }
}

/**
 * Copy issue as formatted text
 */
export function formatIssueForClipboard(issue: any): string {
  let text = `[${issue.type || 'Issue'}] ${(issue.severity || 'medium').toUpperCase()}`;
  if (issue.slide) text += ` - Slide ${issue.slide}`;
  text += `\n\n${issue.statement || issue.text || ''}`;
  if (issue.details) text += `\n\n${issue.details}`;
  if (issue.evidence) text += `\n\nEvidence: ${issue.evidence}`;
  if (issue.suggestion) text += `\n\nSuggested Fix: ${issue.suggestion}`;
  return text;
}
