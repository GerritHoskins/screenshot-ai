import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysisResult, cleanup, launchApp, sendToRenderer, type TestApp } from './setup';

describe('Built desktop analysis rendering', () => {
  let app: TestApp;
  beforeAll(async () => { app = await launchApp(); }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  it('renders a real main-to-preload result and enables result actions', async () => {
    await sendToRenderer(app, 'analysis:result', analysisResult());
    await app.page.waitForFunction(() => document.querySelector('#content-summary')?.textContent?.includes('Test analysis result'));
    expect(await app.page.locator('#run-again-btn').isEnabled()).toBe(true);
    expect(await app.page.locator('#export-btn').isEnabled()).toBe(true);
    await app.page.locator('#tab-raw').click();
    expect(await app.page.locator('#content-raw').textContent()).toContain('fixture-model');
  });

  it('treats model HTML as inert text while retaining supported formatting', async () => {
    const payload = '<img src=x onerror="window.__injected=1"> **safe bold**';
    await sendToRenderer(app, 'analysis:result', analysisResult(payload));
    await app.page.waitForFunction(() => document.querySelector('#content-summary')?.textContent?.includes('safe bold'));
    expect(await app.page.locator('#content-summary img').count()).toBe(0);
    expect(await app.page.locator('#content-summary strong').textContent()).toBe('safe bold');
    expect(await app.page.evaluate(() => (window as any).__injected)).toBeUndefined();
    expect(await app.page.locator('#content-summary').textContent()).toContain('<img');
  });

  it('enforces the production CSP against inline event handlers', async () => {
    await app.page.evaluate(() => {
      const image = document.createElement('img');
      image.setAttribute('onerror', 'window.__cspBypass=1');
      image.src = 'file:///nonexistent-screenshot-ai-csp-test.png';
      document.body.append(image);
      image.dispatchEvent(new Event('error'));
      image.remove();
    });
    expect(await app.page.evaluate(() => (window as any).__cspBypass)).toBeUndefined();
    expect(await app.page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("script-src 'self'");
  });
});
