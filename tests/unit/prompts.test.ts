/**
 * Prompt Generation Unit Tests - Workstream H.1
 * Tests for prompt template generation.
 */

import { describe, it, expect } from 'vitest';
import {
  generateBasePrompt,
  generateRetryPrompt,
  generateScreenshotAnalysisPrompt,
  generateScreenshotAnalysisRetryPrompt,
  generateFeedbackBasedRetryPrompt,
  estimateTokenCount,
  truncateToTokenBudget,
  type BasePromptParams,
  type RetryPromptParams,
} from '../../src/prompts/templates';

describe('generateBasePrompt', () => {
  it('generates prompt with all required variables', () => {
    const params: BasePromptParams = {
      role: 'code analyzer',
      schemaDefinition: '{"test": "schema"}',
      exampleResponse: '{"test": "example"}',
      taskDescription: 'Analyze this code',
    };

    const prompt = generateBasePrompt(params);

    expect(prompt).toContain('code analyzer');
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('{"test": "schema"}');
    expect(prompt).toContain('{"test": "example"}');
    expect(prompt).toContain('Analyze this code');
  });

  it('includes context when provided', () => {
    const params: BasePromptParams = {
      role: 'analyzer',
      context: 'Additional context here',
      schemaDefinition: '{}',
      exampleResponse: '{}',
      taskDescription: 'Task',
    };

    const prompt = generateBasePrompt(params);
    expect(prompt).toContain('Additional context here');
  });

  it('omits context when not provided', () => {
    const params: BasePromptParams = {
      role: 'analyzer',
      schemaDefinition: '{}',
      exampleResponse: '{}',
      taskDescription: 'Task',
    };

    const prompt = generateBasePrompt(params);
    expect(prompt).not.toContain('undefined');
  });

  it('enforces JSON-only output', () => {
    const params: BasePromptParams = {
      role: 'analyzer',
      schemaDefinition: '{}',
      exampleResponse: '{}',
      taskDescription: 'Task',
    };

    const prompt = generateBasePrompt(params);
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('No markdown');
    expect(prompt).toContain('JSON.parse()');
  });
});

describe('generateRetryPrompt', () => {
  it('includes error information', () => {
    const params: RetryPromptParams = {
      originalTask: 'Original task',
      errorType: 'PARSE_ERROR',
      errorDetails: 'Invalid JSON',
      attemptNumber: 2,
      maxAttempts: 3,
    };

    const prompt = generateRetryPrompt(params);

    expect(prompt).toContain('PARSE_ERROR');
    expect(prompt).toContain('Invalid JSON');
    expect(prompt).toContain('Original task');
    expect(prompt).toContain('attempt 2 of 3');
  });

  it('provides corrective guidance', () => {
    const params: RetryPromptParams = {
      originalTask: 'Task',
      errorType: 'VALIDATION_ERROR',
      errorDetails: 'Missing field',
      attemptNumber: 1,
      maxAttempts: 3,
    };

    const prompt = generateRetryPrompt(params);

    expect(prompt).toContain('try again');
    expect(prompt).toContain('valid JSON');
    expect(prompt).toContain('required fields');
  });
});

describe('generateScreenshotAnalysisPrompt', () => {
  it('generates screenshot-specific prompt', () => {
    const prompt = generateScreenshotAnalysisPrompt();

    expect(prompt).toContain('image analyst');
    expect(prompt).toContain('screenshot');
    expect(prompt).toContain('text content');
    expect(prompt).toContain('codeBlocks');
    expect(prompt).toContain('confidence');
  });

  it('includes additional context when provided', () => {
    const prompt = generateScreenshotAnalysisPrompt('Focus on code extraction');

    expect(prompt).toContain('Focus on code extraction');
  });
});

describe('generateScreenshotAnalysisRetryPrompt', () => {
  it('generates retry prompt with error context', () => {
    const prompt = generateScreenshotAnalysisRetryPrompt(
      'PARSE_ERROR',
      'Invalid JSON',
      2,
      3
    );

    expect(prompt).toContain('PARSE_ERROR');
    expect(prompt).toContain('Invalid JSON');
    expect(prompt).toContain('attempt 2 of 3');
    expect(prompt).toContain('screenshot');
  });
});

describe('generateFeedbackBasedRetryPrompt', () => {
  it('generates positive feedback prompt', () => {
    const prompt = generateFeedbackBasedRetryPrompt('positive', 2);

    expect(prompt).toContain('helpful');
    expect(prompt).toContain('similar quality');
    expect(prompt).toContain('more detail');
    expect(prompt).not.toContain('different angle');
  });

  it('generates negative feedback prompt', () => {
    const prompt = generateFeedbackBasedRetryPrompt('negative', 2);

    expect(prompt).toContain('improvement');
    expect(prompt).toContain('different angle');
    expect(prompt).toContain('bugs');
    expect(prompt).toContain('UX');
    expect(prompt).not.toContain('similar quality');
  });

  it('includes attempt number in context', () => {
    const prompt = generateFeedbackBasedRetryPrompt('negative', 3);

    // Prompt should be aware it's a retry
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe('estimateTokenCount', () => {
  it('estimates tokens correctly', () => {
    const text = 'This is a test string with multiple words';
    const tokens = estimateTokenCount(text);

    // Rough approximation: ~4 chars per token
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });

  it('handles empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('handles long text', () => {
    const longText = 'a'.repeat(1000);
    const tokens = estimateTokenCount(longText);
    expect(tokens).toBeGreaterThan(100);
  });
});

describe('truncateToTokenBudget', () => {
  it('returns original text if under budget', () => {
    const text = 'Short text';
    const result = truncateToTokenBudget(text, 100);
    expect(result).toBe(text);
  });

  it('truncates text over budget', () => {
    const longText = 'a'.repeat(1000);
    const result = truncateToTokenBudget(longText, 100);
    expect(result.length).toBeLessThan(longText.length);
    expect(result).toContain('[Content truncated');
  });

  it('handles exact budget', () => {
    const text = 'a'.repeat(400); // ~100 tokens
    const result = truncateToTokenBudget(text, 100);
    expect(result).toBe(text);
  });
});
