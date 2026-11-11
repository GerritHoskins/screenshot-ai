/**
 * Secret shield (desktop): scan each capture for secrets on this machine and,
 * when needed, let the user review covered areas before anything is sent.
 * Agent captures always go through the review window, which doubles as the
 * approval step.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from '@logging';
import { hardenWindow, isTrustedIpcSender, SECURE_WEB_PREFERENCES } from '@security/ipc-hardening';
import { REDACTION_RULES } from '@security/redaction';
import { detectSecrets, sanitizeBoxes, LONG_TOKEN_RULE, type ShieldBox } from '@/shield/detect';
import { recognizeText, isOcrAvailable } from '@/shield/ocr';
import { applyRedactions, getImageSize } from '@/shield/redact';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = path.join(__dirname, '../renderer');
const logger = getLogger();

export interface ShieldSettings {
  /** On by default: only an explicit `false` turns it off. */
  enabled: boolean;
  /** Show the review window for every capture, not only when something is found. */
  alwaysPreview: boolean;
}

export interface ShieldRequest {
  parent: BrowserWindow | null;
  /** Present for captures an agent asked for. */
  agent?: { clientName: string; reason?: string };
}

export type ShieldNotice = 'none' | 'scan-failed' | 'scan-unavailable' | 'shield-off';

/** What the review window receives. Labels only; matched text never leaves the main process. */
export interface ShieldPreviewPayload {
  dataUrl: string;
  width: number;
  height: number;
  boxes: Array<ShieldBox & { label: string }>;
  notice: ShieldNotice;
  agent?: { clientName: string; reason?: string };
}

export function readShieldSettings(): ShieldSettings {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return { enabled: raw?.shield?.enabled !== false, alwaysPreview: raw?.shield?.alwaysPreview === true };
    }
  } catch (error) {
    logger.warn('shield', 'Failed to read shield settings', error instanceof Error ? error : undefined);
  }
  return { enabled: true, alwaysPreview: false };
}

export function getShieldStatus(): ShieldSettings & { ocrAvailable: boolean; platform: NodeJS.Platform } {
  return { ...readShieldSettings(), ocrAvailable: isOcrAvailable(), platform: process.platform };
}

const CATEGORY_LABELS: Record<string, string> = {
  'api-keys': 'API key',
  credentials: 'Password or token',
  cloud: 'Cloud access token',
};

function labelFor(rule: string | undefined): string {
  if (rule === LONG_TOKEN_RULE) return 'Random-looking token';
  const category = REDACTION_RULES.find((r) => r.name === rule)?.category;
  return (category && CATEGORY_LABELS[category]) ?? 'Possible secret';
}

/**
 * Returns the PNG to send (covered where the user chose), or null when the
 * user cancelled. Without an agent and with nothing found, returns the
 * capture unchanged and shows nothing.
 */
export async function shieldCapture(png: Buffer, request: ShieldRequest): Promise<Buffer | null> {
  const settings = readShieldSettings();
  if (!settings.enabled && !request.agent) return png;

  let boxes: ShieldBox[] = [];
  let notice: ShieldNotice = settings.enabled ? 'none' : 'shield-off';
  const size = await getImageSize(png);

  if (settings.enabled) {
    const outcome = await recognizeText(png);
    if (outcome.status === 'ok') {
      boxes = detectSecrets(outcome.result, size);
      logger.info('shield', 'Capture scanned', { ms: outcome.ms, found: boxes.length });
    } else if (outcome.status === 'unavailable') {
      notice = 'scan-unavailable';
    } else {
      notice = 'scan-failed';
      logger.warn('shield', 'Capture scan failed', { reason: outcome.reason });
    }
  }

  // Nothing to review: no agent, nothing found, scan completed (or unavailable) and no always-preview.
  const scanFailed = notice === 'scan-failed';
  if (!request.agent && boxes.length === 0 && !scanFailed && !settings.alwaysPreview) return png;

  const decision = await openPreview({
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width: size.width,
    height: size.height,
    boxes: boxes.map((box) => ({ ...box, label: labelFor(box.rule) })),
    notice,
    agent: request.agent,
  }, request.parent);

  if (!decision) {
    logger.info('shield', 'Capture review cancelled', { agent: !!request.agent });
    return null;
  }
  const finalBoxes = sanitizeBoxes(decision, size);
  if (!finalBoxes) {
    logger.warn('shield', 'Rejected malformed review result');
    return null;
  }
  logger.info('shield', 'Capture review sent', {
    agent: !!request.agent,
    covered: finalBoxes.length,
    manual: finalBoxes.filter((b) => b.source === 'manual').length,
    uncovered: boxes.length - finalBoxes.filter((b) => b.source === 'detected').length,
  });
  return applyRedactions(png, finalBoxes);
}

async function openPreview(payload: ShieldPreviewPayload, parent: BrowserWindow | null): Promise<unknown[] | null> {
  // Fit the image into a comfortable window; the page scales it further if needed.
  const scale = Math.min(1, 1000 / payload.width, 640 / payload.height);
  const window = new BrowserWindow({
    width: Math.max(560, Math.round(payload.width * scale) + 48),
    height: Math.max(420, Math.round(payload.height * scale) + 200),
    minWidth: 480,
    minHeight: 360,
    title: payload.agent ? 'Review capture for agent' : 'Review capture',
    parent: parent ?? undefined,
    alwaysOnTop: true,
    minimizable: false,
    show: false,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, '../preload/shield.js'),
    },
  });
  hardenWindow(window, rendererDirectory, ['shield.html']);

  const result = new Promise<unknown[] | null>((resolve) => {
    const cleanup = () => {
      ipcMain.removeListener('shield:submit', onSubmit);
      ipcMain.removeListener('shield:cancel', onCancel);
      ipcMain.removeListener('shield:ready', onReady);
      window.removeListener('closed', onClosed);
      if (!window.isDestroyed()) window.close();
    };
    const trusted = (event: Electron.IpcMainEvent) => isTrustedIpcSender(event, rendererDirectory, ['shield.html'], window);
    const onReady = (event: Electron.IpcMainEvent) => {
      if (trusted(event)) window.webContents.send('shield:preview', payload);
    };
    const onSubmit = (event: Electron.IpcMainEvent, boxes: unknown) => {
      if (!trusted(event)) return;
      cleanup();
      resolve(Array.isArray(boxes) ? boxes : null);
    };
    const onCancel = (event: Electron.IpcMainEvent) => {
      if (!trusted(event)) return;
      cleanup();
      resolve(null);
    };
    const onClosed = () => { cleanup(); resolve(null); };
    ipcMain.on('shield:ready', onReady);
    ipcMain.on('shield:submit', onSubmit);
    ipcMain.on('shield:cancel', onCancel);
    window.once('closed', onClosed);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/shield.html`);
  } else {
    await window.loadFile(path.join(rendererDirectory, 'shield.html'));
  }
  window.show();
  window.focus();
  return result;
}
