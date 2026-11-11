import { describe, expect, it } from 'vitest';
import {
  buildReportMarkdown,
  confidenceLevel,
  describeError,
  describeShield,
  formatAnswer,
  formatAnswerParts,
  formatTokens,
  icon,
  normalizeConfidence,
  normalizeIssue,
  resolveRetryAfter,
} from '../../apps/desktop/src/renderer/utils/formatting';

describe('formatAnswer markdown subset', () => {
  it('renders fenced code with a language label as .code-block', () => {
    const html = formatAnswer('Intro\n\n```ts\nconst a = 1;\n```\n\nAfter');
    expect(html).toBe('<p>Intro</p><div class="code-block"><div class="code-lang">ts</div><pre><code>const a = 1;</code></pre></div><p>After</p>');
  });

  it('omits .code-lang without a language and handles CRLF, c++ and unclosed fences', () => {
    expect(formatAnswer('a\r\n\r\n```\r\nx\r\n```')).toContain('<div class="code-block"><pre><code>x</code></pre></div>');
    expect(formatAnswer('a\n\n```c++\nint x;\n```')).toContain('<div class="code-lang">c++</div>');
    expect(formatAnswer('a\n\n```py\nprint(1)')).toContain('<pre><code>print(1)</code></pre>');
  });

  it('keeps code indentation and never formats inside fences', () => {
    expect(formatAnswer('x\n\n```\n  **a**\n    - b\n```')).toContain('<pre><code>  **a**\n    - b</code></pre>');
  });

  it('renders inline code without bolding inside it', () => {
    expect(formatAnswer('use `**x**` and **y**')).toBe('use <code class="inline-code">**x**</code> and <strong>y</strong>');
  });

  it('lets emphasis wrap inline code and keeps placeholder bytes inert', () => {
    expect(formatAnswer('**`a` is `null`** now')).toBe('<strong><code class="inline-code">a</code> is <code class="inline-code">null</code></strong> now');
    expect(formatAnswer('x0 `<b>`')).toBe('x0 <code class="inline-code">&lt;b&gt;</code>');
  });

  it('renders bullet and numbered lists', () => {
    expect(formatAnswer('Steps:\n- one\n* two\n\n1. first\n2. second')).toBe('<p>Steps:</p><ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>');
    expect(formatAnswer('x\n\n3. three\n4. four')).toContain('<ol start="3">');
  });

  it('escapes HTML inside lists, headings, code and the language label', () => {
    const html = formatAnswer('# <b>h</b>\n- <img src=x onerror=1>\n\n```"><script>\n<script>alert(1)</script>\n```');
    expect(html).not.toMatch(/<(img|script|b)[\s>]/);
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
  });

  it('splits the lead paragraph from the rest', () => {
    expect(formatAnswerParts('**Yes.** It works.\n\n- a')).toEqual({ lead: '<strong>Yes.</strong> It works.', body: '<ul><li>a</li></ul>' });
    expect(formatAnswerParts('- a').lead).toBe('');
  });
});

