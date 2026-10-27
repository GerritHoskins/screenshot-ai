/**
 * Centralized Error Mapping - Workstream G
 * Maps various error types to AIResponse format.
 */

import type { AIResponse, AIError } from '../types/ai-response';
import { createErrorResponse, createAIError } from '../types/ai-response';
import type { ResponseMetadata } from '../types/ai-response';

// ============================================================================
// Error Categories
// ============================================================================

export interface ErrorContext {
  component: string;
  operation: string;
  metadata?: ResponseMetadata;
  originalError?: unknown;
}

// ============================================================================
// Error Mapper
// ============================================================================

export class ErrorMapper {
  /**
   * Map an error to AIResponse format.
   */
  static mapToAIResponse<T = never>(
    error: unknown,
    context: ErrorContext
  ): AIResponse<T> {
    const aiError = this.mapToAIError(error, context);
    const metadata: ResponseMetadata = context.metadata || {
      model: 'unknown',
      provider: 'openai',
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      attemptNumber: 1,
    };

    return createErrorResponse(aiError, metadata);
  }

  /**
   * Map an error to AIError format.
   */
  static mapToAIError(error: unknown, context: ErrorContext): AIError {
    // Handle AIError directly
    if (this.isAIError(error)) {
      return error;
    }

    // Handle Error objects
    if (error instanceof Error) {
      return this.mapErrorObject(error, context);
    }

    // Handle string errors
    if (typeof error === 'string') {
      return createAIError('UNKNOWN_ERROR', error, {
        details: { context: context.component, operation: context.operation },
      });
    }

    // Handle unknown error types
    return createAIError('UNKNOWN_ERROR', 'An unknown error occurred', {
      details: {
        context: context.component,
        operation: context.operation,
        errorType: typeof error,
      },
      cause: error instanceof Error ? error : undefined,
    });
  }

  /**
   * Check if error is already an AIError.
   */
  private static isAIError(error: unknown): error is AIError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      'retryable' in error
    );
  }

  /**
   * Map Error object to AIError.
   */
  private static mapErrorObject(error: Error, context: ErrorContext): AIError {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Network errors
    if (
      name.includes('network') ||
      name.includes('fetch') ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout')
    ) {
      return createAIError('NETWORK_ERROR', error.message, {
        cause: error,
        details: { context: context.component, operation: context.operation },
      });
    }

    // Timeout errors
    if (
      name.includes('timeout') ||
      message.includes('timeout') ||
      message.includes('timed out')
    ) {
      // Extract timeout duration if available
      const timeoutMatch = message.match(/(\d+)\s*(ms|s|seconds?|milliseconds?)/i);
      const timeoutValue = timeoutMatch ? timeoutMatch[1] : undefined;
      const timeoutUnit = timeoutMatch ? timeoutMatch[2] : undefined;
      
      const userMessage = timeoutValue && timeoutUnit
        ? `Request timed out after ${timeoutValue}${timeoutUnit}. Check your internet connection or try again.`
        : 'Request timed out. Check your internet connection or try again.';
      
      return createAIError('TIMEOUT', userMessage, {
        cause: error,
        details: {
          context: context.component,
          operation: context.operation,
          timeoutValue,
          timeoutUnit,
        },
      });
    }

    // Parse errors
    if (
      name.includes('parse') ||
      name.includes('json') ||
      message.includes('parse') ||
      message.includes('json') ||
      message.includes('unexpected token')
    ) {
      return createAIError('PARSE_ERROR', error.message, {
        cause: error,
        details: { context: context.component, operation: context.operation },
      });
    }

    // Validation errors
    if (
      name.includes('validation') ||
      name.includes('invalid') ||
      message.includes('validation') ||
      message.includes('invalid')
    ) {
      return createAIError('VALIDATION_ERROR', error.message, {
        cause: error,
        details: { context: context.component, operation: context.operation },
      });
    }

    // Auth errors
    if (
      name.includes('auth') ||
      message.includes('401') ||
      message.includes('403') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('api key') ||
      message.includes('authentication')
    ) {
      return createAIError('AUTH_ERROR', error.message, {
        cause: error,
        details: { context: context.component, operation: context.operation },
        retryable: false,
      });
    }

    // Rate limit errors
    if (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('too many requests')
    ) {
      return createAIError('RATE_LIMIT', error.message, {
        cause: error,
        details: { context: context.component, operation: context.operation },
      });
    }

    // Default to unknown error
    return createAIError('UNKNOWN_ERROR', error.message, {
      cause: error,
      details: { context: context.component, operation: context.operation },
    });
  }

  /**
   * Map capture-specific errors.
   */
  static mapCaptureError(error: unknown, context: Partial<ErrorContext> = {}): AIResponse<never> {
    const fullContext: ErrorContext = {
      component: 'capture',
      operation: 'screen_capture',
      ...context,
    };

    // Override for permission errors
    if (error instanceof Error && error.message.includes('permission')) {
      return createErrorResponse(
        createAIError('AUTH_ERROR', 'Screen recording permission denied. Please enable it in System Settings.', {
          retryable: false,
          details: { platform: process.platform },
        }),
        {
          model: 'unknown',
          provider: 'openai',
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          attemptNumber: 1,
        }
      );
    }

    return this.mapToAIResponse(error, fullContext);
  }

  /**
   * Map provider-specific errors.
   */
  static mapProviderError(
    error: unknown,
    provider: string,
    metadata?: ResponseMetadata
  ): AIResponse<never> {
    return this.mapToAIResponse(error, {
      component: 'provider',
      operation: `ai_analysis_${provider}`,
      metadata,
    });
  }

  /**
   * Map IPC errors.
   */
  static mapIPCError(error: unknown, channel: string): AIResponse<never> {
    return this.mapToAIResponse(error, {
      component: 'ipc',
      operation: `ipc_${channel}`,
    });
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function mapErrorToAIResponse<T = never>(
  error: unknown,
  context: ErrorContext
): AIResponse<T> {
  return ErrorMapper.mapToAIResponse(error, context);
}

export function mapCaptureError(error: unknown): AIResponse<never> {
  return ErrorMapper.mapCaptureError(error);
}

export function mapProviderError(
  error: unknown,
  provider: string,
  metadata?: ResponseMetadata
): AIResponse<never> {
  return ErrorMapper.mapProviderError(error, provider, metadata);
}
