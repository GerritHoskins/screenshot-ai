/**
 * Secret shield: find secrets in text recognized from a screenshot and turn
 * them into pixel boxes to cover. Pure and Electron-free for unit testing.
 */

import { REDACTION_RULES, type RedactionRule } from '../security/redaction';

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  words: OcrWord[];
}

export interface OcrResult {
  lines: OcrLine[];
}

export interface ShieldBox {
  x: number;
  y: number;
  w: number;
  h: number;
  source: 'detected' | 'manual';
  /** Rule that flagged a detected box; never the matched text. */
  rule?: string;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Secrets only: personal-data (pii) rules are out of scope for the shield. */
export const SHIELD_RULES: RedactionRule[] = REDACTION_RULES.filter((rule) => rule.enabled && rule.category !== 'pii');

export const LONG_TOKEN_RULE = 'long-random-token';
const BOX_PADDING = 3;
export const MAX_BOXES = 500;

/** Shannon entropy in bits per character. */
export function shannonEntropy(text: string): number {
  if (!text) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Catches keys the recognizer garbled enough to defeat the format rules:
 * a long run of letters and digits with high entropy.
 */
export function looksLikeRandomToken(text: string): boolean {
  const token = text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (token.length < 32 || /\s/.test(token)) return false;
  if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) return false;
  if (/^https?:/i.test(token)) return false;
  return shannonEntropy(token) >= 3.5;
}

interface Span {
  start: number;
  end: number;
  word: number;
}

/**
 * Join a line's words two ways: with spaces (as read) and without (the
 * recognizer often splits one key into several "words").
 */
function joinWords(words: OcrWord[], separator: string): { text: string; spans: Span[] } {
  let text = '';
  const spans: Span[] = [];
  words.forEach((word, index) => {
    if (index > 0) text += separator;
    spans.push({ start: text.length, end: text.length + word.text.length, word: index });
    text += word.text;
  });
  return { text, spans };
}

function flagWords(words: OcrWord[], rules: RedactionRule[]): Map<number, string> {
  const flagged = new Map<number, string>();
  for (const separator of [' ', '']) {
    const { text, spans } = joinWords(words, separator);
    for (const rule of rules) {
      // Fresh RegExp: the shared rule objects carry lastIndex state.
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        if (match[0].length === 0) {
          pattern.lastIndex++;
          continue;
        }
        const end = match.index + match[0].length;
        for (const span of spans) {
          if (span.end > match.index && span.start < end && !flagged.has(span.word)) flagged.set(span.word, rule.name);
        }
      }
    }
    // Runs of words that only form a long random token once joined.
    if (separator === '') {
      for (let i = 0; i < words.length; i++) {
        let joined = '';
        for (let j = i; j < Math.min(words.length, i + 4); j++) {
          joined += words[j].text;
          if (looksLikeRandomToken(joined)) {
            // Trim leading words (labels like "token:") the token does not need.
            let first = i;
            while (first < j && looksLikeRandomToken(words.slice(first + 1, j + 1).map((w) => w.text).join(''))) first++;
            for (let k = first; k <= j; k++) if (!flagged.has(k)) flagged.set(k, LONG_TOKEN_RULE);
            break;
          }
        }
      }
    }
  }
  return flagged;
}

function clampBox(box: ShieldBox, size: ImageSize): ShieldBox | null {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const right = Math.min(size.width, Math.ceil(box.x + box.w));
  const bottom = Math.min(size.height, Math.ceil(box.y + box.h));
  if (right - x < 1 || bottom - y < 1) return null;
  return { ...box, x, y, w: right - x, h: bottom - y };
}

/** Boxes covering every run of flagged words, padded and clamped to the image. */
export function detectSecrets(ocr: OcrResult, size: ImageSize, rules: RedactionRule[] = SHIELD_RULES): ShieldBox[] {
  const boxes: ShieldBox[] = [];
  for (const line of ocr.lines) {
    const words = line.words.filter((w) => w.text.length > 0);
    const flagged = flagWords(words, rules);
    let i = 0;
    while (i < words.length) {
      if (!flagged.has(i)) { i++; continue; }
      const rule = flagged.get(i);
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      while (i < words.length && flagged.has(i)) {
        const word = words[i];
        left = Math.min(left, word.x);
        top = Math.min(top, word.y);
        right = Math.max(right, word.x + word.w);
        bottom = Math.max(bottom, word.y + word.h);
        i++;
      }
      const box = clampBox({
        x: left - BOX_PADDING,
        y: top - BOX_PADDING,
        w: right - left + 2 * BOX_PADDING,
        h: bottom - top + 2 * BOX_PADDING,
        source: 'detected',
        rule,
      }, size);
      if (box) boxes.push(box);
    }
  }
  return boxes.slice(0, MAX_BOXES);
}

/** Validate boxes that come back from the preview window before they touch pixels. */
export function sanitizeBoxes(value: unknown, size: ImageSize): ShieldBox[] | null {
  if (!Array.isArray(value) || value.length > MAX_BOXES) return null;
  const result: ShieldBox[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { x, y, w, h, source } = item as Record<string, unknown>;
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    if (source !== 'detected' && source !== 'manual') return null;
    const clamped = clampBox({ x: x as number, y: y as number, w: w as number, h: h as number, source }, size);
    if (clamped) result.push(clamped);
  }
  return result;
}

/** Parse untrusted OCR helper output into a well-formed result. */
export function parseOcrOutput(raw: string): OcrResult | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  const lines = (data as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return null;
  const number = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : NaN);
  const parsed: OcrLine[] = [];
  for (const line of lines.slice(0, 5000)) {
    const words = (line as { words?: unknown })?.words;
    if (!Array.isArray(words)) continue;
    const clean: OcrWord[] = [];
    for (const word of words.slice(0, 1000)) {
      const w = word as Record<string, unknown>;
      const entry = { text: typeof w.text === 'string' ? w.text.slice(0, 1000) : '', x: number(w.x), y: number(w.y), w: number(w.w), h: number(w.h) };
      if (entry.text && [entry.x, entry.y, entry.w, entry.h].every(Number.isFinite)) clean.push(entry);
    }
    parsed.push({ words: clean });
  }
  return { lines: parsed };
}
