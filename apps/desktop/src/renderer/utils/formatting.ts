/**
 * Text formatting utilities for the main window.
 *
 * Everything here is pure (no DOM access) so it can be unit tested. Any value
 * that came from a model or from IPC is escaped before markup is added.
 */

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

// ============================================================================
// Icons
// ============================================================================

const ICON_PATHS: Record<string, string> = {
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  'sticky-note': '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
};

/** Inline SVG icon (24 viewBox, 1.75 stroke in currentColor). Decorative: always aria-hidden. */
export function icon(name: keyof typeof ICON_PATHS | string, extraClass = ''): string {
  const className = extraClass ? `icon ${extraClass}` : 'icon';
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] ?? ''}</svg>`;
}

// ============================================================================
// Markdown subset
// ============================================================================

type MarkdownBlock =
  | { kind: 'p'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'ul' | 'ol'; items: string[]; start: number }
  | { kind: 'code'; lang: string; code: string };

/** Inline markdown: `code`, **bold** and __bold__. Code spans are never reformatted. */
export function formatInline(text: string): string {
  // Swap code spans for placeholders first so emphasis can wrap them (e.g. **`x` is `null`**)
  // without the emphasis rules ever touching code contents.
  const mark = ''; // private-use code point; stripped from input so it can't be forged
  const spans: string[] = [];
  const masked = text.split(/(`[^`\n]+`)/g).map((segment, index) => {
    if (index % 2 === 0) return escapeHtml(segment.split(mark).join(''));
    spans.push(`<code class="inline-code">${escapeHtml(segment.slice(1, -1))}</code>`);
    return `${mark}${spans.length - 1}${mark}`;
  }).join('');
  return masked
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]+?)__/g, '<strong>$1</strong>')
    .replace(new RegExp(`${mark}(\\d+)${mark}`, 'g'), (_, i: string) => spans[Number(i)]);
}

/** A code block as the DOM contract describes it; the language label is omitted when unknown. */
export function renderCodeBlock(code: unknown, language?: unknown): string {
  const lang = String(language ?? '').trim();
  const label = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
  return `<div class="code-block">${label}<pre><code>${escapeHtml(code)}</code></pre></div>`;
}

