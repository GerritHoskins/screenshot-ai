/**
 * Analysis Flow E2E Tests - Workstream H.2
 * Tests the analysis flow: screenshot → AI analysis → results display.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import {
  launchApp,
  waitForWindowReady,
  waitForElement,
  getElementText,
  clickElement,
  cleanup,
  executeInRenderer,
} from './setup';

describe('Analysis Flow', () => {
  let mainWindow: BrowserWindow;

  beforeEach(async () => {
    await cleanup();
    mainWindow = await launchApp();
    await waitForWindowReady(mainWindow);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should display analysis results when received', async () => {
    // Simulate receiving analysis results via IPC
    const mockResult = {
      success: true,
      data: {
        text: 'Test analysis result',
        codeBlocks: [
          {
            language: 'typescript',
            code: 'const test = "example";',
          },
        ],
        confidence: 0.95,
      },
      metadata: {
        model: 'gpt-4-vision-preview',
        provider: 'openai',
        promptTokens: 100,
        completionTokens: 50,
        latencyMs: 1500,
        attemptNumber: 1,
      },
    };

    // Trigger the result event handler
    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onResult) {
        // Simulate result event
        const event = new CustomEvent('analysis:result', { detail: ${JSON.stringify(mockResult)} });
        window.dispatchEvent(event);
      }
      `
    );

    // Wait for result element to appear
    await waitForElement(mainWindow, '#result', 2000);

    // Verify result content is displayed
    const resultText = await getElementText(mainWindow, '#result');
    expect(resultText).toContain('Test analysis result');
  });

  it('should enable retry button after analysis', async () => {
    const mockResult = {
      success: true,
      data: { text: 'Test', confidence: 0.9 },
      metadata: {
        model: 'test',
        provider: 'openai',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 100,
        attemptNumber: 1,
      },
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onResult) {
        const event = new CustomEvent('analysis:result', { detail: ${JSON.stringify(mockResult)} });
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

  it('should enable copy button after successful analysis', async () => {
    const mockResult = {
      success: true,
      data: { text: 'Test', confidence: 0.9 },
      metadata: {
        model: 'test',
        provider: 'openai',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 100,
        attemptNumber: 1,
      },
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onResult) {
        const event = new CustomEvent('analysis:result', { detail: ${JSON.stringify(mockResult)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#copy', 2000);

    const isDisabled = await executeInRenderer<boolean>(
      mainWindow,
      "document.querySelector('#copy')?.disabled || false"
    );

    expect(isDisabled).toBe(false);
  });

  it('should display error message on analysis failure', async () => {
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

    await waitForElement(mainWindow, '#status', 2000);

    const statusText = await getElementText(mainWindow, '#status');
    expect(statusText.toLowerCase()).toContain('error');
  });

  it('should disable retry button for non-retryable errors', async () => {
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

  it('should display code blocks when present', async () => {
    const mockResult = {
      success: true,
      data: {
        text: 'Code example',
        codeBlocks: [
          {
            language: 'typescript',
            code: 'const example = "test";',
          },
        ],
        confidence: 0.9,
      },
      metadata: {
        model: 'test',
        provider: 'openai',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 100,
        attemptNumber: 1,
      },
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onResult) {
        const event = new CustomEvent('analysis:result', { detail: ${JSON.stringify(mockResult)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#result', 2000);

    const resultHtml = await executeInRenderer<string>(
      mainWindow,
      "document.querySelector('#result')?.innerHTML || ''"
    );

    expect(resultHtml).toContain('typescript');
    expect(resultHtml).toContain('const example');
  });

  it('should handle retry button click', async () => {
    // First, simulate a result
    const mockResult = {
      success: true,
      data: { text: 'Test', confidence: 0.9 },
      metadata: {
        model: 'test',
        provider: 'openai',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 100,
        attemptNumber: 1,
      },
    };

    await executeInRenderer<void>(
      mainWindow,
      `
      if (window.api?.analysis?.onResult) {
        const event = new CustomEvent('analysis:result', { detail: ${JSON.stringify(mockResult)} });
        window.dispatchEvent(event);
      }
      `
    );

    await waitForElement(mainWindow, '#retry', 2000);

    // Verify retry handler exists
    const hasRetryHandler = await executeInRenderer<boolean>(
      mainWindow,
      "typeof window.api?.analysis?.retry === 'function'"
    );

    expect(hasRetryHandler).toBe(true);
  });
});
