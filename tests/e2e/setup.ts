/**
 * E2E Test Setup - Workstream H.2
 * Test harness for Electron application E2E tests.
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '../..');

/**
 * Launch Electron app for testing.
 */
export async function launchApp(): Promise<BrowserWindow> {
  await app.whenReady();

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't show window during tests
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../apps/desktop/src/preload/index.js'),
    },
  });

  // Load the main window
  await mainWindow.loadFile(join(__dirname, '../apps/desktop/src/renderer/index.html'));

  return mainWindow;
}

/**
 * Wait for window to be ready.
 */
export async function waitForWindowReady(window: BrowserWindow, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkReady = () => {
      if (window.webContents.isLoading()) {
        if (Date.now() - startTime > timeout) {
          reject(new Error('Window load timeout'));
        } else {
          setTimeout(checkReady, 100);
        }
      } else {
        resolve();
      }
    };

    checkReady();
  });
}

/**
 * Execute JavaScript in renderer process.
 */
export async function executeInRenderer<T>(
  window: BrowserWindow,
  script: string
): Promise<T> {
  return window.webContents.executeJavaScript(script) as Promise<T>;
}

/**
 * Wait for element to appear in DOM.
 */
export async function waitForElement(
  window: BrowserWindow,
  selector: string,
  timeout = 5000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const exists = await executeInRenderer<boolean>(
      window,
      `document.querySelector('${selector}') !== null`
    );

    if (exists) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Element ${selector} not found within ${timeout}ms`);
}

/**
 * Get element text content.
 */
export async function getElementText(
  window: BrowserWindow,
  selector: string
): Promise<string> {
  return executeInRenderer<string>(
    window,
    `document.querySelector('${selector}')?.textContent || ''`
  );
}

/**
 * Click element.
 */
export async function clickElement(
  window: BrowserWindow,
  selector: string
): Promise<void> {
  await executeInRenderer<void>(
    window,
    `document.querySelector('${selector}')?.click()`
  );
  // Small delay for UI updates
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Set input value.
 */
export async function setInputValue(
  window: BrowserWindow,
  selector: string,
  value: string
): Promise<void> {
  await executeInRenderer<void>(
    window,
    `(() => {
      const el = document.querySelector('${selector}');
      if (el) {
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`
  );
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Get element attribute.
 */
export async function getElementAttribute(
  window: BrowserWindow,
  selector: string,
  attribute: string
): Promise<string | null> {
  return executeInRenderer<string | null>(
    window,
    `document.querySelector('${selector}')?.getAttribute('${attribute}') || null`
  );
}

/**
 * Check if element is disabled.
 */
export async function isElementDisabled(
  window: BrowserWindow,
  selector: string
): Promise<boolean> {
  return executeInRenderer<boolean>(
    window,
    `document.querySelector('${selector}')?.disabled || false`
  );
}

/**
 * Cleanup: Close all windows.
 */
export async function cleanup(): Promise<void> {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    window.close();
  }
}
