/**
 * Prompt Templates - Workstream B
 * JSON-only prompt templates for AI interactions.
 */


// ============================================================================
// Schema Definitions (for prompt injection)
// ============================================================================

export const SCREENSHOT_ANALYSIS_SCHEMA = `{
  "answer": "string (optional) - if the screenshot contains a question, provide a helpful answer here",
  "text": "string (optional) - extracted text content from the screenshot",
  "codeBlocks": [
    {
      "language": "string (optional) - programming language",
      "code": "string - the code content",
      "startLine": "number (optional)",
      "endLine": "number (optional)"
    }
  ],
  "structuredData": "object (optional) - any structured data found",
  "confidence": "number - confidence score from 0 to 1"
}`;

export const SCREENSHOT_ANALYSIS_EXAMPLE = `{
  "answer": "To center a div in CSS, here are the most reliable methods:\\n\\n**1. Flexbox (Recommended):**\\n\`\`\`css\\n.parent {\\n  display: flex;\\n  justify-content: center;\\n  align-items: center;\\n}\\n\`\`\`\\n\\n**2. CSS Grid:**\\n\`\`\`css\\n.parent {\\n  display: grid;\\n  place-items: center;\\n}\\n\`\`\`\\n\\n**3. Absolute Positioning + Transform:**\\n\`\`\`css\\n.child {\\n  position: absolute;\\n  top: 50%;\\n  left: 50%;\\n  transform: translate(-50%, -50%);\\n}\\n\`\`\`\\n\\nFlexbox is the most versatile and widely supported approach for most use cases.",
  "text": "How do I center a div in CSS?",
  "codeBlocks": [],
  "structuredData": null,
  "confidence": 0.98
}`;

// ============================================================================
// Base Prompt Template
// ============================================================================

export interface BasePromptParams {
  role: string;
  context?: string;
  schemaDefinition: string;
  exampleResponse: string;
  taskDescription: string;
}

/**
 * Generate a base prompt with JSON-only output enforcement.
 */
export function generateBasePrompt(params: BasePromptParams): string {
  const { role, context, schemaDefinition, exampleResponse, taskDescription } = params;

  return `You are a ${role}.${context ? ` ${context}` : ''}

## CRITICAL: Output Requirements
You MUST respond with valid JSON only.
- No markdown code fences (\`\`\`json or \`\`\`)
- No explanatory text before or after the JSON
- No comments within the JSON
- Your entire response must be parseable by JSON.parse()

## Response Schema
${schemaDefinition}

## Example Response
${exampleResponse}

## Task
${taskDescription}

Remember: Respond with valid JSON only. Nothing else.`;
}

// ============================================================================
// Retry Prompt Template
// ============================================================================

export interface RetryPromptParams {
  originalTask: string;
  errorType: string;
  errorDetails: string;
  attemptNumber: number;
  maxAttempts: number;
}

/**
 * Generate a retry prompt that references the previous error.
 */
export function generateRetryPrompt(params: RetryPromptParams): string {
  const { originalTask, errorType, errorDetails, attemptNumber, maxAttempts } = params;

  return `Your previous response could not be processed.

## Error Information
- Error Type: ${errorType}
- Details: ${errorDetails}
- Attempt: ${attemptNumber} of ${maxAttempts}

## Requirements
Please try again, ensuring:
1. Response is valid JSON (no markdown, no code fences, no extra text)
2. All required fields are present
3. Field types match the schema exactly
4. No trailing commas or syntax errors

## Original Task
${originalTask}

Respond with corrected JSON only. This is attempt ${attemptNumber} of ${maxAttempts}.`;
}

// ============================================================================
// Screenshot Analysis Prompts
// ============================================================================

/**
 * Generate prompt for screenshot analysis.
 * @param additionalContext - Additional context string (e.g., workspace context)
 */
