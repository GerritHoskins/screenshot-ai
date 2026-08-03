/**
 * Repository Error Handling - Phase 5
 * Standardized error codes and UI-friendly messages for repository operations
 */

// ============================================================================
// Error Codes
// ============================================================================

export type RepoErrorCode =
  | 'auth_required'      // Authentication token is missing or invalid
  | 'repo_not_found'     // Repository not found (404)
  | 'rate_limited'       // Rate limit exceeded
  | 'scope_denied'       // Token lacks required permissions
  | 'network'            // Network error (timeout, connection failed)
  | 'invalid_source'     // Source configuration is invalid
  | 'cache_error'        // Cache operation failed
  | 'unknown';          // Unknown error

// ============================================================================
// Error Types
// ============================================================================

export interface RepoError {
  code: RepoErrorCode;
  message: string;
  userMessage: string;      // User-friendly message
  actionHint: string;        // Actionable hint for user
  originalError?: Error;
  details?: Record<string, any>;
}

// ============================================================================
// Error Detection
// ============================================================================

/**
 * Detect error code from an error or HTTP response.
 */
export function detectRepoError(error: unknown, context?: {
  statusCode?: number;
  provider?: 'github' | 'gitlab';
  operation?: string;
}): RepoError {
  const originalError = error instanceof Error ? error : undefined;
  const errorMessage = originalError?.message || String(error);

  // Check for HTTP status codes
  if (context?.statusCode) {
    const status = context.statusCode;

    if (status === 401 || status === 403) {
      // Check if it's a scope issue or auth issue
      if (errorMessage.includes('scope') || errorMessage.includes('permission')) {
        return createRepoError('scope_denied', {
          message: errorMessage,
          provider: context.provider,
          operation: context.operation,
        });
      }
      return createRepoError('auth_required', {
        message: errorMessage,
        provider: context.provider,
        operation: context.operation,
      });
    }

    if (status === 404) {
      return createRepoError('repo_not_found', {
        message: errorMessage,
        provider: context.provider,
        operation: context.operation,
      });
    }

    if (status === 429) {
      return createRepoError('rate_limited', {
        message: errorMessage,
        provider: context.provider,
        operation: context.operation,
      });
    }
  }

  // Check error message patterns
  if (errorMessage.includes('not found') || errorMessage.includes('404')) {
    return createRepoError('repo_not_found', {
      message: errorMessage,
      provider: context?.provider,
      operation: context?.operation,
    });
  }

  if (errorMessage.includes('forbidden') || errorMessage.includes('403') || errorMessage.includes('permission')) {
    return createRepoError('scope_denied', {
      message: errorMessage,
      provider: context?.provider,
      operation: context?.operation,
    });
  }

  if (errorMessage.includes('unauthorized') || errorMessage.includes('401') || errorMessage.includes('authentication')) {
    return createRepoError('auth_required', {
      message: errorMessage,
      provider: context?.provider,
      operation: context?.operation,
    });
  }

  if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
    return createRepoError('rate_limited', {
      message: errorMessage,
      provider: context?.provider,
      operation: context?.operation,
    });
  }

  if (
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND') ||
    errorMessage.includes('fetch')
  ) {
    return createRepoError('network', {
      message: errorMessage,
      provider: context?.provider,
      operation: context?.operation,
    });
  }

  if (errorMessage.includes('token not found') || errorMessage.includes('authentication token not found')) {
    return createRepoError('auth_required', {
      message: errorMessage,
      provider: context?.provider,
      operation: context?.operation,
    });
  }

  if (errorMessage.includes('missing owner') || errorMessage.includes('missing repo') || errorMessage.includes('invalid source')) {
    return createRepoError('invalid_source', {
      message: errorMessage,
      provider: context?.provider,
      operation: context?.operation,
    });
  }

  // Default to unknown error
  return createRepoError('unknown', {
    message: errorMessage,
    provider: context?.provider,
    operation: context?.operation,
  });
}

// ============================================================================
// Error Creation
// ============================================================================

/**
 * Create a standardized repository error.
 */
export function createRepoError(
  code: RepoErrorCode,
  options: {
    message?: string;
    provider?: 'github' | 'gitlab';
    operation?: string;
    originalError?: Error;
    details?: Record<string, any>;
  } = {}
): RepoError {
  const { message, provider, operation, originalError, details } = options;

  const errorMessages: Record<RepoErrorCode, { userMessage: string; actionHint: string }> = {
    auth_required: {
      userMessage: `Authentication required for ${provider || 'repository'}`,
      actionHint: 'Please authenticate in Settings → Context → Add Source',
    },
    repo_not_found: {
      userMessage: `Repository not found${provider ? ` on ${provider}` : ''}`,
      actionHint: 'Check the repository name and ensure it exists and is accessible',
    },
    rate_limited: {
      userMessage: `Rate limit exceeded${provider ? ` on ${provider}` : ''}`,
      actionHint: 'Please wait a few minutes and try again',
    },
    scope_denied: {
      userMessage: `Insufficient permissions${provider ? ` for ${provider}` : ''}`,
      actionHint: 'Check token permissions and ensure it has access to the repository',
    },
    network: {
      userMessage: 'Network error occurred',
      actionHint: 'Check your internet connection and try again',
    },
    invalid_source: {
      userMessage: 'Invalid source configuration',
      actionHint: 'Check source settings and ensure all required fields are filled',
    },
    cache_error: {
      userMessage: 'Cache operation failed',
      actionHint: 'Try refreshing the context or clearing the cache',
    },
    unknown: {
      userMessage: 'An unexpected error occurred',
      actionHint: 'Check logs for details or try again',
    },
  };

  const errorInfo = errorMessages[code];
  const finalMessage = message || errorInfo.userMessage;

  return {
    code,
    message: finalMessage,
    userMessage: errorInfo.userMessage,
    actionHint: errorInfo.actionHint,
    originalError,
    details: {
      ...details,
      provider,
      operation,
    },
  };
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format error for display in UI.
 */
export function formatRepoErrorForUI(error: RepoError): string {
  return `${error.userMessage}\n\n${error.actionHint}`;
}

/**
 * Format error for logging (no secrets).
 */
export function formatRepoErrorForLog(error: RepoError): Record<string, any> {
  return {
    code: error.code,
    message: error.message,
    userMessage: error.userMessage,
    actionHint: error.actionHint,
    details: error.details,
    // Explicitly exclude originalError to avoid logging sensitive data
  };
}

// ============================================================================
// Error Wrapping
// ============================================================================

/**
 * Wrap an error in a standardized RepoError.
 */
export function wrapRepoError(
  error: unknown,
  context?: {
    statusCode?: number;
    provider?: 'github' | 'gitlab';
    operation?: string;
  }
): RepoError {
  return detectRepoError(error, context);
}