describe('result helpers', () => {
  it('maps confidence to contract levels', () => {
    expect(confidenceLevel(0.93)).toBe('high');
    expect(confidenceLevel(0.8)).toBe('high');
    expect(confidenceLevel(0.5)).toBe('medium');
    expect(confidenceLevel(0.49)).toBe('low');
    expect(normalizeConfidence(93)).toBe(0.93);
    expect(normalizeConfidence('x')).toBeNull();
  });

  it('formats tokens and builds icons without emoji', () => {
    expect(formatTokens(1840, 412, 'en-US')).toBe('1,840 in · 412 out');
    const svg = icon('chevron-right', 'disclosure-chevron');
    expect(svg).toContain('class="icon disclosure-chevron"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('stroke-width="1.75"');
  });

  it('does not repeat a short statement as the title-and-statement pair', () => {
    const issue = normalizeIssue({ text: 'Button lacks label', severity: 'HIGH' });
    expect(issue.title).toBe(issue.statement);
    expect(issue.severity).toBe('high');
  });

  it('builds a markdown report without slide labels', () => {
    const report = buildReportMarkdown({
      data: { answer: 'Answer text', issues: [{ text: 'Bad', severity: 'low', slide: 3 } as never], uxCritique: [{ area: 'Nav', issue: 'Busy' }] },
      metadata: { provider: 'anthropic', model: 'm', latencyMs: 4200 },
    });
    expect(report).toContain('_Anthropic · m · 4.2s_');
    expect(report).toContain('### 1. [LOW] Bad');
    expect(report).not.toMatch(/slide/i);
  });
});

describe('error copy', () => {
  it('distinguishes a missing key from a rejected key', () => {
    const missing = describeError('AUTH_ERROR', 'No API key is stored for OpenAI. Add one in Settings > API Keys.', { provider: 'openai' })!;
    expect(missing.title).toBe('No API key set');
    expect(missing.actions).toEqual([{ kind: 'link', label: 'Add API key', href: 'settings.html#api-keys' }]);
    const rejected = describeError('AUTH_ERROR', '401 invalid x-api-key', { provider: 'anthropic' })!;
    expect(rejected.title).toBe('Your API key was rejected');
    expect(rejected.actions.map(action => action.label)).toEqual(['Open API keys', 'Run again']);
  });

  it('says a privacy block was not sent and points to Context settings', () => {
    const blocked = describeError('PRIVACY_BLOCKED', 'Potential sensitive data detected.', { provider: 'openai', model: 'gpt-x' })!;
    expect(blocked.title).toBe('Not sent: possible secret in your context');
    expect(blocked.body).toContain('Nothing was sent to OpenAI');
    expect(blocked.title).not.toMatch(/model/i);
    expect(blocked.actions[0]).toMatchObject({ label: 'Open Context settings', href: 'settings.html#context' });
    expect(describeError('PRIVACY_BLOCKED', 'Context could not be verified.')!.title).toBe("Not sent: context couldn't be checked");
  });

  it('names provider and model and treats capture permission as a capture error', () => {
    expect(describeError('RATE_LIMIT', '', { provider: 'anthropic', retryAfterSeconds: 12 })).toMatchObject({ title: 'Rate limited by Anthropic', retryAfterSeconds: 12 });
    expect(describeError('TIMEOUT', '', { provider: 'openai' })!.title).toBe("Couldn't reach OpenAI");
    expect(describeError('MODEL_ERROR', '', { model: 'gpt-x' })!.actions[0]).toMatchObject({ href: 'settings.html#providers' });
    expect(describeError('MODEL_ERROR', '', { model: 'gpt-x' })!.title).toBe('Model gpt-x rejected the request');
    expect(describeError('AUTH_ERROR', 'Screen recording permission denied. Please enable it.')!.title).toBe('Screen capture failed');
    expect(describeError('VALIDATION_ERROR', '')!.title).toBe("The response couldn't be read");
    expect(describeError('UNKNOWN_ERROR', '')!.title).toBe('Something went wrong');
    expect(describeError('CANCELLED', '')).toBeNull();
  });

  it('resolves retry-after from payload, metadata or message', () => {
    expect(resolveRetryAfter({ retryAfterSeconds: 7.2 })).toBe(8);
    expect(resolveRetryAfter({ metadata: { retryAfterSeconds: 3 } })).toBe(3);
    expect(resolveRetryAfter({ message: 'Please retry after 20 seconds' })).toBe(20);
    expect(resolveRetryAfter({ message: 'nope' })).toBeUndefined();
  });
});

describe('describeShield', () => {
  it('states what the secret check did, counts only', () => {
    expect(describeShield({ status: 'off', found: 0, covered: 0 })).toBe('Off');
    expect(describeShield({ status: 'clean', found: 0, covered: 0 })).toBe('Nothing found');
    expect(describeShield({ status: 'covered', found: 1, covered: 1 })).toBe('1 area covered');
    expect(describeShield({ status: 'covered', found: 2, covered: 3 })).toBe('3 areas covered');
    expect(describeShield({ status: 'sent-uncovered', found: 2, covered: 1 })).toBe('2 found, 1 covered');
    expect(describeShield({ status: 'unchecked', found: 0, covered: 0 })).toBe('Not run (scan unavailable)');
    expect(describeShield({ status: 'unchecked', found: 0, covered: 2 })).toBe('Not run · 2 areas covered by you');
  });
});
