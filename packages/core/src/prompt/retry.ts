import { generateFeedbackBasedRetryPrompt } from '../prompts/templates.js';
/** Legacy internal alias; retry instructions share the canonical prompt implementation. */
export const retryPrompt = generateFeedbackBasedRetryPrompt('negative');
