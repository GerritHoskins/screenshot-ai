import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { cleanup, launchApp, type TestApp } from './setup';

describe('Built desktop settings IPC', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await launchApp();
    await app.page.goto(pathToFileURL(join(import.meta.dirname, '../../dist/renderer/settings.html')).href);
    await app.page.waitForFunction(() => window.api?.settings !== undefined);
    await app.page.locator('#provider-select').waitFor();
  }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  it('loads provider and masked credential controls', async () => {
    expect(await app.page.locator('#provider-select').inputValue()).toBe('openai');
    expect(await app.page.locator('#openai-key').getAttribute('type')).toBe('password');
    expect(await app.page.locator('#anthropic-key').getAttribute('type')).toBe('password');
  });

  it('persists valid settings through the real preload without using the real user profile', async () => {
    await app.page.evaluate(async () => {
      await window.api.settings.set('provider', 'anthropic');
    });
    const saved = JSON.parse(readFileSync(join(app.profile, 'settings.json'), 'utf8'));
    expect(saved.provider.selectedProvider).toBe('anthropic');
    expect(await app.page.evaluate(() => window.api.settings.get('provider'))).toBe('anthropic');
  });

  it('rejects unknown settings keys and invalid providers without persisting them', async () => {
    const outcomes = await app.page.evaluate(async () => {
      return Promise.all([
        window.api.settings.set('__proto__', { polluted: true }).then(() => false, () => true),
        window.api.settings.set('provider', 'attacker-provider').then(() => false, () => true),
      ]);
    });
    expect(outcomes).toEqual([true, true]);
    expect(JSON.parse(readFileSync(join(app.profile, 'settings.json'), 'utf8')).provider.selectedProvider).toBe('anthropic');
  });

  it('preserves model choices and prompt opt-outs after a context-source update', async () => {
    const outcomes = await app.page.evaluate(async (directory) => {
      const settings = window.api.settings;
      await settings.set('model', 'anthropic-fixture');
      const source = await settings.addContextSource({
        type: 'local', enabled: false,
        scope: { path: directory, includeFileContents: false },
      });
      await settings.set('provider', 'openai');
      await settings.set('model', 'openai-fixture');
      await settings.set('provider', 'anthropic');
      await settings.importPrompt('Return valid JSON with answer and confidence.');
      await settings.setPromptEnabled(false);
      return { source, model: await settings.get('model'), prompt: await settings.getPromptStatus() };
    }, app.profile);
    expect(outcomes.source.success).toBe(true);
    expect(outcomes.model).toBe('anthropic-fixture');
    expect(outcomes.prompt.enabled).toBe(false);
    const saved = JSON.parse(readFileSync(join(app.profile, 'settings.json'), 'utf8'));
    expect(saved.prompt.useCustom).toBe(false);
    expect(saved.context.sources[0].enabled).toBe(false);
    expect(saved.context.sources[0].scope.includeFileContents).toBe(false);
    await app.page.evaluate(() => window.api.settings.clearPrompt());
    expect(await app.page.evaluate(() => window.api.settings.getPromptText())).toEqual({ text: '' });
  });

  it('rejects invalid API credentials before touching secure storage', async () => {
    const result = await app.page.evaluate(() => window.api.settings.storeApiKey('openai', 'invalid'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid API key format');
  });
});
