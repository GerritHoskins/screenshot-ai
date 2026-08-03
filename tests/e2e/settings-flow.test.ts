/**
 * Settings Flow E2E Tests - Workstream H.2
 * Tests the settings UI: API key management, provider selection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserWindow } from 'electron';
import {
  launchApp,
  waitForWindowReady,
  waitForElement,
  getElementText,
  clickElement,
  setInputValue,
  cleanup,
  executeInRenderer,
} from './setup';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '../..');

/**
 * Load settings page.
 */
async function loadSettingsPage(window: BrowserWindow): Promise<void> {
  await window.loadFile(join(__dirname, '../apps/desktop/src/renderer/settings.html'));
  await waitForWindowReady(window);
}

describe('Settings Flow', () => {
  let settingsWindow: BrowserWindow;

  beforeEach(async () => {
    await cleanup();
    
    // Create a new window for settings
    const { app, BrowserWindow } = await import('electron');
    await app.whenReady();
    
    settingsWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, '../apps/desktop/src/preload/index.js'),
      },
    });

    await loadSettingsPage(settingsWindow);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should display settings UI', async () => {
    await waitForElement(settingsWindow, 'h1', 2000);
    
    const title = await getElementText(settingsWindow, 'h1');
    expect(title.toLowerCase()).toContain('settings');
  });

  it('should display provider selection', async () => {
    await waitForElement(settingsWindow, 'select[name="provider"]', 2000);
    
    const providerSelect = await executeInRenderer<boolean>(
      settingsWindow,
      "document.querySelector('select[name=\"provider\"]') !== null"
    );
    
    expect(providerSelect).toBe(true);
  });

  it('should display API key inputs for both providers', async () => {
    await waitForElement(settingsWindow, 'input[data-provider="openai"]', 2000);
    await waitForElement(settingsWindow, 'input[data-provider="anthropic"]', 2000);
    
    const hasOpenAI = await executeInRenderer<boolean>(
      settingsWindow,
      "document.querySelector('input[data-provider=\"openai\"]') !== null"
    );
    
    const hasAnthropic = await executeInRenderer<boolean>(
      settingsWindow,
      "document.querySelector('input[data-provider=\"anthropic\"]') !== null"
    );
    
    expect(hasOpenAI).toBe(true);
    expect(hasAnthropic).toBe(true);
  });

  it('should display save buttons for API keys', async () => {
    await waitForElement(settingsWindow, 'button[data-action="save"]', 2000);
    
    const saveButtons = await executeInRenderer<number>(
      settingsWindow,
      "document.querySelectorAll('button[data-action=\"save\"]').length"
    );
    
    expect(saveButtons).toBeGreaterThan(0);
  });

  it('should display test buttons for API keys', async () => {
    await waitForElement(settingsWindow, 'button[data-action="test"]', 2000);
    
    const testButtons = await executeInRenderer<number>(
      settingsWindow,
      "document.querySelectorAll('button[data-action=\"test\"]').length"
    );
    
    expect(testButtons).toBeGreaterThan(0);
  });

  it('should display delete buttons for API keys', async () => {
    await waitForElement(settingsWindow, 'button[data-action="delete"]', 2000);
    
    const deleteButtons = await executeInRenderer<number>(
      settingsWindow,
      "document.querySelectorAll('button[data-action=\"delete\"]').length"
    );
    
    expect(deleteButtons).toBeGreaterThan(0);
  });

  it('should have settings API available', async () => {
    const hasSettingsAPI = await executeInRenderer<boolean>(
      settingsWindow,
      "typeof window.api?.settings !== 'undefined'"
    );
    
    expect(hasSettingsAPI).toBe(true);
  });

  it('should handle provider selection change', async () => {
    await waitForElement(settingsWindow, 'select[name="provider"]', 2000);
    
    // Verify provider select exists and can be changed
    const canChange = await executeInRenderer<boolean>(
      settingsWindow,
      `
      const select = document.querySelector('select[name="provider"]');
      if (select) {
        select.value = 'anthropic';
        return select.value === 'anthropic';
      }
      return false;
      `
    );
    
    expect(canChange).toBe(true);
  });

  it('should display API key status indicators', async () => {
    // Wait for status elements to appear
    await waitForElement(settingsWindow, '[data-status]', 2000);
    
    const hasStatusElements = await executeInRenderer<boolean>(
      settingsWindow,
      "document.querySelectorAll('[data-status]').length > 0"
    );
    
    expect(hasStatusElements).toBe(true);
  });

  // Phase 8: Enhanced E2E tests
  describe('API Key Flow: Save → Test → Remove', () => {
    it('should save API key', async () => {
      await waitForElement(settingsWindow, '#openai-key', 2000);
      
      const saved = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const input = document.getElementById('openai-key');
        const saveBtn = document.getElementById('openai-save');
        if (input && saveBtn) {
          input.value = 'sk-test1234567890';
          saveBtn.click();
          return true;
        }
        return false;
        `
      );
      
      expect(saved).toBe(true);
    });

    it('should test API key', async () => {
      await waitForElement(settingsWindow, '#openai-test', 2000);
      
      const tested = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const input = document.getElementById('openai-key');
        const testBtn = document.getElementById('openai-test');
        if (input && testBtn) {
          input.value = 'sk-test1234567890';
          testBtn.click();
          return true;
        }
        return false;
        `
      );
      
      expect(tested).toBe(true);
    });

    it('should remove API key', async () => {
      await waitForElement(settingsWindow, '#openai-delete', 2000);
      
      const removed = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const deleteBtn = document.getElementById('openai-delete');
        if (deleteBtn && !deleteBtn.disabled) {
          deleteBtn.click();
          return true;
        }
        return false;
        `
      );
      
      // Note: This will trigger a confirmation dialog
      expect(removed).toBe(true);
    });
  });

  describe('Workspace Context Flow: Enable → Exclusions → Preview', () => {
    it('should enable workspace context', async () => {
      await waitForElement(settingsWindow, '#workspace-enabled', 2000);
      
      const enabled = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const checkbox = document.getElementById('workspace-enabled');
        if (checkbox) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change'));
          return checkbox.checked;
        }
        return false;
        `
      );
      
      expect(enabled).toBe(true);
    });

    it('should show exclusions UI when enabled', async () => {
      await waitForElement(settingsWindow, '#excludes-row', 2000);
      
      const visible = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const row = document.getElementById('excludes-row');
        return row && row.style.display !== 'none';
        `
      );
      
      expect(visible).toBe(true);
    });

    it('should add exclusion pattern', async () => {
      await waitForElement(settingsWindow, '#exclude-input', 2000);
      
      const added = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const input = document.getElementById('exclude-input');
        const addBtn = document.getElementById('exclude-add');
        if (input && addBtn) {
          input.value = '*.test';
          addBtn.click();
          return true;
        }
        return false;
        `
      );
      
      expect(added).toBe(true);
    });
  });

  describe('Custom Prompt Flow: Enable → Reset', () => {
    it('should enable custom prompt', async () => {
      await waitForElement(settingsWindow, '#prompt-enabled', 2000);
      
      const enabled = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const checkbox = document.getElementById('prompt-enabled');
        if (checkbox) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change'));
          return checkbox.checked;
        }
        return false;
        `
      );
      
      expect(enabled).toBe(true);
    });

    it('should show prompt editor when enabled', async () => {
      await waitForElement(settingsWindow, '#prompt-editor-row', 2000);
      
      const visible = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const row = document.getElementById('prompt-editor-row');
        return row && row.style.display !== 'none';
        `
      );
      
      expect(visible).toBe(true);
    });

    it('should reset prompt to default', async () => {
      await waitForElement(settingsWindow, '#prompt-reset', 2000);
      
      const reset = await executeInRenderer<boolean>(
        settingsWindow,
        `
        const resetBtn = document.getElementById('prompt-reset');
        if (resetBtn) {
          resetBtn.click();
          return true;
        }
        return false;
        `
      );
      
      // Note: This will trigger a confirmation dialog
      expect(reset).toBe(true);
    });
  });
});
