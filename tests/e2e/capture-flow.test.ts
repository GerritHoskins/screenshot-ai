import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisResult, cleanup, launchApp, sendToRenderer, type TestApp } from './setup';

describe('Built desktop capture UI', () => {
  let app: TestApp;
  beforeAll(async () => { app = await launchApp(); }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  /** Counts analysis:cancel messages reaching the main process, alongside the real handler. */
  const trackCancels = () => app.application.evaluate(({ ipcMain }) => {
    const state = globalThis as unknown as { cancelCount: number; cancelTracked?: boolean };
    state.cancelCount = 0;
    if (state.cancelTracked) return;
    state.cancelTracked = true;
    ipcMain.on('analysis:cancel', () => { state.cancelCount++; });
  });
  const cancelCount = () => app.application.evaluate(() => (globalThis as unknown as { cancelCount: number }).cancelCount);
  const selectedTab = () => app.page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id);

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
    expect(await app.page.locator('#key-chip').isVisible()).toBe(true);
    expect(await app.page.locator('#key-chip').getAttribute('href')).toBe('settings.html#api-keys');
    await app.page.locator('#capture-btn').click();
    await app.page.locator('#error-panel').waitFor();
    expect(await app.page.locator('#error-title').textContent()).toBe('No API key set');
    expect(await app.page.locator('#error-actions').textContent()).not.toContain('Run again');
    expect(await app.page.evaluate(() => document.activeElement?.id)).toBe('error-title');
    expect(await app.page.locator('#status-text').textContent()).toBe('API key needed');
  });

  it('checks for an API key in main before any capture, so the global hotkey cannot skip it', async () => {
    await sendToRenderer(app, 'analysis:error', { code: 'NETWORK_ERROR', message: 'reset', retryable: true });
    await app.page.waitForFunction(() => document.querySelector('#status-text')?.textContent === 'No connection');
    // Straight to main, as the hotkey does, bypassing the renderer's own key check.
    await app.page.evaluate(() => window.api.capture.start());
    await app.page.waitForFunction(() => document.querySelector('#error-title')?.textContent === 'No API key set');
    expect(await app.page.locator('#status-text').textContent()).toBe('API key needed');
  });

  it('opens a result with a high-severity issue on Issues when no view was picked', async () => {
    const result = analysisResult('High severity result');
    result.data!.issues = [{ severity: 'high', type: 'Bug', text: 'Null dereference on save' }];
    await sendToRenderer(app, 'analysis:result', result);
    await app.page.waitForFunction(() => document.querySelector('#content-summary')?.textContent?.includes('High severity result'));
    expect(await selectedTab()).toBe('tab-issues');
  });

  it('keeps single-key shortcuts working after a button has focus', async () => {
    await sendToRenderer(app, 'analysis:result', analysisResult());
    await app.page.locator('#tab-issues').click();
    await app.page.keyboard.press('4');
    await app.page.waitForFunction(() => document.querySelector('#tab-raw')?.getAttribute('aria-selected') === 'true');
    await app.page.keyboard.press('1');
    await app.page.waitForFunction(() => document.querySelector('#tab-summary')?.getAttribute('aria-selected') === 'true');
  });

  it('opens the next result on the view picked last, when that view has content', async () => {
    await app.page.keyboard.press('4');
    await sendToRenderer(app, 'analysis:result', analysisResult('Remembered view'));
    await app.page.waitForFunction(() => document.querySelector('#content-summary')?.textContent?.includes('Remembered view'));
    expect(await selectedTab()).toBe('tab-raw');

    // Suggestions is empty for this result, so it falls back to the answer.
    await app.page.keyboard.press('3');
    await sendToRenderer(app, 'analysis:result', analysisResult('Empty remembered view'));
    await app.page.waitForFunction(() => document.querySelector('#content-summary')?.textContent?.includes('Empty remembered view'));
    expect(await selectedTab()).toBe('tab-summary');
  });

  it('cancels an analysis in flight on Escape, like the Cancel button', async () => {
    await trackCancels();
    await sendToRenderer(app, 'analysis:processing', { stage: 'analyzing' });
    await app.page.locator('#cancel-btn').waitFor();
    await app.page.keyboard.press('Escape');
    await expect.poll(cancelCount).toBe(1);
    expect(await app.page.locator('#status-text').textContent()).toBe('Cancelling…');
    expect(await app.page.locator('#cancel-btn').isDisabled()).toBe(true);
    await sendToRenderer(app, 'analysis:processing', { stage: 'cancelled' });
    await app.page.locator('#cancel-btn').waitFor({ state: 'hidden' });
    // Escape with nothing in flight sends nothing.
    await app.page.keyboard.press('Escape');
    expect(await cancelCount()).toBe(1);
  });

  it('re-sends only on Ctrl+Enter, never on a single R', async () => {
    await app.application.evaluate(({ ipcMain }) => {
      const state = globalThis as unknown as { retryCount: number; retryTracked?: boolean };
      state.retryCount = 0;
      if (state.retryTracked) return;
      state.retryTracked = true;
      ipcMain.on('analysis:retry', () => { state.retryCount++; });
    });
    const retryCount = () => app.application.evaluate(() => (globalThis as unknown as { retryCount: number }).retryCount);
    await sendToRenderer(app, 'analysis:result', analysisResult());
    await app.page.locator('#tab-summary').focus();
    await app.page.keyboard.press('r');
    expect(await retryCount()).toBe(0);
    expect(await app.page.locator('#run-again-btn').getAttribute('title')).toMatch(/^Sends the same image again to /);
    await app.page.keyboard.press('Control+Enter');
    await expect.poll(retryCount).toBe(1);
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

      // Single-key hints and their aria-keyshortcuts go; the chord shortcut stays.
      // Run again is a chord, not a single key, so its hint stays.
      expect(await app.page.locator('#run-again-btn').getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');
      expect(await app.page.locator('#tab-raw').getAttribute('title')).toBeNull();
      expect(await app.page.locator('#tab-raw').getAttribute('aria-keyshortcuts')).toBeNull();
      expect(await app.page.locator('#capture-btn').getAttribute('aria-keyshortcuts')).toBe('Control+Shift+S Meta+Shift+S');

      // Escape is not a single-character key, so it still cancels.
      await trackCancels();
      await sendToRenderer(app, 'analysis:processing', { stage: 'analyzing' });
      await app.page.locator('#cancel-btn').waitFor();
      await app.page.keyboard.press('Escape');
      await expect.poll(cancelCount).toBe(1);
      await sendToRenderer(app, 'analysis:processing', { stage: 'cancelled' });
      await app.page.locator('#cancel-btn').waitFor({ state: 'hidden' });

      // Turning the setting back on restores the hints when the window regains focus.
      await app.page.evaluate(() => window.api.settings.set('singleKeyShortcuts', true));
      await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await app.page.waitForFunction(() => document.querySelector('#tab-raw')?.getAttribute('aria-keyshortcuts') === '4');
      expect(await app.page.locator('#tab-raw').getAttribute('title')).toBe('Shortcut: 4');
      expect(await app.page.locator('#capture-btn').getAttribute('aria-keyshortcuts')).toBe('Control+Shift+S Meta+Shift+S C');
    } finally {
      await app.page.evaluate(() => window.api.settings.set('singleKeyShortcuts', true));
    }
  });
});
