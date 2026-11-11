import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisResult, cleanup, launchApp, sendToRenderer, type TestApp } from './setup';

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
    await app.page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('Select a region'));
    await sendToRenderer(app, 'analysis:processing', { stage: 'cancelled' });
    await app.page.waitForFunction(() => document.querySelector('#status-text')?.textContent === 'Ready');
    expect(await app.page.locator('#screenshot-preview').getAttribute('class')).toContain('empty');
  });

  it('leads a first run without an API key to Settings instead of an analysis error', async () => {
    // The E2E profile starts with an empty keychain.
    await app.page.locator('#welcome-key-warning').waitFor();
    expect(await app.page.locator('#welcome-key-warning a').getAttribute('href')).toBe('settings.html#api-keys');
    expect(await app.page.locator('#capture-btn').getAttribute('class')).toContain('btn-secondary');
    await app.page.locator('#capture-btn').click();
    await app.page.locator('#error-panel').waitFor();
    expect(await app.page.locator('#error-title').textContent()).toBe('No API key set');
    expect(await app.page.locator('#error-actions').textContent()).not.toContain('Try again');
    expect(await app.page.evaluate(() => document.activeElement?.id)).toBe('error-title');
  });

  it('keeps single-key shortcuts working after a button has focus', async () => {
    await sendToRenderer(app, 'analysis:result', analysisResult());
    await app.page.locator('#tab-issues').click();
    await app.page.keyboard.press('4');
    await app.page.waitForFunction(() => document.querySelector('#tab-raw')?.getAttribute('aria-selected') === 'true');
    await app.page.keyboard.press('1');
    await app.page.waitForFunction(() => document.querySelector('#tab-summary')?.getAttribute('aria-selected') === 'true');
  });

  it('ignores single-key shortcuts when the setting is off (WCAG 2.1.4)', async () => {
    await app.page.evaluate(() => window.api.settings.set('singleKeyShortcuts', false));
    try {
      await app.page.reload();
      // The welcome shortcut note hides once the setting has loaded.
      await app.page.waitForFunction(() => (document.querySelector('.welcome-note') as HTMLElement | null)?.hidden === true);
      await sendToRenderer(app, 'analysis:result', analysisResult());
      await app.page.locator('#tab-issues').click();
      await app.page.keyboard.press('4');
      expect(await app.page.locator('#tab-issues').getAttribute('aria-selected')).toBe('true');
      expect(await app.page.locator('#tab-raw').getAttribute('aria-selected')).toBe('false');
    } finally {
      await app.page.evaluate(() => window.api.settings.set('singleKeyShortcuts', true));
    }
  });
});
