/**
 * Parser Unit Tests - Workstream H
 * Tests for response parsing and validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateScreenshotAnalysis as validateSchema,
  validateAndNormalizeScreenshotAnalysis,
  formatValidationErrors,
  SchemaValidationError,
} from '../../src/types/validation';

// ============================================================================
// Parser Implementation (inline for testing)
// ============================================================================

interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'INVALID_RESPONSE';
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Clean raw AI response by removing markdown fences and whitespace.
 */
function cleanResponse(raw: string): string {
  let cleaned = raw.trim();

  // Remove markdown code fences
  // Handle ```json, ```JSON, ``` variants
  cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');

  // Handle BOM character
  cleaned = cleaned.replace(/^\uFEFF/, '');

  // Trim again after removing fences
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Attempt to extract JSON from mixed content.
 */
function extractJson(text: string): string | null {
  // Try to find JSON object
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }

  // Try to find JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }

  return null;
}

/**
 * Parse and validate AI response.
 */
function parseResponse<T>(raw: string): ParseResult<T> {
  if (!raw || typeof raw !== 'string') {
    return {
      success: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Empty or invalid response',
      },
    };
  }

  // Step 1: Clean the response
  let cleaned = cleanResponse(raw);

  // Step 2: Try to parse as JSON
  try {
    const data = JSON.parse(cleaned) as T;
    return { success: true, data };
  } catch (firstError) {
    // Step 3: Try to extract JSON from mixed content
    const extracted = extractJson(cleaned);
    if (extracted) {
      try {
        const data = JSON.parse(extracted) as T;
        return { success: true, data };
      } catch {
        // Fall through to error
      }
    }

    // Return parse error
    return {
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: 'Failed to parse JSON response',
        details: {
          rawContent: raw.slice(0, 200),
          cleanedContent: cleaned.slice(0, 200),
        },
      },
    };
  }
}

/**
 * Validate parsed data against expected schema.
 */
function validateScreenshotAnalysis(data: unknown): ParseResult<{
  text?: string;
  codeBlocks?: Array<{ language?: string; code: string }>;
  confidence: number;
}> {
  if (typeof data !== 'object' || data === null) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Response must be an object',
      },
    };
  }

  const obj = data as Record<string, unknown>;

  // Validate confidence (required)
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'confidence must be a number between 0 and 1',
      },
    };
  }

  // Validate text (optional)
  if (obj.text !== undefined && typeof obj.text !== 'string') {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'text must be a string if provided',
      },
    };
  }

  // Validate codeBlocks (optional)
  if (obj.codeBlocks !== undefined) {
    if (!Array.isArray(obj.codeBlocks)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'codeBlocks must be an array if provided',
        },
      };
    }

    for (let i = 0; i < obj.codeBlocks.length; i++) {
      const block = obj.codeBlocks[i] as Record<string, unknown>;
      if (typeof block.code !== 'string') {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `codeBlocks[${i}].code must be a string`,
          },
        };
      }
    }
  }

  return {
    success: true,
    data: obj as {
      text?: string;
      codeBlocks?: Array<{ language?: string; code: string }>;
      confidence: number;
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('cleanResponse', () => {
  it('removes leading and trailing whitespace', () => {
    const result = cleanResponse('  {"test": true}  ');
    expect(result).toBe('{"test": true}');
  });

  it('removes markdown json fence', () => {
    const result = cleanResponse('```json\n{"test": true}\n```');
    expect(result).toBe('{"test": true}');
  });

  it('removes markdown fence without language', () => {
    const result = cleanResponse('```\n{"test": true}\n```');
    expect(result).toBe('{"test": true}');
  });

  it('handles uppercase JSON fence', () => {
    const result = cleanResponse('```JSON\n{"test": true}\n```');
    expect(result).toBe('{"test": true}');
  });

  it('removes BOM character', () => {
    const result = cleanResponse('\uFEFF{"test": true}');
    expect(result).toBe('{"test": true}');
  });

  it('handles already clean JSON', () => {
    const result = cleanResponse('{"test": true}');
    expect(result).toBe('{"test": true}');
  });
});

describe('extractJson', () => {
  it('extracts JSON object from text', () => {
    const result = extractJson('Here is the result: {"test": true} done');
    expect(result).toBe('{"test": true}');
  });

  it('extracts JSON array from text', () => {
    const result = extractJson('The array is: [1, 2, 3] end');
    expect(result).toBe('[1, 2, 3]');
  });

  it('extracts nested JSON', () => {
    const result = extractJson('Result: {"outer": {"inner": true}}');
    expect(result).toBe('{"outer": {"inner": true}}');
  });

  it('returns null for text without JSON', () => {
    const result = extractJson('No JSON here');
    expect(result).toBeNull();
  });
});

describe('parseResponse', () => {
  it('parses valid JSON response', () => {
    const result = parseResponse('{"success": true, "value": 42}');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ success: true, value: 42 });
  });

  it('handles markdown-wrapped JSON', () => {
    const result = parseResponse('```json\n{"success": true}\n```');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ success: true });
  });

  it('extracts JSON from mixed content', () => {
    const result = parseResponse('Here is the analysis: {"confidence": 0.9}');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ confidence: 0.9 });
  });

  it('returns PARSE_ERROR for invalid JSON', () => {
    const result = parseResponse('not json at all');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PARSE_ERROR');
  });

  it('returns INVALID_RESPONSE for empty input', () => {
    const result = parseResponse('');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_RESPONSE');
  });

  it('handles arrays', () => {
    const result = parseResponse('[1, 2, 3]');
    expect(result.success).toBe(true);
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('handles nested objects', () => {
    const result = parseResponse('{"a": {"b": {"c": 1}}}');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ a: { b: { c: 1 } } });
  });

  it('includes raw content in error details', () => {
    const result = parseResponse('invalid {json}');
    expect(result.success).toBe(false);
    expect(result.error?.details?.rawContent).toBeDefined();
  });
});

