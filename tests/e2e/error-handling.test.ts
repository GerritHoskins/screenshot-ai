import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisResult, cleanup, launchApp, sendToRenderer, type TestApp } from './setup';

describe('Built desktop error handling', () => {
  let app: TestApp;
  beforeAll(async () => { app = await launchApp(); }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  it.each(['NETWORK_ERROR', 'TIMEOUT', 'AUTH_ERROR'])('displays %s from main IPC', async (code) => {
    await sendToRenderer(app, 'analysis:error', { code, message: 'Safe failure message', retryable: code !== 'AUTH_ERROR' });
    await app.page.waitForFunction((expected) => document.querySelector('#error-raw')?.textContent?.includes(expected), code);
    expect(await app.page.locator('#error-panel').isVisible()).toBe(true);
    const title = (await app.page.locator('#error-title').textContent()) ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toContain(code);
    expect(await app.page.locator('#status-text').textContent()).not.toContain(code);
    expect(await app.page.locator('#error-raw').textContent()).toContain('Safe failure message');
    expect(await app.page.locator('#run-again-btn').isHidden()).toBe(true);
    expect(await app.page.locator('#error-actions button, #error-actions a').count()).toBeGreaterThan(0);
  });

  it('escapes untrusted error text', async () => {
    await sendToRenderer(app, 'analysis:error', { code: 'NETWORK_ERROR', message: '<img src=x onerror="window.__errorInjection=1">', retryable: true });
    await app.page.waitForFunction(() => document.querySelector('#error-raw')?.textContent?.includes('<img'));
    expect(await app.page.locator('#error-panel img').count()).toBe(0);
    expect(await app.page.evaluate(() => (window as any).__errorInjection)).toBeUndefined();
  });

  it('recovers from an error when a later result arrives', async () => {
    await sendToRenderer(app, 'analysis:result', analysisResult('Recovered result'));
    await app.page.waitForFunction(() => document.querySelector('#status-text')?.textContent?.includes('Analysis complete'));
    expect(await app.page.locator('#content-summary').textContent()).toContain('Recovered result');
    expect(await app.page.locator('#error-panel').isHidden()).toBe(true);
  });
});
