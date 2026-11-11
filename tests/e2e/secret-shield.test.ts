import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { Page } from 'playwright-core';
import { cleanup, launchApp, type TestApp } from './setup';

const dist = resolve(import.meta.dirname, '../../dist');

/** Settings > Privacy: the shield options persist to settings.json. */
describe('Built desktop privacy settings', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await launchApp();
    await app.page.goto(pathToFileURL(join(dist, 'renderer/settings.html')).href);
    await app.page.waitForFunction(() => window.api?.settings !== undefined);
    await app.page.locator('.nav-item[data-tab="privacy"]').click();
    await app.page.locator('#shield-engine').filter({ hasNotText: 'Loading' }).waitFor();
  }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  const saved = () => JSON.parse(readFileSync(join(app.profile, 'settings.json'), 'utf8')).shield;

  it('starts on, with review only when something is found', async () => {
    expect(await app.page.locator('#shield-enabled').isChecked()).toBe(true);
    expect(await app.page.locator('#shield-always-preview').isChecked()).toBe(false);
  });

  it('saves both options', async () => {
    await app.page.locator('#shield-always-preview').check();
    await expect.poll(() => saved()?.alwaysPreview).toBe(true);
    await app.page.locator('#shield-enabled').uncheck();
    await app.page.locator('#shield-engine').filter({ hasText: 'Off' }).waitFor();
    expect(saved()).toEqual({ enabled: false, alwaysPreview: true });
  });
});

/** The review window: detected boxes start covered, can be uncovered, and drags add manual boxes. */
describe('Built desktop capture review window', () => {
  let app: TestApp;
  let review: Page;

  const openReview = async (agent?: { clientName: string; reason?: string }) => {
    const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const payload = {
      dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: 400, height: 200, notice: 'none',
      boxes: [{ x: 20, y: 20, w: 120, h: 20, source: 'detected', label: 'API key' }],
      agent,
    };
    const opened = app.application.waitForEvent('window');
    await app.application.evaluate(({ BrowserWindow, ipcMain }, args) => {
      const state = globalThis as unknown as { shieldResult?: unknown };
      state.shieldResult = undefined;
      ipcMain.removeAllListeners('shield:ready');
      ipcMain.removeAllListeners('shield:submit');
      ipcMain.removeAllListeners('shield:cancel');
      ipcMain.on('shield:ready', (event) => event.sender.send('shield:preview', args.payload));
      ipcMain.on('shield:submit', (_event, boxes) => { state.shieldResult = { boxes }; });
      ipcMain.on('shield:cancel', () => { state.shieldResult = 'cancelled'; });
      const window = new BrowserWindow({
        width: 700, height: 500,
        webPreferences: { preload: args.preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      void window.loadFile(args.html);
    }, { payload, preload: join(dist, 'preload/shield.js'), html: join(dist, 'renderer/shield.html') });
    review = await opened;
    await review.locator('.box').first().waitFor();
  };

  const result = () => app.application.evaluate(() => (globalThis as unknown as { shieldResult?: unknown }).shieldResult);

  beforeAll(async () => { app = await launchApp(); }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  it('sends covered boxes, including one drawn by the user', async () => {
    await openReview();
    expect(await review.locator('#send').textContent()).toBe('Send for analysis');
    expect(await review.locator('.box.covered').count()).toBe(1);

    const stage = await review.locator('#stage').boundingBox();
    expect(stage).not.toBeNull();
    await review.mouse.move(stage!.x + stage!.width * 0.5, stage!.y + stage!.height * 0.5);
    await review.mouse.down();
    await review.mouse.move(stage!.x + stage!.width * 0.8, stage!.y + stage!.height * 0.8, { steps: 4 });
    await review.mouse.up();
    expect(await review.locator('.box.covered').count()).toBe(2);
    expect(await review.locator('#summary').textContent()).toContain('1 area covered by you');

    await review.locator('#send').click();
    await expect.poll(result).toBeTruthy();
    const { boxes } = (await result()) as { boxes: Array<{ source: string; x: number; w: number }> };
    expect(boxes.map((b) => b.source)).toEqual(['detected', 'manual']);
    expect(boxes[1].x).toBeGreaterThan(150);
    expect(boxes[1].w).toBeGreaterThan(50);
  });

  it('leaves out an uncovered detection and names the agent', async () => {
    await openReview({ clientName: 'claude-code', reason: 'Debug the failing layout' });
    expect(await review.locator('#title').textContent()).toBe('claude-code is asking for this capture');
    expect(await review.locator('#reason q').textContent()).toBe('Debug the failing layout');

    await review.locator('.box').first().click();
    expect(await review.locator('.box.uncovered').count()).toBe(1);
    expect(await review.locator('#summary').textContent()).toContain('0 of 1 possible secret covered');
    await review.keyboard.press('Control+Enter');
    await expect.poll(result).toEqual({ boxes: [] });
  });

  it('reports cancel on Escape', async () => {
    await openReview();
    await review.keyboard.press('Escape');
    await expect.poll(result).toBe('cancelled');
  });
});

