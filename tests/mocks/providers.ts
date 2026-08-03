/**
 * Mock Providers - Workstream H
 * Mock implementations for testing.
 */

import type { AIResponse, AIError, ResponseMetadata } from '../../src/types/ai-response';
import { createSuccessResponse, createErrorResponse, createAIError } from '../../src/types/ai-response';
import type { AIProvider, ProviderConfig } from '../../src/providers/base';
import { DEFAULT_PROVIDER_CONFIG } from '../../src/providers/base';

// ============================================================================
// Mock Configuration
// ============================================================================

export interface MockProviderOptions {
  /** Response to return on success */
  response?: unknown;
  /** Error to throw/return */
  error?: AIError;
  /** Number of failures before success */
  failuresBeforeSuccess?: number;
  /** Type of failure to simulate */
  failureType?: 'rate_limit' | 'timeout' | 'auth' | 'parse';
  /** Delay before responding (ms) */
  delayMs?: number;
  /** Whether to track calls */
  trackCalls?: boolean;
}

export interface MockProviderCall {
  prompt: string;
  image?: Buffer;
  timestamp: Date;
}

// ============================================================================
// Base Mock Provider
// ============================================================================

export class MockProvider implements AIProvider {
  readonly name: 'openai' | 'anthropic';
  readonly config: ProviderConfig;
  
  private options: MockProviderOptions;
  private callCount = 0;
  private calls: MockProviderCall[] = [];

  constructor(
    name: 'openai' | 'anthropic',
    options: MockProviderOptions = {},
    config?: Partial<ProviderConfig>
  ) {
    this.name = name;
    this.options = options;
    this.config = {
      ...DEFAULT_PROVIDER_CONFIG,
      model: name === 'openai' ? 'gpt-4-vision-preview' : 'claude-3-sonnet',
      ...config,
    };
  }

  async validateConfig(): Promise<boolean> {
    return true;
  }

  async complete<T>(prompt: string, image?: Buffer): Promise<AIResponse<T>> {
    this.callCount++;
    
    if (this.options.trackCalls) {
      this.calls.push({ prompt, image, timestamp: new Date() });
    }

    // Simulate delay
    if (this.options.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.options.delayMs));
    }

    const metadata: ResponseMetadata = {
      model: this.config.model,
      provider: this.name,
      promptTokens: Math.ceil(prompt.length / 4),
      completionTokens: 100,
      latencyMs: this.options.delayMs || 50,
      attemptNumber: this.callCount,
    };

    // Check if we should fail
    if (this.options.failuresBeforeSuccess && this.callCount <= this.options.failuresBeforeSuccess) {
      const error = this.createFailureError(this.options.failureType || 'rate_limit');
      return createErrorResponse(error, metadata);
    }

    // Return error if configured
    if (this.options.error) {
      return createErrorResponse(this.options.error, metadata);
    }

    // Return success response
    const response = this.options.response ?? { success: true };
    return createSuccessResponse(response as T, metadata);
  }

  private createFailureError(type: string): AIError {
    switch (type) {
      case 'rate_limit':
        return createAIError('RATE_LIMIT', 'Rate limit exceeded');
      case 'timeout':
        return createAIError('TIMEOUT', 'Request timed out');
      case 'auth':
        return createAIError('AUTH_ERROR', 'Invalid API key');
      case 'parse':
        return createAIError('PARSE_ERROR', 'Failed to parse response');
      default:
        return createAIError('UNKNOWN_ERROR', 'Unknown error');
    }
  }

  // Test utilities
  getCallCount(): number {
    return this.callCount;
  }

  getCalls(): MockProviderCall[] {
    return [...this.calls];
  }

  getLastCall(): MockProviderCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.callCount = 0;
    this.calls = [];
  }
}

// ============================================================================
// Specialized Mock Providers
// ============================================================================

export class MockOpenAIProvider extends MockProvider {
  constructor(options: MockProviderOptions = {}, config?: Partial<ProviderConfig>) {
    super('openai', options, {
      model: 'gpt-4-vision-preview',
      ...config,
    });
  }
}

export class MockAnthropicProvider extends MockProvider {
  constructor(options: MockProviderOptions = {}, config?: Partial<ProviderConfig>) {
    super('anthropic', options, {
      model: 'claude-sonnet-4-5-20250929',
      ...config,
    });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a mock provider that returns a specific response.
 */
export function createSuccessMock<T>(
  name: 'openai' | 'anthropic',
  response: T
): MockProvider {
  return new MockProvider(name, { response, trackCalls: true });
}

/**
 * Create a mock provider that fails with a specific error.
 */
export function createErrorMock(
  name: 'openai' | 'anthropic',
  errorCode: AIError['code'],
  errorMessage: string
): MockProvider {
  return new MockProvider(name, {
    error: createAIError(errorCode, errorMessage),
    trackCalls: true,
  });
}

/**
 * Create a mock provider that fails N times before succeeding.
 */
export function createRetryMock<T>(
  name: 'openai' | 'anthropic',
  failuresBeforeSuccess: number,
  response: T,
  failureType: MockProviderOptions['failureType'] = 'rate_limit'
): MockProvider {
  return new MockProvider(name, {
    response,
    failuresBeforeSuccess,
    failureType,
    trackCalls: true,
  });
}

/**
 * Create a mock provider with configurable delay.
 */
export function createDelayMock<T>(
  name: 'openai' | 'anthropic',
  delayMs: number,
  response: T
): MockProvider {
  return new MockProvider(name, {
    response,
    delayMs,
    trackCalls: true,
  });
}
