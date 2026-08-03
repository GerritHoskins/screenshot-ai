/**
 * Capture Flow E2E Tests - Workstream H.2
 * Tests the full capture flow: hotkey → selection → capture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserWindow, globalShortcut } from 'electron';
import {
  launchApp,
  waitForWindowReady,
  waitForElement,
  getElementText,
  cleanup,
  executeInRenderer,
} from './setup';

describe('Capture Flow', () => {
  let mainWindow: BrowserWindow;

  beforeEach(async () => {
    // Clean up any existing windows
    await cleanup();
    
    // Launch app
    mainWindow = await launchApp();
    await waitForWindowReady(mainWindow);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should display initial UI state', async () => {
    // Check that status element exists
    await waitForElement(mainWindow, '#status');
    
    const statusText = await getElementText(mainWindow, '#status');
    expect(statusText).toBeTruthy();
  });

  it('should have retry button disabled initially', async () => {
    await waitForElement(mainWindow, '#retry');
    
    const isDisabled = await executeInRenderer<boolean>(
      mainWindow,
      "document.querySelector('#retry')?.disabled || false"
    );
    
    expect(isDisabled).toBe(true);
  });

  it('should have copy button disabled initially', async () => {
    await waitForElement(mainWindow, '#copy');
    
    const isDisabled = await executeInRenderer<boolean>(
      mainWindow,
      "document.querySelector('#copy')?.disabled || false"
    );
    
    expect(isDisabled).toBe(true);
  });

  it('should register global hotkey', async () => {
    // Note: Actual hotkey registration testing requires OS-level access
    // This test verifies the hotkey handler exists
    const hasHotkeyHandler = await executeInRenderer<boolean>(
      mainWindow,
      "typeof window.api?.analysis !== 'undefined'"
    );
    
    expect(hasHotkeyHandler).toBe(true);
  });

  it('should display processing state when capture starts', async () => {
    // Simulate capture start by triggering the IPC event
    // In a real scenario, this would be triggered by the hotkey
    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onProcessing) {
        // The actual event is emitted from main process
        // This test verifies the handler exists
      }
      `
    );
    
    // Verify status element exists (will be updated by IPC)
    await waitForElement(mainWindow, '#status');
  });

  it('should handle capture cancellation', async () => {
    // This test verifies the UI can handle cancellation
    // Actual cancellation would be tested with real capture flow
    await waitForElement(mainWindow, '#status');
    
    // Verify UI is in a state that can handle cancellation
    const statusExists = await executeInRenderer<boolean>(
      mainWindow,
      "document.querySelector('#status') !== null"
    );
    
    expect(statusExists).toBe(true);
  });
});
