import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import type { AIResponse, ScreenshotAnalysis } from '../../src/types/ai-response';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../..');
const profilesRoot = join(root, '.cache', 'e2e');

export interface TestApp {
  application: ElectronApplication;
  page: Page;
  profile: string;
}

export async function launchApp(): Promise<TestApp> {
  mkdirSync(profilesRoot, { recursive: true });
  const profile = mkdtempSync(join(profilesRoot, 'profile-'));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.SCREENSHOT_AI_TEST_USER_DATA = profile;
  const application = await _electron.launch({
    executablePath: require('electron') as string,
    args: [join(root, 'tests/e2e/fixture.cjs')],
    cwd: root,
    env,
    timeout: 20_000,
  });
  try {
    const page = await application.firstWindow();
    await page.waitForFunction(() => window.api !== undefined);
    await page.locator('#capture-btn').waitFor();
    return { application, page, profile };
  } catch (error) {
    await application.close();
    throw error;
  }
}

export async function cleanup(app: TestApp): Promise<void> {
  await app.application.close();
  const target = resolve(app.profile);
  const withinRoot = relative(resolve(profilesRoot), target);
  if (!withinRoot || withinRoot.startsWith('..') || isAbsolute(withinRoot)) {
    throw new Error('Refusing to remove a profile outside the E2E workspace');
  }
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export async function sendToRenderer(app: TestApp, channel: string, payload: unknown): Promise<void> {
  const window = await app.application.browserWindow(app.page);
  await window.evaluate((win, message) => win.webContents.send(message.channel, message.payload), { channel, payload });
}

export function analysisResult(answer = 'Test analysis result'): AIResponse<ScreenshotAnalysis> {
  return {
    success: true,
    data: { answer, text: 'Extracted sample text', confidence: 0.95 },
    metadata: {
      provider: 'openai', model: 'fixture-model', promptTokens: 100,
      completionTokens: 50, latencyMs: 150, attemptNumber: 1,
    },
  };
}
