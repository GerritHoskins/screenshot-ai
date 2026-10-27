import { describe, expect, it } from 'vitest';
import { escapeHtml, formatAnswer, normalizeSeverity } from '../../apps/desktop/src/renderer/utils/formatting';

describe('untrusted analysis formatting', () => {
  it('escapes plain HTML and attribute delimiters before adding markup', () => {
    const payload = '<img src=x onerror="window.api.capture.start()">';
    expect(formatAnswer(payload)).toBe('&lt;img src=x onerror=&quot;window.api.capture.start()&quot;&gt;');
    expect(formatAnswer(payload)).not.toContain('<img');
    expect(escapeHtml("'&<>")).toBe('&#39;&amp;&lt;&gt;');
  });

  it('retains supported formatting while escaping attacks inside every form', () => {
    const result = formatAnswer('**<img src=x>**\n`<svg onload=alert(1)>`\n```html\n</code><script>alert(1)</script>\n```');
    expect(result).toContain('<strong>&lt;img src=x&gt;</strong>');
    expect(result).toContain('<code class="inline-code">&lt;svg onload=alert(1)&gt;</code>');
    expect(result).toContain('&lt;/code&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('does not apply inline markdown transformations inside code blocks', () => {
    expect(formatAnswer('```ts\n**literal** `code`\n```')).toContain('<pre><code>**literal** `code`</code></pre>');
  });

  it('restricts model-controlled severity attributes to known values', () => {
    expect(normalizeSeverity('HIGH')).toBe('high');
    expect(normalizeSeverity('high" onclick="alert(1)')).toBe('medium');
    expect(normalizeSeverity({ toString: () => '<img>' })).toBe('medium');
  });
});
