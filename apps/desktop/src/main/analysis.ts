/**
 * Analysis Service - Wires AI providers into Electron main process
 */

import type { AIResponse, ScreenshotAnalysis } from '@types/ai-response';
import { createSuccessResponse, createErrorResponse, createAIError } from '@types/ai-response';
import { createProvider, type ProviderType } from '@providers';
import { getApiKey } from '@security/keychain';
import { 
  generateScreenshotAnalysisPrompt,
  generateFeedbackBasedRetryPrompt 
} from '@prompts/templates';
import type { ProviderConfig } from '@providers/base';
import { validateAndNormalizeScreenshotAnalysis, formatValidationErrors } from '@types/validation';
import { loadWorkspaceContext, loadRelevantFiles, formatFilesAsContext } from '@context';
import { loadUnifiedContext, formatUnifiedContextAsText } from '@context/unified-loader';
import { scanForSecrets } from '@context/secret-scanner';
import { getLogger } from '@logging';

const logger = getLogger({ minLevel: 0 });
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
      console.warn('[AnalysisService] Invalid provider, defaulting to openai:', config.provider);
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

    // Load workspace context from all enabled sources (local, GitHub, GitLab)
    let workspaceContextText = '';
    console.log('[Analysis] Context config:', {
      workspaceContextEnabled: this.config.workspaceContextEnabled,
      configWorkspaceRoot: this.config.workspaceRoot,
      paramWorkspaceRoot: workspaceRoot,
    });
    if (this.config.workspaceContextEnabled !== false) {
      try {
        // Try unified context loader first (supports multiple sources)
        console.log('[Analysis] Loading unified context...');
        const unifiedContext = await loadUnifiedContext({
          includeFileTree: true,
          includeFileContents: true,
          maxFiles: 5,
          maxFileSize: 50 * 1024, // 50 KB per file
          maxTotalSize: 200 * 1024, // 200 KB total
        });
        console.log('[Analysis] Unified context result:', {
          fileCount: unifiedContext.files.length,
          sourceCount: unifiedContext.stats.sources.length,
          totalSize: unifiedContext.stats.totalSize,
        });

        if (unifiedContext.files.length > 0) {
          // Scan for secrets before including context
          const secretScan = scanForSecrets(unifiedContext.files);
          
          if (secretScan.hasSecrets && secretScan.riskLevel === 'high') {
            logger.warn('analysis', 'High-risk secrets detected in context', {
              matchCount: secretScan.matches.length,
              highRisk: secretScan.summary.high,
            });
            // Log warning but continue (user should have been warned in preview)
          }
          
          workspaceContextText = formatUnifiedContextAsText(unifiedContext);
          logger.info('analysis', 'Unified context loaded', {
            fileCount: unifiedContext.files.length,
            sourceCount: unifiedContext.stats.sources.length,
            totalSize: unifiedContext.stats.totalSize,
            secretsDetected: secretScan.hasSecrets,
            riskLevel: secretScan.riskLevel,
          });
        } else {
          // Fallback to legacy local workspace context
          console.log('[Analysis] Unified context empty, trying fallback...');
          const effectiveWorkspaceRoot = workspaceRoot || this.config.workspaceRoot;
          console.log('[Analysis] Effective workspace root:', effectiveWorkspaceRoot);
          if (effectiveWorkspaceRoot) {
            const workspaceContext = await loadWorkspaceContext(effectiveWorkspaceRoot);
            if (workspaceContext) {
              const loadedFiles = loadRelevantFiles(workspaceContext, {
                maxFiles: 5,
                maxFileSize: 50 * 1024, // 50 KB per file
                maxTotalSize: 200 * 1024, // 200 KB total
              });
              
              if (loadedFiles.length > 0) {
                workspaceContextText = formatFilesAsContext(loadedFiles);
                logger.info('analysis', 'Legacy workspace context loaded', {
                  workspaceRoot: workspaceContext.info.root,
                  fileCount: loadedFiles.length,
                });
              }
            }
          }
        }
      } catch (error) {
        logger.warn('analysis', 'Failed to load workspace context', { error });
        console.log('[Analysis] Context loading error:', error);
        // Continue without workspace context
      }
    } else {
      console.log('[Analysis] Workspace context disabled, skipping context loading');
    }

    console.log('[Analysis] Final workspace context length:', workspaceContextText.length);

    // Generate prompt (use feedback-aware prompt if retrying with feedback)
    let prompt: string;
    let usingCustomPrompt = false;
    if (previousFeedback) {
      // Use feedback-based retry prompt template
      // This provides better structure and consistency with the prompt system
      prompt = generateFeedbackBasedRetryPrompt(previousFeedback, 2);
      console.log('[Analysis] Using feedback-aware prompt');
      // Add workspace context to retry prompt if available
      if (workspaceContextText) {
        prompt = `${prompt}\n\n${workspaceContextText}`;
      }
    } else {
      // Use standard prompt with workspace context
      const customPrompt = loadCustomPrompt();
      console.log('[Analysis] Custom prompt loaded:', customPrompt ? 'YES' : 'NO');
      if (customPrompt) {
        console.log('[Analysis] Custom prompt preview:', customPrompt.slice(0, 200));
        prompt = customPrompt;
        usingCustomPrompt = true;
        if (workspaceContextText) {
          prompt = `${prompt}\n\n${workspaceContextText}`;
        }
      } else {
        console.log('[Analysis] Using default prompt template');
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

    if (hasCustomSchema) {
      console.log('[Analysis] Custom prompt has its own schema, not adding default schema');
    } else if (!usingCustomPrompt) {
      // Default prompts already have schema from generateScreenshotAnalysisPrompt
      console.log('[Analysis] Using default prompt (already has schema)');
    } else {
      // Custom prompt without schema - add default schema hint
      console.log('[Analysis] Custom prompt missing schema, adding default schema hint');
      prompt = ensureSchemaHint(prompt);
    }
    console.log('[Analysis] Final prompt length:', prompt.length);
    console.log('[Analysis] Final prompt preview:', prompt.slice(0, 300));

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
    } as any);

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

      // Debug: Log raw AI response
      console.log('[Analysis] Raw AI response:', {
        success: response.success,
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : [],
      });
      console.log('[Analysis] Raw data:', JSON.stringify(response.data, null, 2));

      // Validate response data if successful
      if (response.success && response.data) {
        // For custom prompts, skip strict validation and pass through the data
        // Custom prompts define their own schema
        if (usingCustomPrompt) {
          console.log('[Analysis] Custom prompt - skipping strict validation');
          console.log('[Analysis] Returning custom prompt data:', Object.keys(response.data));
          // Ensure confidence exists for display purposes, default to 0.5 if not present
          const customData = {
            ...response.data,
            confidence: (response.data as any).confidence ?? 0.5,
          };
          return createSuccessResponse(customData as ScreenshotAnalysis, response.metadata);
        }

        const validation = validateAndNormalizeScreenshotAnalysis(response.data);
        console.log('[Analysis] Validation result:', {
          valid: validation.valid,
          errors: validation.errors,
          dataKeys: validation.data ? Object.keys(validation.data) : [],
        });

        if (!validation.valid) {
          // Replace response with validation error
          console.log('[Analysis] Validation FAILED:', validation.errors);
          return createErrorResponse(
            createAIError('VALIDATION_ERROR', formatValidationErrors(validation.errors!), {
              details: { errors: validation.errors },
            }),
            response.metadata
          );
        }
        // Use validated data
        console.log('[Analysis] Validation PASSED, returning data:', {
          hasAnswer: !!validation.data?.answer,
          hasText: !!validation.data?.text,
          textLength: validation.data?.text?.length,
          hasCodeBlocks: !!(validation.data?.codeBlocks?.length),
          hasStructuredData: !!validation.data?.structuredData,
          confidence: validation.data?.confidence,
        });
        const successResponse = createSuccessResponse(validation.data, response.metadata);
        console.log('[Analysis] Success response data keys:', Object.keys(successResponse.data || {}));
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
      if (settings.provider === 'openai' || settings.provider === 'anthropic') {
        return settings.provider;
      }
    }
  } catch (error) {
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
  
  // Create new service if provider changed, or if model is specified and different
  if (!defaultService || 
      config.provider !== defaultService.providerType ||
      (config.model && config.model !== (defaultService as any).config?.model)) {
    defaultService = new AnalysisService(config);
  }
  return defaultService;
}

/**
 * Get model from settings for the given provider.
 */
function getModelFromSettings(provider: ProviderType): string | undefined {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.model) {
        return settings.model;
      }
    }
  } catch (error) {
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
    if (!settings.promptEnabled) return null;

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