export function generateScreenshotAnalysisPrompt(additionalContext?: string): string {
  // Build a natural, conversational prompt
  let prompt = `Look at this screenshot and help me with whatever you see.

If there's a question, answer it thoroughly.
If there's an error, explain what's wrong and how to fix it.
If there's code, analyze it and suggest improvements if needed.
If it's a diagram or architecture, explain what it shows.
If it's UI/design, provide feedback on usability and implementation.

Be helpful, practical, and specific. Don't just describe what you see - provide actionable insights.`;

  // Add workspace context if provided
  if (additionalContext) {
    prompt += `\n\n${additionalContext}`;
  }

  // Add minimal JSON output requirement
  prompt += `

Respond with valid JSON only (no markdown, no code fences):
{
  "answer": "Your helpful response here - the main content",
  "text": "Any text extracted from the screenshot (optional)",
  "codeBlocks": [{"language": "...", "code": "..."}],
  "structuredData": { "any": "additional structured info" },
  "confidence": 0.0 to 1.0
}`;

  return prompt;
}

/**
 * Generate retry prompt for failed screenshot analysis.
 */
export function generateScreenshotAnalysisRetryPrompt(
  errorType: string,
  errorDetails: string,
  attemptNumber: number,
  maxAttempts: number = 3
): string {
  return generateRetryPrompt({
    originalTask: `Analyze the screenshot and extract text, code blocks, and structured data. Return as JSON matching the schema.`,
    errorType,
    errorDetails,
    attemptNumber,
    maxAttempts,
  });
}

/**
 * Generate feedback-aware retry prompt.
 * Used when user provides feedback on previous analysis.
 */
export function generateFeedbackBasedRetryPrompt(
  feedback: 'positive' | 'negative',
  _attemptNumber: number = 2
): string {
  const baseTask = `Analyze the screenshot and extract text, code blocks, and structured data. Return as JSON matching the schema.`;

  if (feedback === 'positive') {
    return generateBasePrompt({
      role: 'expert image analyst specializing in extracting text and code from screenshots',
      context: 'The user found the previous analysis helpful. Provide a similar quality analysis, but consider adding more detail or alternative perspectives if relevant.',
      schemaDefinition: SCREENSHOT_ANALYSIS_SCHEMA,
      exampleResponse: SCREENSHOT_ANALYSIS_EXAMPLE,
      taskDescription: `${baseTask}

The user indicated the previous analysis was helpful. Build upon that success with:
- Similar accuracy and approach
- Additional detail where relevant
- Alternative perspectives if they add value
- Maintain the same confidence calibration`,
    });
  } else {
    return generateBasePrompt({
      role: 'expert image analyst specializing in extracting text and code from screenshots',
      context: 'The user indicated the previous analysis needed improvement. Provide a different angle and approach.',
      schemaDefinition: SCREENSHOT_ANALYSIS_SCHEMA,
      exampleResponse: SCREENSHOT_ANALYSIS_EXAMPLE,
      taskDescription: `${baseTask}

The user indicated the previous analysis needed improvement. Please provide a different angle:
- If prior answer focused on bugs, focus on UX/design critique or vice versa
- If prior answer was high-level, provide concrete, actionable steps
- If it was verbose, shorten with bullet points
- Focus on what might have been missed or misunderstood
- Adjust your confidence scoring based on what you're actually certain about`,
    });
  }
}

// ============================================================================
// Prompt Utilities
// ============================================================================

/**
 * Estimate token count for a prompt (rough approximation).
 * Uses ~4 characters per token as a heuristic.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate prompt to fit within token budget.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimatedTokens = estimateTokenCount(text);
  if (estimatedTokens <= maxTokens) {
    return text;
  }

  const targetLength = maxTokens * 4;
  return text.slice(0, targetLength) + '\n[Content truncated due to length]';
}

// ============================================================================
// Prompt Versioning
// ============================================================================

export const PROMPT_VERSION = '1.0.0';

export interface PromptMetadata {
  version: string;
  type: 'base' | 'retry' | 'screenshot-analysis';
  generatedAt: string;
}

/**
 * Create prompt with metadata for tracking.
 */
export function createPromptWithMetadata(
  prompt: string,
  type: PromptMetadata['type']
): { prompt: string; metadata: PromptMetadata } {
  return {
    prompt,
    metadata: {
      version: PROMPT_VERSION,
      type,
      generatedAt: new Date().toISOString(),
    },
  };
}
