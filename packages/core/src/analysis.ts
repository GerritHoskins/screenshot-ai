import { createProvider, getDefaultModel, type CreateProviderOptions, type ProviderType } from './providers/index.js';
import { validateImageInput, cancelledError, isValidAbortSignal, safeModelMetadata, type ImageInput } from './providers/base.js';
import { generateScreenshotAnalysisPrompt, generateFeedbackBasedRetryPrompt, SCREENSHOT_ANALYSIS_SCHEMA } from './prompts/templates.js';
import { createAIError, createErrorResponse, type AIResponse, type ScreenshotAnalysis, type ResponseMetadata } from './types/ai-response.js';
import { validateAndNormalizeScreenshotAnalysis, formatValidationErrors } from './types/validation.js';

export interface AnalyzeOptions extends CreateProviderOptions {
  provider: ProviderType;
  timeoutMs?: number;
  prompt?: string;
  context?: string;
  feedback?: 'positive' | 'negative';
  signal?: AbortSignal;
}

/**
 * Analyze an explicit base64 image without accessing files, credentials, or UI.
 * Hosts own input consent, credential storage, and context/secret filtering.
 */
export async function analyzeImage(image: ImageInput, options: AnalyzeOptions): Promise<AIResponse<ScreenshotAnalysis>> {
  const providerType = options?.provider === 'anthropic' ? 'anthropic' : 'openai';
  const metadata: ResponseMetadata = {
    model: safeModelMetadata(options?.model, getDefaultModel(providerType)), provider: providerType,
    promptTokens: 0, completionTokens: 0, latencyMs: 0, attemptNumber: 1,
  };
  if (!options || typeof options !== 'object' || Array.isArray(options) || !['openai', 'anthropic'].includes(options.provider) || !validateImageInput(image) ||
      typeof options.apiKey !== 'string' ||
      (options.model !== undefined && (typeof options.model !== 'string' || options.model.trim().length === 0 || options.model !== options.model.trim())) ||
      (options.signal !== undefined && !isValidAbortSignal(options.signal)) ||
      (options.prompt !== undefined && typeof options.prompt !== 'string') ||
      (options.context !== undefined && typeof options.context !== 'string') ||
      (options.feedback !== undefined && !['positive', 'negative'].includes(options.feedback))) {
    return createErrorResponse(createAIError('INVALID_REQUEST', 'Invalid analysis input or options.'), metadata);
  }
  if (options.signal?.aborted) return createErrorResponse(cancelledError(), metadata);
  let prompt = options.prompt !== undefined
    ? options.prompt + '\n\nRespond with valid JSON only (no markdown, code fences, or prose outside JSON). Match this analysis schema:\n' + SCREENSHOT_ANALYSIS_SCHEMA
    : options.feedback ? generateFeedbackBasedRetryPrompt(options.feedback) : generateScreenshotAnalysisPrompt();
  if (options.context) prompt += '\n\n' + options.context;
  const provider = createProvider(options.provider, { ...options, timeout: options.timeoutMs ?? options.timeout });
  const result = await provider.complete<ScreenshotAnalysis>(prompt, image, { signal: options.signal });
  if (!result.success) return result;
  const validation = validateAndNormalizeScreenshotAnalysis(result.data);
  if (!validation.valid || !validation.data) {
    return createErrorResponse(createAIError('VALIDATION_ERROR', formatValidationErrors(validation.errors ?? [])), result.metadata);
  }
  return { ...result, data: validation.data };
}
