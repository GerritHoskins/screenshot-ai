import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cleanup, launchApp, type TestApp } from './setup';

/** Settings > Agents: the toggle starts and stops the local MCP server in the built app. */
describe('Built desktop agent access toggle', () => {
  let app: TestApp;
  const port = 40000 + Math.floor(Math.random() * 10000);

  beforeAll(async () => {
    app = await launchApp();
    writeFileSync(join(app.profile, 'settings.json'), JSON.stringify({ mcp: { enabled: false, port } }));
    await app.page.goto(pathToFileURL(join(import.meta.dirname, '../../dist/renderer/settings.html')).href);
    await app.page.waitForFunction(() => window.api?.settings !== undefined);
    await app.page.locator('.nav-item[data-tab="agents"]').click();
    await app.page.locator('#mcp-status').filter({ hasText: 'Off' }).waitFor();
  }, 30_000);
  afterAll(async () => { if (app) await cleanup(app); });

  const ping = async (token: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    return response.status;
  };

  it('starts the server when switched on and keeps the token out of the page', async () => {
    expect(await app.page.locator('#mcp-copy-command').isDisabled()).toBe(true);
    await app.page.locator('#mcp-enabled').check();
    await app.page.locator('#mcp-status').filter({ hasText: 'On' }).waitFor();

    expect(await app.page.locator('#mcp-url').textContent()).toBe(`http://127.0.0.1:${port}/mcp`);
    expect(await app.page.locator('#mcp-copy-command').isDisabled()).toBe(false);
    expect(JSON.parse(readFileSync(join(app.profile, 'settings.json'), 'utf8')).mcp).toEqual({ enabled: true, port });

    const { token } = JSON.parse(readFileSync(join(app.profile, 'mcp-connection.json'), 'utf8'));
    expect(await ping(token)).toBe(200);
    expect(await app.page.content()).not.toContain(token);
  });

  it('issues a new token on reset so the old one stops working', async () => {
    const oldToken = JSON.parse(readFileSync(join(app.profile, 'mcp-connection.json'), 'utf8')).token;
    app.page.once('dialog', (dialog) => void dialog.accept());
    await app.page.locator('#mcp-reset-token').click();
    await app.page.locator('#mcp-message').filter({ hasText: 'Token reset' }).waitFor();

    const newToken = JSON.parse(readFileSync(join(app.profile, 'mcp-connection.json'), 'utf8')).token;
    expect(newToken).not.toBe(oldToken);
    expect(await ping(oldToken)).toBe(401);
    expect(await ping(newToken)).toBe(200);
  });

  it('stops the server when switched off', async () => {
    await app.page.locator('#mcp-enabled').uncheck();
    await app.page.locator('#mcp-status').filter({ hasText: 'Off' }).waitFor();
    expect(await app.page.locator('#mcp-url').textContent()).toBe('Not running');
    await expect(ping('x'.repeat(43))).rejects.toThrow();
    expect(existsSync(join(app.profile, 'mcp-connection.json'))).toBe(true);
  });
});
