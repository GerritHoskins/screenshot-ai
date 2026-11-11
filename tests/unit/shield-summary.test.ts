/**
 * shieldCapture's onSummary: one report per sent capture, counts only, none on cancel.
 * Electron, OCR and the review window are faked; the review "user" is scripted per test.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  ocr: vi.fn(),
  /** What the fake review window does once loaded: submit boxes, or cancel with null. */
  review: null as null | ((payload: { boxes: Array<{ x: number; y: number; w: number; h: number; source: string }> }) => unknown[] | null),
  ipc: null as unknown as EventEmitter,
}));

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  mocks.ipc = new Emitter();
  class FakeWindow extends Emitter {
    destroyed = false;
    webContents = {
      send: (channel: string, payload: { boxes: Array<{ x: number; y: number; w: number; h: number; source: string }> }) => {
        if (channel !== 'shield:preview') return;
        const result = mocks.review!(payload);
        setImmediate(() => mocks.ipc.emit(result ? 'shield:submit' : 'shield:cancel', {}, result));
      },
    };
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    show() {}
    focus() {}
    async loadFile() { setImmediate(() => mocks.ipc.emit('shield:ready', {})); }
    async loadURL() { return this.loadFile(); }
  }
  return {
    app: { getPath: () => mocks.userData },
    BrowserWindow: FakeWindow,
    ipcMain: mocks.ipc,
  };
});
vi.mock('../../src/shield/ocr', () => ({ recognizeText: mocks.ocr, isOcrAvailable: () => true }));
vi.mock('../../src/security/ipc-hardening', () => ({
  hardenWindow: vi.fn(),
  isTrustedIpcSender: () => true,
  SECURE_WEB_PREFERENCES: {},
}));

const { shieldCapture } = await import('../../apps/desktop/src/main/shield');

mocks.userData = mkdtempSync(join(tmpdir(), 'shield-summary-'));
afterAll(() => rmSync(mocks.userData, { recursive: true, force: true }));

const png = await sharp({ create: { width: 600, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer();
const secretLine = {
  words: [
    { text: 'password:', x: 10, y: 10, w: 90, h: 20 },
    { text: 'hunter2hunter2', x: 110, y: 10, w: 150, h: 20 },
  ],
};

function settings(shield: { enabled?: boolean; alwaysPreview?: boolean }) {
  writeFileSync(join(mocks.userData, 'settings.json'), JSON.stringify({ shield }));
}

async function capture(agent?: { clientName: string }) {
  const onSummary = vi.fn();
  const result = await shieldCapture(png, { parent: null, agent, onSummary });
  return { result, onSummary };
}

describe('shieldCapture onSummary', () => {
  beforeEach(() => {
    settings({});
    mocks.ocr.mockReset();
    mocks.review = null;
  });

  it('reports off when the shield is disabled', async () => {
    settings({ enabled: false });
    const { result, onSummary } = await capture();
    expect(result).toBe(png);
    expect(onSummary).toHaveBeenCalledExactlyOnceWith({ status: 'off', found: 0, covered: 0 });
    expect(mocks.ocr).not.toHaveBeenCalled();
  });

  it('reports clean when the scan finds nothing', async () => {
    mocks.ocr.mockResolvedValue({ status: 'ok', result: { lines: [] }, ms: 5 });
    const { result, onSummary } = await capture();
    expect(result).toBe(png);
    expect(onSummary).toHaveBeenCalledExactlyOnceWith({ status: 'clean', found: 0, covered: 0 });
  });

  it('reports unchecked when OCR is unavailable', async () => {
    mocks.ocr.mockResolvedValue({ status: 'unavailable' });
    const { onSummary } = await capture();
    expect(onSummary).toHaveBeenCalledExactlyOnceWith({ status: 'unchecked', found: 0, covered: 0 });
  });

  it('reports covered when every finding stays covered', async () => {
    mocks.ocr.mockResolvedValue({ status: 'ok', result: { lines: [secretLine] }, ms: 5 });
    mocks.review = (payload) => payload.boxes;
    const { result, onSummary } = await capture();
    expect(result).not.toBe(png);
    expect(onSummary).toHaveBeenCalledExactlyOnceWith({ status: 'covered', found: 1, covered: 1 });
  });

  it('reports sent-uncovered when the user uncovers a finding', async () => {
    mocks.ocr.mockResolvedValue({ status: 'ok', result: { lines: [secretLine] }, ms: 5 });
    mocks.review = () => [];
    const { onSummary } = await capture();
    expect(onSummary).toHaveBeenCalledExactlyOnceWith({ status: 'sent-uncovered', found: 1, covered: 0 });
  });

  it('counts areas the user covers on an agent capture where nothing was found', async () => {
    mocks.ocr.mockResolvedValue({ status: 'ok', result: { lines: [] }, ms: 5 });
    mocks.review = () => [{ x: 1, y: 1, w: 20, h: 20, source: 'manual' }, { x: 40, y: 1, w: 20, h: 20, source: 'manual' }];
    const { onSummary } = await capture({ clientName: 'agent' });
    expect(onSummary).toHaveBeenCalledExactlyOnceWith({ status: 'covered', found: 0, covered: 2 });
  });

  it('reports nothing when the user cancels', async () => {
    mocks.ocr.mockResolvedValue({ status: 'ok', result: { lines: [secretLine] }, ms: 5 });
    mocks.review = () => null;
    const { result, onSummary } = await capture();
    expect(result).toBeNull();
    expect(onSummary).not.toHaveBeenCalled();
  });
});
