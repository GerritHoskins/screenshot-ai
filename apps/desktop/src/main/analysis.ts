/**
 * Analysis Service - Wires AI providers into Electron main process
 */

import type { AIResponse, ScreenshotAnalysis } from '@shared-types/ai-response';
import { createSuccessResponse, createErrorResponse, createAIError } from '@shared-types/ai-response';
import { createProvider, type ProviderType } from '@providers';
import { getApiKey } from '@security/keychain';
import { 
  generateScreenshotAnalysisPrompt,
  generateFeedbackBasedRetryPrompt 
} from '@prompts/templates';
import type { ProviderConfig } from '@providers/base';
import { validateAndNormalizeScreenshotAnalysis, formatValidationErrors } from '@shared-types/validation';
import { loadUnifiedContext, formatUnifiedContextAsText } from '@context/unified-loader';
import { scanForSecrets } from '@context/secret-scanner';

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ============================================================================
// Analysis Service Configuration
// ============================================================================

export interface AnalysisConfig {
  provider: ProviderType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  maxRetries?: number;
  workspaceContextEnabled?: boolean;
  workspaceRoot?: string;
}

const DEFAULT_CONFIG: Required<Omit<AnalysisConfig, 'provider' | 'workspaceContextEnabled' | 'workspaceRoot'>> = {
  model: '', // Will use provider default
  maxTokens: 4096,
  temperature: 0.1,
  timeout: 30000,
  maxRetries: 3,
};

// ============================================================================
// Analysis Service
// ============================================================================

export class AnalysisService {
  public readonly providerType: ProviderType;
  private config: Required<Omit<AnalysisConfig, 'provider' | 'workspaceContextEnabled' | 'workspaceRoot'>> & {
    workspaceContextEnabled?: boolean;
    workspaceRoot?: string;
  };

  constructor(config: AnalysisConfig) {
    // Ensure provider is valid
    if (!config.provider || (config.provider !== 'openai' && config.provider !== 'anthropic')) {
      this.providerType = 'openai';
    } else {
      this.providerType = config.provider;
    }
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Analyze a screenshot image using the configured AI provider.
   * @param image - Screenshot image buffer
   * @param previousFeedback - Optional feedback from previous attempt ('positive' | 'negative')
   * @param workspaceRoot - Optional workspace root directory for context loading
   */
  async analyzeScreenshot(
    image: Buffer,
    previousFeedback?: 'positive' | 'negative' | null,
    workspaceRoot?: string
  ): Promise<AIResponse<ScreenshotAnalysis>> {
    // Get API key from keychain
    const apiKey = await getApiKey(this.providerType);
    if (!apiKey) {
      return {
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: `API key not found for ${this.providerType}. Please configure it in settings.`,
          retryable: false,
        },
        metadata: {
          model: this.config.model || 'unknown',
          provider: this.providerType,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          attemptNumber: 1,
        },
      };
    }

    // Persisted settings are enforced by the shared loader used by preview.
    let workspaceContextText = '';
    if (this.config.workspaceContextEnabled !== false) {
      try {
        const context = await loadUnifiedContext({ workspaceRoot: workspaceRoot ?? this.config.workspaceRoot });
        const scan = scanForSecrets(context.files);
        if (scan.hasSecrets) {
          return this.privacyError();
        }
        workspaceContextText = formatUnifiedContextAsText(context);
      } catch {
        return this.privacyError('Context could not be verified. Review context settings or disable repository context and try again.');
      }
    }

    // Generate prompt (use feedback-aware prompt if retrying with feedback)
    let prompt: string;
    let usingCustomPrompt = false;
    if (previousFeedback) {
      // Use feedback-based retry prompt template
      // This provides better structure and consistency with the prompt system
      prompt = generateFeedbackBasedRetryPrompt(previousFeedback, 2);
      // Add workspace context to retry prompt if available
      if (workspaceContextText) {
        prompt = `${prompt}\n\n${workspaceContextText}`;
      }
    } else {
      // Use standard prompt with workspace context
      const customPrompt = loadCustomPrompt();
      if (customPrompt) {
        prompt = customPrompt;
        usingCustomPrompt = true;
        if (workspaceContextText) {
          prompt = `${prompt}\n\n${workspaceContextText}`;
        }
      } else {
        prompt = generateScreenshotAnalysisPrompt(workspaceContextText);
      }
    }

    // Check if custom prompt already specifies its own JSON schema
    // Look for: explicit key definitions OR confidence field mention with JSON instruction
    const hasCustomSchema = usingCustomPrompt && (
      // Has explicit JSON keys definition (e.g., "with keys: summary, issues")
      /with\s+keys?[:\s]/i.test(prompt) ||
      // Has confidence field (with or without quotes) AND JSON mention
      (/confidence/i.test(prompt) && /json/i.test(prompt))
    );

    if (usingCustomPrompt && !hasCustomSchema) prompt = ensureSchemaHint(prompt);
    // Check custom prompts and tree/path text as well as file contents.
    if (scanForSecrets([{ path: 'prompt.txt', content: prompt, size: Buffer.byteLength(prompt), truncated: false }]).hasSecrets) {
      return this.privacyError();
    }

    // Create provider with config
    const providerConfig: ProviderConfig = {
      model: this.config.model || this.getDefaultModel(),
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      retryBaseDelay: 1000,
      retryMaxDelay: 10000,
    };

    const provider = createProvider(this.providerType, {
      ...providerConfig,
      apiKey,
    });

    // Validate provider config
    const isValid = await provider.validateConfig();
    if (!isValid) {
      return {
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: `Invalid API key format for ${this.providerType}`,
          retryable: false,
        },
        metadata: {
          model: providerConfig.model,
          provider: this.providerType,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          attemptNumber: 1,
        },
      };
    }

