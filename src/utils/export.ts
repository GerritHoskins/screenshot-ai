/**
 * Export Utilities - Workstream E.2
 * Formatting functions for copy-to-clipboard operations.
 */

import type { AIResponse, ScreenshotAnalysis } from '../types/ai-response';

export type ExportFormat = 'full-json' | 'summary' | 'code-only' | 'text-only';

/**
 * Format analysis result for export.
 */
export function formatForExport(
  response: AIResponse<ScreenshotAnalysis>,
  format: ExportFormat
): string {
  if (!response.success || !response.data) {
    return formatErrorForExport(response);
  }

  const analysis = response.data;

  switch (format) {
    case 'full-json':
      return formatAsFullJSON(response);

    case 'summary':
      return formatAsSummary(analysis);

    case 'code-only':
      return formatAsCodeOnly(analysis);

    case 'text-only':
      return formatAsTextOnly(analysis);

    default:
      return formatAsSummary(analysis);
  }
}

/**
 * Format as complete JSON response.
 */
function formatAsFullJSON(response: AIResponse<ScreenshotAnalysis>): string {
  return JSON.stringify(response, null, 2);
}

/**
 * Format as summary (text + code blocks).
 */
function formatAsSummary(analysis: ScreenshotAnalysis): string {
  const parts: string[] = [];

  if (analysis.text) {
    parts.push(analysis.text);
  }

  if (analysis.codeBlocks && analysis.codeBlocks.length > 0) {
    if (parts.length > 0) {
      parts.push(''); // Empty line separator
    }

    analysis.codeBlocks.forEach((block, idx) => {
      if (idx > 0) {
        parts.push(''); // Separator between code blocks
      }

      if (block.language) {
        parts.push(`// ${block.language}`);
      }

      parts.push(block.code);
    });
  }

  return parts.join('\n');
}

/**
 * Format as code blocks only.
 */
function formatAsCodeOnly(analysis: ScreenshotAnalysis): string {
  if (!analysis.codeBlocks || analysis.codeBlocks.length === 0) {
    return 'No code blocks found.';
  }

  return analysis.codeBlocks
    .map((block, idx) => {
      const parts: string[] = [];

      if (block.language) {
        parts.push(`// ${block.language}`);
      }

      if (block.startLine !== undefined && block.endLine !== undefined) {
        parts.push(`// Lines ${block.startLine}-${block.endLine}`);
      }

      parts.push(block.code);

      return parts.join('\n');
    })
    .join('\n\n');
}

/**
 * Format as text only.
 */
function formatAsTextOnly(analysis: ScreenshotAnalysis): string {
  if (!analysis.text) {
    return 'No text content found.';
  }

  return analysis.text;
}

/**
 * Format error response for export.
 */
function formatErrorForExport(response: AIResponse<ScreenshotAnalysis>): string {
  if (response.error) {
    return `Error: ${response.error.code}\n${response.error.message}`;
  }
  return 'Unknown error occurred';
}

/**
 * Get default export format.
 */
export function getDefaultExportFormat(): ExportFormat {
  return 'summary';
}

/**
 * Get human-readable format name.
 */
export function getFormatDisplayName(format: ExportFormat): string {
  switch (format) {
    case 'full-json':
      return 'Full JSON';
    case 'summary':
      return 'Summary';
    case 'code-only':
      return 'Code Only';
    case 'text-only':
      return 'Text Only';
    default:
      return 'Summary';
  }
}
