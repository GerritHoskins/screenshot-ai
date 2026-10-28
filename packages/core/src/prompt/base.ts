import { generateScreenshotAnalysisPrompt } from '../prompts/templates.js';
/** Legacy internal alias; the canonical prompt is generated from the shared template. */
export const basePrompt = generateScreenshotAnalysisPrompt();
