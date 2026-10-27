import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, launchApp, sendToRenderer, type TestApp } from './setup';

describe('Built desktop capture UI', () => {
  let app: TestApp;
  beforeAll(async () => { app = await launchApp(); }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  it('loads the production renderer and isolated preload bridge', async () => {
    expect(app.page.url()).toMatch(/dist\/renderer\/index\.html$/);
    expect(await app.page.locator('#capture-btn').isEnabled()).toBe(true);
    expect(await app.page.locator('#run-again-btn').isDisabled()).toBe(true);
    expect(await app.page.locator('#export-btn').isDisabled()).toBe(true);
    expect(await app.page.evaluate(() => ({ require: typeof (window as any).require, capture: typeof window.api.capture.start })))
      .toEqual({ require: 'undefined', capture: 'function' });
  });

  it('registers the global capture shortcut in the real main process', async () => {
    expect(await app.application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+S'))).toBe(true);
  });

  it('receives capture state and cancellation through the preload IPC bridge', async () => {
    await sendToRenderer(app, 'analysis:processing', { stage: 'capture' });
    await app.page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('Capturing'));
    await sendToRenderer(app, 'analysis:processing', { stage: 'cancelled' });
    await app.page.waitForFunction(() => document.querySelector('#status-text')?.textContent === 'Ready');
    expect(await app.page.locator('#screenshot-preview').getAttribute('class')).toContain('empty');
  });
});
