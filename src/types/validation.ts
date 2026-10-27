/**
 * Schema Validation - Workstream B.1
 * Runtime validation for AIResponse and ScreenshotAnalysis.
 */

import type { ScreenshotAnalysis } from './ai-response';

// ============================================================================
// Validation Errors
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export class SchemaValidationError extends Error {
  constructor(
    public errors: ValidationError[],
    message = 'Schema validation failed'
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

// ============================================================================
// Validators
// ============================================================================

/**
 * Validate ScreenshotAnalysis object.
 */
export function validateScreenshotAnalysis(data: unknown): data is ScreenshotAnalysis {
  if (typeof data !== 'object' || data === null) {
    throw new SchemaValidationError([
      { field: 'root', message: 'Must be an object', value: data },
    ]);
  }

  const obj = data as Record<string, unknown>;
  const errors: ValidationError[] = [];

  // Validate confidence (required)
  if (typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) {
    errors.push({
      field: 'confidence',
      message: 'Must be a number',
      value: obj.confidence,
    });
  } else if (obj.confidence < 0 || obj.confidence > 1) {
    errors.push({
      field: 'confidence',
      message: 'Must be between 0 and 1',
      value: obj.confidence,
    });
  }

  // Validate answer (optional) - normalize null to undefined
  if (obj.answer !== undefined && obj.answer !== null && typeof obj.answer !== 'string') {
    errors.push({
      field: 'answer',
      message: 'Must be a string if provided',
      value: obj.answer,
    });
  } else if (obj.answer === null) {
    delete obj.answer;
  }

  // Validate text (optional) - normalize null to undefined
  if (obj.text !== undefined && obj.text !== null && typeof obj.text !== 'string') {
    errors.push({
      field: 'text',
      message: 'Must be a string if provided',
      value: obj.text,
    });
  } else if (obj.text === null) {
    // Normalize null to undefined
    delete obj.text;
  }

  // Validate codeBlocks (optional) - normalize null to undefined
  if (obj.codeBlocks === null) {
    delete obj.codeBlocks;
  } else if (obj.codeBlocks !== undefined) {
    if (!Array.isArray(obj.codeBlocks)) {
      errors.push({
        field: 'codeBlocks',
        message: 'Must be an array if provided',
        value: obj.codeBlocks,
      });
    } else {
      obj.codeBlocks.forEach((block, idx) => {
        if (typeof block !== 'object' || block === null) {
          errors.push({
            field: `codeBlocks[${idx}]`,
            message: 'Must be an object',
            value: block,
          });
          return;
        }

        const b = block as Record<string, unknown>;

        // code is required
        if (typeof b.code !== 'string') {
          errors.push({
            field: `codeBlocks[${idx}].code`,
            message: 'Must be a string',
            value: b.code,
          });
        }

        // language is optional but must be string if provided
        if (b.language !== undefined && typeof b.language !== 'string') {
          errors.push({
            field: `codeBlocks[${idx}].language`,
            message: 'Must be a string if provided',
            value: b.language,
          });
        }

        // startLine and endLine are optional but must be numbers if provided
        if (b.startLine !== undefined && typeof b.startLine !== 'number') {
          errors.push({
            field: `codeBlocks[${idx}].startLine`,
            message: 'Must be a number if provided',
            value: b.startLine,
          });
        }

        if (b.endLine !== undefined && typeof b.endLine !== 'number') {
          errors.push({
            field: `codeBlocks[${idx}].endLine`,
            message: 'Must be a number if provided',
            value: b.endLine,
          });
        }
      });
    }
  }

  // Validate structuredData (optional) - normalize null to undefined
  if (obj.structuredData === null) {
    delete obj.structuredData;
  } else if (obj.structuredData !== undefined) {
    if (typeof obj.structuredData !== 'object' || Array.isArray(obj.structuredData)) {
      errors.push({
        field: 'structuredData',
        message: 'Must be an object if provided',
        value: obj.structuredData,
      });
    }
  }

  if (errors.length > 0) {
    throw new SchemaValidationError(errors);
  }

  return true;
}

/**
 * Validate and normalize ScreenshotAnalysis with detailed error messages.
 */
export function validateAndNormalizeScreenshotAnalysis(
  data: unknown
): { valid: boolean; data?: ScreenshotAnalysis; errors?: ValidationError[] } {
  try {
    validateScreenshotAnalysis(data);
    return { valid: true, data: data as ScreenshotAnalysis };
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return { valid: false, errors: error.errors };
    }
    return {
      valid: false,
      errors: [{ field: 'root', message: error instanceof Error ? error.message : 'Unknown validation error' }],
    };
  }
}

/**
 * Format validation errors as user-friendly message.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return 'Validation passed';
  }

  if (errors.length === 1) {
    return `Validation error: ${errors[0].field} - ${errors[0].message}`;
  }

  const errorList = errors.map(e => `  • ${e.field}: ${e.message}`).join('\n');
  return `Validation errors (${errors.length}):\n${errorList}`;
}
