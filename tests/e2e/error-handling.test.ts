/**
 * Error Handling E2E Tests - Workstream H.2
 * Tests error handling flows: network errors, timeouts, invalid responses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserWindow } from 'electron';
import {
  launchApp,
  waitForWindowReady,
  waitForElement,
  getElementText,
  cleanup,
  executeInRenderer,
} from './setup';

describe('Error Handling', () => {
  let mainWindow: BrowserWindow;

  beforeEach(async () => {
    await cleanup();
    mainWindow = await launchApp();
    await waitForWindowReady(mainWindow);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should display network error messages', async () => {
    const mockError = {
      code: 'NETWORK_ERROR',
      message: 'Network request failed. Please check your internet connection.',
      retryable: true,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#status', 2000);

    const statusText = await getElementText(mainWindow, '#status');
    expect(statusText.toLowerCase()).toContain('error');
  });

  it('should display timeout error messages', async () => {
    const mockError = {
      code: 'TIMEOUT',
      message: 'Request timed out after 30s. Check your internet connection or try again.',
      retryable: true,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#status', 2000);

    const statusText = await getElementText(mainWindow, '#status');
    expect(statusText.toLowerCase()).toContain('timeout');
  });

  it('should display authentication error messages', async () => {
    const mockError = {
      code: 'AUTH_ERROR',
      message: 'Invalid API key. Please check your settings.',
      retryable: false,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#status', 2000);

    const statusText = await getElementText(mainWindow, '#status');
    expect(statusText.toLowerCase()).toContain('error');
  });

  it('should display parse error messages', async () => {
    const mockError = {
      code: 'PARSE_ERROR',
      message: 'Failed to parse JSON response',
      retryable: true,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#status', 2000);

    const statusText = await getElementText(mainWindow, '#status');
    expect(statusText.toLowerCase()).toContain('error');
  });

  it('should enable retry for retryable errors', async () => {
    const mockError = {
      code: 'RATE_LIMIT',
      message: 'Rate limit exceeded',
      retryable: true,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#retry', 2000);

    const isDisabled = await executeInRenderer<boolean>(
      mainWindow,
      "document.querySelector('#retry')?.disabled || false"
    );

    expect(isDisabled).toBe(false);
  });

  it('should disable retry for non-retryable errors', async () => {
    const mockError = {
      code: 'AUTH_ERROR',
      message: 'Invalid API key',
      retryable: false,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#retry', 2000);

    const isDisabled = await executeInRenderer<boolean>(
      mainWindow,
      "document.querySelector('#retry')?.disabled || false"
    );

    expect(isDisabled).toBe(true);
  });

  it('should display error details in result area', async () => {
    const mockError = {
      code: 'NETWORK_ERROR',
      message: 'Network request failed',
      retryable: true,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#result', 2000);

    const resultText = await getElementText(mainWindow, '#result');
    expect(resultText.toLowerCase()).toContain('network');
  });

  it('should handle validation errors', async () => {
    const mockError = {
      code: 'VALIDATION_ERROR',
      message: 'Schema validation failed',
      retryable: true,
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onError) {
        const event = new CustomEvent('analysis:error', { detail: ${JSON.stringify(mockError)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#status', 2000);

    const statusText = await getElementText(mainWindow, '#status');
    expect(statusText.toLowerCase()).toContain('error');
  });
});
