/**
 * Secret shield: detection, box validation, redaction and native OCR.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  detectSecrets,
  sanitizeBoxes,
  parseOcrOutput,
  looksLikeRandomToken,
  SHIELD_RULES,
  LONG_TOKEN_RULE,
  MAX_BOXES,
  type OcrWord,
} from '../../src/shield/detect';
import { applyRedactions, getImageSize } from '../../src/shield/redact';
import { recognizeText, isOcrAvailable } from '../../src/shield/ocr';

const SIZE = { width: 900, height: 220 };
let cursor = 0;
const word = (text: string, x?: number, y = 40): OcrWord => {
  const left = x ?? cursor;
  cursor = left + text.length * 10 + 8;
  return { text, x: left, y, w: text.length * 10, h: 20 };
};
const line = (...words: OcrWord[]) => { cursor = 0; return { words }; };

describe('detectSecrets', () => {
  it('excludes personal-data rules', () => {
    expect(SHIELD_RULES.some((r) => r.category === 'pii')).toBe(false);
    expect(SHIELD_RULES.some((r) => r.name === 'openai-key')).toBe(true);
  });

  it('finds a key the recognizer split across several words', () => {
    cursor = 0;
    const words = [word('token:'), word('sk-proj'), word('-abcdEFGHijk1MNOPqrstUVWX1234')];
    const boxes = detectSecrets({ lines: [{ words }] }, SIZE);
    expect(boxes).toHaveLength(1);
    // Covers the split key words, not the harmless label word.
    expect(boxes[0].x).toBe(words[1].x - 3);
    expect(boxes[0].x + boxes[0].w).toBe(words[2].x + words[2].w + 3);
    expect(boxes[0]).toMatchObject({ source: 'detected', rule: 'openai-key' });
  });

  it('covers password values and leaves ordinary text alone', () => {
    cursor = 0;
    const secretLine = { words: [word('db'), word('password:'), word('hunter22secret')] };
    cursor = 0;
    const plainLine = { words: [word('Nothing', undefined, 120), word('secret', undefined, 120), word('here', undefined, 120)] };
    const boxes = detectSecrets({ lines: [secretLine, plainLine] }, SIZE);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].rule).toBe('password-field');
    expect(boxes[0].x).toBe(secretLine.words[1].x - 3);
  });

  it('does not flag emails (personal data is out of scope)', () => {
    expect(detectSecrets({ lines: [line(word('mail'), word('me@example.com'))] }, SIZE)).toEqual([]);
  });

  it('flags long random tokens that no format rule recognizes', () => {
    expect(looksLikeRandomToken('a8F3kQ9zL2mX7pR4tY6wB1nC5vD0hJ3s')).toBe(true);
    expect(looksLikeRandomToken('thisisjustaverylongwordwithoutdigits')).toBe(false);
    expect(looksLikeRandomToken('https://example.com/a8F3kQ9zL2mX7pR4tY6wB1')).toBe(false);
    const boxes = detectSecrets({ lines: [line(word('token'), word('a8F3kQ9zL2mX7pR4'), word('tY6wB1nC5vD0hJ3s'))] }, SIZE);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].rule).toBe(LONG_TOKEN_RULE);
  });

  it('clamps boxes to the image', () => {
    const boxes = detectSecrets({ lines: [{ words: [{ text: 'sk-ant-abcdefghijklmnopqrstuvwxyz', x: 880, y: 210, w: 300, h: 20 }] }] }, SIZE);
    expect(boxes[0].x + boxes[0].w).toBeLessThanOrEqual(SIZE.width);
    expect(boxes[0].y + boxes[0].h).toBeLessThanOrEqual(SIZE.height);
  });
});

describe('sanitizeBoxes', () => {
  it('accepts well-formed boxes and clamps them', () => {
    expect(sanitizeBoxes([{ x: -5, y: 10, w: 50, h: 20, source: 'manual' }], SIZE)).toEqual([{ x: 0, y: 10, w: 45, h: 20, source: 'manual' }]);
  });

  it('rejects malformed input', () => {
    expect(sanitizeBoxes('nope', SIZE)).toBeNull();
    expect(sanitizeBoxes([{ x: 'a', y: 0, w: 1, h: 1, source: 'manual' }], SIZE)).toBeNull();
    expect(sanitizeBoxes([{ x: 0, y: 0, w: 1, h: 1, source: 'evil' }], SIZE)).toBeNull();
    expect(sanitizeBoxes(new Array(MAX_BOXES + 1).fill({ x: 0, y: 0, w: 1, h: 1, source: 'manual' }), SIZE)).toBeNull();
  });

  it('drops boxes that fall entirely outside the image', () => {
    expect(sanitizeBoxes([{ x: 2000, y: 0, w: 10, h: 10, source: 'manual' }], SIZE)).toEqual([]);
  });
});

describe('parseOcrOutput', () => {
  it('keeps valid words and drops malformed ones', () => {
    const parsed = parseOcrOutput(JSON.stringify({ lines: [{ words: [{ text: 'ok', x: 1, y: 2, w: 3, h: 4 }, { text: 'bad', x: 'x' }] }] }));
    expect(parsed).toEqual({ lines: [{ words: [{ text: 'ok', x: 1, y: 2, w: 3, h: 4 }] }] });
    expect(parseOcrOutput('not json')).toBeNull();
    expect(parseOcrOutput('{"lines": 5}')).toBeNull();
  });
});

async function samplePng(): Promise<Buffer> {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220"><rect width="100%" height="100%" fill="#1e1e1e"/>'
    + '<text x="20" y="60" font-family="Consolas" font-size="22" fill="#d4d4d4">OPENAI_API_KEY=sk-proj-abcdEFGHijklMNOPqrstUVWX1234</text>'
    + '<text x="20" y="120" font-family="Consolas" font-size="22" fill="#d4d4d4">db password: hunter22secret</text>'
    + '<text x="20" y="180" font-family="Segoe UI" font-size="22" fill="#d4d4d4">Nothing secret on this line</text></svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('applyRedactions', () => {
  it('paints boxes solid black and leaves other pixels alone', async () => {
    const png = await samplePng();
    const out = await applyRedactions(png, [{ x: 10, y: 10, w: 20, h: 20, source: 'manual' }]);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    expect(pixel(15, 15)).toEqual([0, 0, 0]);
    expect(pixel(5, 5)).toEqual([30, 30, 30]);
    expect(await getImageSize(out)).toEqual({ width: 900, height: 220 });
  });

  it('returns the original image when there is nothing to cover', async () => {
    const png = await samplePng();
    expect(await applyRedactions(png, [])).toBe(png);
  });
});

describe('recognizeText', () => {
  it('reports Linux as unavailable', async () => {
    expect(isOcrAvailable('linux')).toBe(false);
    expect(await recognizeText(Buffer.from('x'), 'linux')).toEqual({ status: 'unavailable' });
  });

  it.runIf(process.platform === 'win32')('finds the key and password in a real image with Windows OCR', async () => {
    const png = await samplePng();
    const outcome = await recognizeText(png);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const boxes = detectSecrets(outcome.result, await getImageSize(png));
    // One box on the key line (label included is fine), one on the password line, none on the third.
    expect(boxes).toHaveLength(2);
    expect(boxes[0].y).toBeLessThan(80);
    expect(boxes[0].x + boxes[0].w).toBeGreaterThan(600); // reaches the end of the key
    expect(boxes[1].rule).toBe('password-field');
    expect(boxes.every((b) => b.y < 150)).toBe(true);
  }, 20_000);

  it.runIf(process.platform === 'win32')('fails safely on an unreadable image', async () => {
    const outcome = await recognizeText(Buffer.from('not a png'));
    expect(outcome.status).toBe('failed');
  }, 20_000);
});