    // Execute analysis
    try {
      const response = await provider.complete<ScreenshotAnalysis>(prompt, image);

      // Validate response data if successful
      if (response.success && response.data) {
        // For custom prompts, skip strict validation and pass through the data
        // Custom prompts define their own schema
        if (usingCustomPrompt) {
          // Ensure confidence exists for display purposes, default to 0.5 if not present
          const customData = {
            ...response.data,
            confidence: (response.data as any).confidence ?? 0.5,
          };
          return createSuccessResponse(customData as ScreenshotAnalysis, response.metadata);
        }

        const validation = validateAndNormalizeScreenshotAnalysis(response.data);

        if (!validation.valid || !validation.data) {
          return createErrorResponse(
            createAIError('VALIDATION_ERROR', formatValidationErrors(validation.errors!), {
              details: { errors: validation.errors },
            }),
            response.metadata
          );
        }
        const successResponse = createSuccessResponse(validation.data, response.metadata);
        return successResponse;
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          retryable: true,
          cause: error instanceof Error ? error : undefined,
        },
        metadata: {
          model: providerConfig.model,
          provider: this.providerType,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          attemptNumber: 1,
        },
      };
    }
  }

  // Note: Feedback-aware prompt generation is now handled by generateFeedbackBasedRetryPrompt()
  // from @prompts/templates for consistency and better prompt engineering

  /**
   * Get default model for the provider.
   */
  private privacyError(message = 'Potential sensitive data detected. Remove it from context or custom prompts, or disable repository context, then try again.'): AIResponse<ScreenshotAnalysis> {
    return createErrorResponse(createAIError('INVALID_REQUEST', message), {
      model: this.config.model || this.getDefaultModel(), provider: this.providerType,
      promptTokens: 0, completionTokens: 0, latencyMs: 0, attemptNumber: 1,
    });
  }

  private getDefaultModel(): string {
    switch (this.providerType) {
      case 'openai':
        return 'gpt-5.2';
      case 'anthropic':
        return 'claude-sonnet-4-5-20250929'; // Updated to Claude Sonnet 4.5
      default:
        return 'unknown';
    }
  }

  /**
   * Check if API key is configured.
   */
  async hasApiKey(): Promise<boolean> {
    const key = await getApiKey(this.providerType);
    return key !== null;
  }
}

// ============================================================================
// Default Instance
// ============================================================================

let defaultService: AnalysisService | null = null;

/**
 * Get current provider from settings.
 */
function getProviderFromSettings(): ProviderType {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const provider = typeof settings.provider === 'object' ? settings.provider?.selectedProvider : settings.provider;
      if (provider === 'openai' || provider === 'anthropic') return provider;
    }
  } catch {
    // Fall back to default
  }
  return 'openai';
}

/**
 * Get or create the default analysis service.
 * Uses OpenAI by default, but loads from settings if available.
 */
export function getAnalysisService(config?: AnalysisConfig): AnalysisService {
  if (!config) {
    // Load from settings if no config provided
    const provider = getProviderFromSettings();
    const model = getModelFromSettings(provider);
    config = { provider, model };
  }
  
  // Re-read config on every capture/retry so privacy and provider changes take effect.
  defaultService = new AnalysisService(config);
  return defaultService;
}

/**
 * Get model from settings for the given provider.
 */
function getModelFromSettings(_provider: ProviderType): string | undefined {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const model = settings.provider?.selectedModel ?? settings.model;
      if (typeof model === 'string') return model;
    }
  } catch {
    // Fall back to default
  }
  return undefined; // Will use provider default
}

// ============================================================================
// Custom Prompt Loader
// ============================================================================

function loadCustomPrompt(): string | null {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!(settings.prompt?.useCustom ?? settings.promptEnabled)) return null;
    if (typeof settings.prompt?.customText === 'string') return settings.prompt.customText.trim() || null;

    const promptPath = path.join(app.getPath('userData'), 'custom-prompt.txt');
    if (!fs.existsSync(promptPath)) return null;
    const text = fs.readFileSync(promptPath, 'utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function ensureSchemaHint(prompt: string): string {
  // If prompt already has full JSON instructions, don't modify
  if (prompt.includes('"confidence"') && prompt.toLowerCase().includes('json')) {
    return prompt;
  }

  // Add comprehensive instructions for custom prompts
  const instructions = `

## CRITICAL: Output Requirements
You MUST respond with valid JSON only.
- No markdown code fences (\`\`\`json or \`\`\`)
- No explanatory text before or after the JSON
- Your entire response must be parseable by JSON.parse()

## Task
Analyze the provided screenshot image and return your analysis as JSON.
If the screenshot contains a question, answer it in the "answer" field.
Extract any visible text into the "text" field.
Extract any code blocks with their language.

## Response Schema
{
  "answer": "string (optional) - if the screenshot contains a question, provide a helpful answer here",
  "text": "string (optional) - extracted text content from the screenshot",
  "codeBlocks": [{"language": "string", "code": "string"}],
  "structuredData": "object (optional) - any structured data extracted",
  "confidence": "number 0.0-1.0 - how confident you are in the analysis"
}

Remember: Respond with valid JSON only. Nothing else.`;

  return `${prompt}${instructions}`;
}