/** Split text into paragraphs, headings, lists and fenced code blocks. */
export function parseMarkdownBlocks(text: unknown): MarkdownBlock[] {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: { kind: 'p'; lines: string[] } | null = null;
  let list: { kind: 'ul' | 'ol'; items: string[]; start: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/.exec(line);
    if (fence) {
      paragraph = null;
      list = null;
      const closing = new RegExp(`^\\s{0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      const body: string[] = [];
      while (i + 1 < lines.length && !closing.test(lines[i + 1])) body.push(lines[++i]);
      i++; // skip the closing fence (or run past the end when it is missing)
      while (body.length && !body[0].trim()) body.shift();
      while (body.length && !body[body.length - 1].trim()) body.pop();
      blocks.push({ kind: 'code', lang: fence[2], code: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      paragraph = null;
      list = null;
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      paragraph = null;
      list = null;
      blocks.push({ kind: 'heading', text: heading[1] });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = bullet ? null : /^\s*(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        paragraph = null;
        list = { kind, items: [], start: ordered ? Number(ordered[1]) : 1 };
        blocks.push(list);
      }
      list.items.push(bullet ? bullet[1] : ordered![2]);
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (!paragraph) {
      list = null;
      paragraph = { kind: 'p', lines: [] };
      blocks.push(paragraph);
    }
    paragraph.lines.push(line.trim());
  }
  return blocks;
}

function renderParagraphContent(block: { lines: string[] }): string {
  return block.lines.map(formatInline).join('<br>');
}

function renderBlock(block: MarkdownBlock): string {
  switch (block.kind) {
    case 'p':
      return `<p>${renderParagraphContent(block)}</p>`;
    case 'heading':
      return `<p><strong>${formatInline(block.text)}</strong></p>`;
    case 'ul':
    case 'ol': {
      const start = block.kind === 'ol' && block.start !== 1 ? ` start="${block.start}"` : '';
      return `<${block.kind}${start}>${block.items.map(item => `<li>${formatInline(item)}</li>`).join('')}</${block.kind}>`;
    }
    case 'code':
      return renderCodeBlock(block.code, block.lang);
  }
}

/**
 * Format untrusted model text as limited, escaped HTML: fenced code blocks
 * (`.code-block`, optional `.code-lang`), inline code, bold, bullet and
 * numbered lists, and paragraphs. A lone paragraph is returned as inline HTML
 * without a `<p>` wrapper so callers can place it inside their own element.
 */
export function formatAnswer(text: unknown): string {
  const blocks = parseMarkdownBlocks(text);
  if (blocks.length === 1 && blocks[0].kind === 'p') return renderParagraphContent(blocks[0]);
  return blocks.map(renderBlock).join('');
}

/** Split formatted text into the lead (first paragraph, inline HTML) and the remaining blocks. */
export function formatAnswerParts(text: unknown): { lead: string; body: string } {
  const blocks = parseMarkdownBlocks(text);
  if (blocks[0]?.kind === 'p') {
    return { lead: renderParagraphContent(blocks[0]), body: blocks.slice(1).map(renderBlock).join('') };
  }
  return { lead: '', body: blocks.map(renderBlock).join('') };
}

// ============================================================================
// Analysis data helpers
// ============================================================================

export function normalizeSeverity(value: unknown): 'high' | 'medium' | 'low' {
  const severity = String(value ?? '').toLowerCase();
  return severity === 'high' || severity === 'low' ? severity : 'medium';
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Accepts 0–1 or a 0–100 percentage; returns null for anything else. */
export function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value;
  return value <= 100 ? value / 100 : null;
}

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.8) return 'high';
  return confidence >= 0.5 ? 'medium' : 'low';
}

export function providerLabel(provider: unknown): string {
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'openai') return 'OpenAI';
  return '';
}

export function formatSeconds(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
}

export function formatTokens(promptTokens: number, completionTokens: number, locale?: string): string {
  return `${promptTokens.toLocaleString(locale)} in · ${completionTokens.toLocaleString(locale)} out`;
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
  const truncated = statement.substring(0, maxLength);
  const lastBreak = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
  if (lastBreak > maxLength * 0.7) return statement.substring(0, lastBreak + 1);
  return `${truncated.trimEnd()}…`;
}

export interface NormalizedIssue {
  type: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  statement: string;
  details: string;
  evidence: string;
  suggestion: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const firstText = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return '';
};

export function normalizeIssue(issue: unknown): NormalizedIssue {
  if (typeof issue !== 'object' || issue === null) {
    const statement = text(issue) || 'Issue detected';
    return { type: 'Issue', severity: 'medium', title: deriveIssueTitle(statement), statement, details: '', evidence: '', suggestion: '' };
  }
  const source = issue as Record<string, unknown>;
  const statement = firstText(source, ['risk', 'text', 'message', 'issue', 'problem', 'content', 'description', 'summary', 'note', 'comment', 'title', 'name', 'label']) || 'Issue detected';
  const title = text(source.title) || deriveIssueTitle(statement);
  const details = firstText(source, ['details', 'explanation', 'description']);
  return {
    type: firstText(source, ['type', 'category']) || 'Issue',
    severity: normalizeSeverity(source.severity),
    title,
    statement,
    details: details === statement || details === title ? '' : details,
    evidence: firstText(source, ['evidence', 'proof', 'location']),
    suggestion: firstText(source, ['suggestion', 'fix', 'recommendation', 'recommendedFix']),
  };
}

export interface NormalizedNote {
  area: string;
  issue: string;
  suggestion: string;
}

export function normalizeNote(item: unknown): NormalizedNote {
  if (typeof item !== 'object' || item === null) return { area: '', issue: String(item ?? ''), suggestion: '' };
  const source = item as Record<string, unknown>;
  return {
    area: firstText(source, ['area', 'category']),
    issue: firstText(source, ['issue', 'problem', 'text', 'message', 'note', 'comment', 'description', 'summary', 'content', 'title']) || 'Note',
    suggestion: firstText(source, ['suggestion', 'recommendation']),
  };
}

export interface AnswerParts {
  question: string;
  response: string;
  explanation: string;
}

/** Accepts the legacy string answer and the `{ detected, question, response, explanation }` object. */
export function extractAnswer(answer: unknown): AnswerParts {
  if (typeof answer === 'string') return { question: '', response: answer.trim(), explanation: '' };
  if (typeof answer !== 'object' || answer === null) return { question: '', response: '', explanation: '' };
  const source = answer as Record<string, unknown>;
  return { question: text(source.question), response: text(source.response), explanation: text(source.explanation) };
}

/** Summary as plain text: strings stay as-is, arrays become "- " lines, objects use their text field. */
export function summaryToText(summary: unknown): string {
  if (typeof summary === 'string') return summary.trim();
  if (Array.isArray(summary)) {
    return summary
      .map(item => (typeof item === 'string' ? item : text((item as Record<string, unknown>)?.text) || text((item as Record<string, unknown>)?.content)))
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => `- ${item}`)
      .join('\n');
  }
  if (typeof summary === 'object' && summary !== null) {
    const source = summary as Record<string, unknown>;
    return firstText(source, ['text', 'content', 'description', 'summary'])
      || Object.entries(source).filter(([, value]) => text(value)).map(([key, value]) => `${key}: ${text(value)}`).join('\n');
  }
  return '';
}

function fenceFor(content: string): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map(run => run.length));
  return '`'.repeat(longest + 1);
}

interface ReportInput {
  data?: {
    answer?: unknown;
    summary?: unknown;
    issues?: unknown[];
    uxCritique?: unknown[];
    text?: unknown;
    codeBlocks?: Array<{ language?: string; code: string }>;
  };
  metadata?: { provider?: string; model?: string; latencyMs?: number };
}

/** Full report as Markdown, used for "Copy report" and "Save Markdown file". */
export function buildReportMarkdown(response: ReportInput): string {
  const data = response.data ?? {};
  const meta = response.metadata;
  const parts: string[] = ['# Screenshot analysis'];
  const metaLine = [providerLabel(meta?.provider) || meta?.provider, meta?.model, typeof meta?.latencyMs === 'number' ? formatSeconds(meta.latencyMs) : '']
    .filter(Boolean).join(' · ');
  if (metaLine) parts.push(`_${metaLine}_`);

  const answer = extractAnswer(data.answer);
  if (answer.question) parts.push(`## Question\n\n${answer.question}`);
  if (answer.response) parts.push(`## Answer\n\n${answer.response}${answer.explanation ? `\n\n${answer.explanation}` : ''}`);
  const summary = summaryToText(data.summary);
  if (summary) parts.push(`## Summary\n\n${summary}`);

  const issues = (data.issues ?? []).map(normalizeIssue);
  if (issues.length) {
    parts.push(`## Issues (${issues.length})`);
    issues.forEach((issue, index) => {
      const lines = [`### ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title}`];
      if (issue.statement !== issue.title) lines.push(issue.statement);
      if (issue.details) lines.push(issue.details);
      if (issue.evidence) lines.push(`**Evidence:** ${issue.evidence}`);
      if (issue.suggestion) lines.push(`**Suggested fix:** ${issue.suggestion}`);
      parts.push(lines.join('\n\n'));
    });
  }

  const notes = (data.uxCritique ?? []).map(normalizeNote);
  if (notes.length) {
    parts.push(`## Notes (${notes.length})`);
    notes.forEach(note => {
      const lines = note.area ? [`### ${note.area}`, note.issue] : [`- ${note.issue}`];
      if (note.suggestion) lines.push(`**Suggestion:** ${note.suggestion}`);
      parts.push(lines.join('\n\n'));
    });
  }

  const extracted = text(data.text);
  if (extracted) {
    const fence = fenceFor(extracted);
    parts.push(`## Extracted text\n\n${fence}text\n${extracted}\n${fence}`);
  }
  for (const block of data.codeBlocks ?? []) {
    if (!block?.code) continue;
    const fence = fenceFor(block.code);
    parts.push(`${fence}${/^[\w+#.-]+$/.test(block.language ?? '') ? block.language : ''}\n${block.code}\n${fence}`);
  }
  return `${parts.join('\n\n')}\n`;
}

export function formatIssueText(issue: NormalizedIssue): string {
  const lines = [`[${issue.severity.toUpperCase()}] ${issue.type}: ${issue.title}`];
  if (issue.statement !== issue.title) lines.push(issue.statement);
  if (issue.details) lines.push(issue.details);
  if (issue.evidence) lines.push(`Evidence: ${issue.evidence}`);
  if (issue.suggestion) lines.push(`Suggested fix: ${issue.suggestion}`);
  return lines.join('\n\n');
}

// ============================================================================
// Error copy
// ============================================================================

export type ErrorAction =
  | { kind: 'retry' | 'capture'; label: string }
  | { kind: 'link'; label: string; href: string };

export interface ErrorCopy {
  title: string;
  body: string;
  actions: ErrorAction[];
  retryAfterSeconds?: number;
}

export interface ErrorContext {
  provider?: string;
  model?: string;
  retryAfterSeconds?: number;
}

const TRY_AGAIN: ErrorAction = { kind: 'retry', label: 'Try again' };
const CAPTURE_AGAIN: ErrorAction = { kind: 'capture', label: 'Capture again' };

/** Provider retry delay from the payload, its metadata, or a "retry after N seconds" message. */
export function resolveRetryAfter(payload: { message?: unknown; retryAfterSeconds?: unknown; metadata?: unknown }): number | undefined {
  const metadata = payload.metadata as Record<string, unknown> | undefined;
  const candidates = [payload.retryAfterSeconds, metadata?.retryAfterSeconds];
  const match = /(?:retry|try again)\D{0,20}(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/i.exec(String(payload.message ?? ''));
  if (match) candidates.push(Number(match[1]));
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.min(Math.ceil(value), 3600);
  }
  return undefined;
}

/** Plain-language title, body and next actions for an `analysis:error` payload. Null means "show no error". */
export function describeError(code: string, message: string, context: ErrorContext = {}): ErrorCopy | null {
  const name = providerLabel(context.provider);
  const provider = name || 'your AI provider';
  const Provider = name || 'The AI provider';
  const model = context.model && context.model !== 'unknown' ? context.model : '';
  const raw = String(message ?? '');

  if (code === 'CANCELLED') return null;

  if (code === 'CAPTURE_ERROR' || /screen (recording|capture)|no screen sources|capture failed/i.test(raw)) {
    return {
      title: 'Screen capture failed',
      body: raw || 'The screen could not be captured. Check screen recording permissions, then try again.',
      actions: [CAPTURE_AGAIN],
    };
  }

  switch (code) {
    case 'AUTH_ERROR': {
      const missing = /no api key|missing|not set|not configured/i.test(raw);
      return {
        title: missing ? 'No API key set' : 'Your API key was rejected',
        body: missing
          ? `Add an API key for ${provider} in Settings to analyze screenshots.`
          : `${Provider} did not accept the stored API key. Check that it is correct and still active.`,
        // Retrying can't fix a missing key, so the only action is the one that can.
        actions: missing
          ? [{ kind: 'link', label: 'Add API key', href: 'settings.html#api-keys' }]
          : [{ kind: 'link', label: 'Open API keys', href: 'settings.html#api-keys' }, TRY_AGAIN],
      };
    }
    case 'RATE_LIMIT':
      return {
        title: `Rate limited by ${name || 'the AI provider'}`,
        body: context.retryAfterSeconds
          ? `${Provider} asked for a pause of ${context.retryAfterSeconds} seconds before the next request.`
          : `${Provider} is receiving too many requests for this key. Wait a moment, then try again.`,
        actions: [TRY_AGAIN],
        retryAfterSeconds: context.retryAfterSeconds,
      };
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return {
        title: `Couldn't reach ${provider}`,
        body: code === 'TIMEOUT'
          ? 'The request timed out. Check your connection, then try again.'
          : 'Check your internet connection or proxy settings, then try again.',
        actions: [TRY_AGAIN],
      };
    case 'CONTENT_FILTERED':
      return {
        title: `${Provider} declined this image`,
        body: "The provider's safety filter blocked this request. Capture a different region to continue.",
        actions: [CAPTURE_AGAIN],
      };
    case 'PARSE_ERROR':
    case 'INVALID_RESPONSE':
    case 'VALIDATION_ERROR':
      return {
        title: "The response couldn't be read",
        body: `${Provider} returned a response in an unexpected format. Running it again usually helps.`,
        actions: [TRY_AGAIN],
      };
    case 'PRIVACY_BLOCKED': {
      const unverified = /could not be verified/i.test(raw);
      return {
        title: unverified ? "Not sent: context couldn't be checked" : 'Not sent: possible secret in your context',
        body: unverified
          ? `Workspace context couldn't be scanned for secrets, so nothing was sent to ${provider}. Check the context sources, or turn workspace context off.`
          : `Something that looks like a secret was found in your workspace context or custom prompt. Nothing was sent to ${provider}. Remove it, exclude the file, or turn workspace context off.`,
        actions: [{ kind: 'link', label: 'Open Context settings', href: 'settings.html#context' }, TRY_AGAIN],
      };
    }
    case 'INVALID_REQUEST':
    case 'MODEL_ERROR':
      return {
        title: model ? `Model ${model} rejected the request` : 'The model rejected the request',
        body: `Check that the model is available to your ${provider} account, or choose a different one.`,
        actions: [{ kind: 'link', label: 'Change model', href: 'settings.html#providers' }, TRY_AGAIN],
      };
    default:
      return {
        title: 'Something went wrong',
        body: 'The analysis did not finish. Try again; if it keeps happening, Settings > Diagnostics opens the logs.',
        actions: [TRY_AGAIN],
      };
  }
}