describe('validateScreenshotAnalysis', () => {
  it('validates correct analysis response', () => {
    const result = validateScreenshotAnalysis({
      text: 'Hello World',
      confidence: 0.95,
    });
    expect(result.success).toBe(true);
  });

  it('validates response with codeBlocks', () => {
    const result = validateScreenshotAnalysis({
      codeBlocks: [
        { language: 'python', code: 'print("hello")' },
      ],
      confidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing confidence', () => {
    const result = validateScreenshotAnalysis({
      text: 'Hello',
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(result.error?.message).toContain('confidence');
  });

  it('rejects invalid confidence value', () => {
    const result = validateScreenshotAnalysis({
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('confidence');
  });

  it('rejects non-object input', () => {
    const result = validateScreenshotAnalysis('not an object');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid text type', () => {
    const result = validateScreenshotAnalysis({
      text: 123,
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('text');
  });

  it('rejects codeBlocks without code property', () => {
    const result = validateScreenshotAnalysis({
      codeBlocks: [{ language: 'python' }],
      confidence: 0.9,
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('codeBlocks[0].code');
  });
});

describe('Schema Validation', () => {
  it('validates correct ScreenshotAnalysis', () => {
    const data = {
      text: 'Hello World',
      codeBlocks: [{ language: 'python', code: 'print("hello")' }],
      confidence: 0.95,
    };

    expect(() => validateSchema(data)).not.toThrow();
    expect(validateSchema(data)).toBe(true);
  });

  it('throws on missing confidence', () => {
    const data = { text: 'Hello' };

    expect(() => validateSchema(data)).toThrow(SchemaValidationError);
  });

  it('throws on invalid confidence range', () => {
    const data = { confidence: 1.5 };

    expect(() => validateSchema(data)).toThrow(SchemaValidationError);
  });

  it('validates codeBlocks structure', () => {
    const data = {
      codeBlocks: [
        { code: 'test', language: 'js', startLine: 1, endLine: 2 },
      ],
      confidence: 0.9,
    };

    expect(() => validateSchema(data)).not.toThrow();
    expect(validateSchema(data)).toBe(true);
  });

  it('rejects invalid codeBlocks types', () => {
    const data = {
      codeBlocks: 'not an array',
      confidence: 0.9,
    };

    expect(() => validateSchema(data)).toThrow(SchemaValidationError);
  });

  it('rejects codeBlock without code', () => {
    const data = {
      codeBlocks: [{ language: 'python' }],
      confidence: 0.9,
    };

    expect(() => validateSchema(data)).toThrow(SchemaValidationError);
  });

  it('validateAndNormalize returns valid result', () => {
    const data = {
      text: 'Hello',
      confidence: 0.9,
    };

    const result = validateAndNormalizeScreenshotAnalysis(data);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(data);
  });

  it('validateAndNormalize returns errors for invalid data', () => {
    const data = {
      confidence: 1.5, // Invalid range
    };

    const result = validateAndNormalizeScreenshotAnalysis(data);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('formatValidationErrors creates readable message', () => {
    const errors = [
      { field: 'confidence', message: 'Must be between 0 and 1', value: 1.5 },
      { field: 'text', message: 'Must be a string', value: 123 },
    ];

    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain('confidence');
    expect(formatted).toContain('text');
    expect(formatted).toContain('2');
  });
});
