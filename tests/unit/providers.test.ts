/**
 * Provider Error Handling Unit Tests - Workstream H.1
 * Tests for provider error handling, retry logic, and timeout behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createSuccessMock,
  createRetryMock,
  createDelayMock,
} from '../mocks/providers';
import {
  calculateBackoffDelay,
  withRetry,
  withTimeout,
  mapError,
  type ErrorMapping,
} from '../../src/providers/base';
import { createAIError, createSuccessResponse, createErrorResponse } from '../../src/types/ai-response';
import type { ResponseMetadata } from '../../src/types/ai-response';

describe('calculateBackoffDelay', () => {
  it('calculates exponential backoff', () => {
    const delay1 = calculateBackoffDelay(1, 1000, 10000);
    const delay2 = calculateBackoffDelay(2, 1000, 10000);
    const delay3 = calculateBackoffDelay(3, 1000, 10000);

    // Each attempt should have longer delay
    expect(delay2).toBeGreaterThan(delay1);
    expect(delay3).toBeGreaterThan(delay2);
  });

  it('respects max delay', () => {
    const delay = calculateBackoffDelay(10, 1000, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it('adds jitter', () => {
    const delays = Array.from({ length: 10 }, () =>
      calculateBackoffDelay(2, 1000, 10000)
    );

    // Should have some variation due to jitter
    const uniqueDelays = new Set(delays.map(d => Math.floor(d / 100)));
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });
});

describe('withTimeout', () => {
  it('resolves if promise completes before timeout', async () => {
    const promise = Promise.resolve('success');
    const timeoutError = createAIError('TIMEOUT', 'Timeout');

    const result = await withTimeout(promise, 1000, timeoutError);
    expect(result).toBe('success');
  });

  it('rejects with timeout error if promise exceeds timeout', async () => {
    const promise = new Promise(resolve => setTimeout(() => resolve('slow'), 2000));
    const timeoutError = createAIError('TIMEOUT', 'Timeout');

    await expect(withTimeout(promise, 100, timeoutError)).rejects.toEqual(
      expect.objectContaining({ code: 'TIMEOUT' })
    );
  });

  it('cleans up timeout on success', async () => {
    const promise = Promise.resolve('fast');
    const timeoutError = createAIError('TIMEOUT', 'Timeout');

    // Should not throw
    await expect(withTimeout(promise, 1000, timeoutError)).resolves.toBe('fast');
  });
});

describe('withRetry', () => {
  const createMetadata = (attempt: number, latencyMs: number): ResponseMetadata => ({
    model: 'test',
    provider: 'openai',
    promptTokens: 0,
    completionTokens: 0,
    latencyMs,
    attemptNumber: attempt,
  });

  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue({
      success: true,
      data: { test: 'data' },
      metadata: createMetadata(1, 100),
    });

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
    }, createMetadata);

    expect(result.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable errors', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(
        createErrorResponse(
          createAIError('RATE_LIMIT', 'Rate limit', { retryable: true }),
          createMetadata(1, 50)
        )
      )
      .mockResolvedValueOnce(
        createSuccessResponse({ test: 'data' }, createMetadata(2, 200))
      );

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
    }, createMetadata);

    expect(result.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops retrying on non-retryable errors', async () => {
    const fn = vi.fn().mockResolvedValue(
      createErrorResponse(
        createAIError('AUTH_ERROR', 'Invalid key', { retryable: false }),
        createMetadata(1, 50)
      )
    );

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
    }, createMetadata);

    expect(result.success).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1); // Should not retry
  });

  it('exhausts retries and returns error', async () => {
    const fn = vi.fn().mockResolvedValue(
      createErrorResponse(
        createAIError('RATE_LIMIT', 'Rate limit', { retryable: true }),
        createMetadata(1, 50)
      )
    );

    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelay: 10,
      maxDelay: 100,
    }, createMetadata);

    expect(result.success).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(
        createErrorResponse(
          createAIError('RATE_LIMIT', 'Rate limit', { retryable: true }),
          createMetadata(1, 50)
        )
      )
      .mockResolvedValueOnce(
        createSuccessResponse({}, createMetadata(2, 200))
      );

    await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
      onRetry,
    }, createMetadata);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ code: 'RATE_LIMIT' }),
      expect.any(Number)
    );
  });
});

describe('mapError', () => {
  it('maps rate limit errors', () => {
    const mappings: ErrorMapping[] = [
      { pattern: /rate.?limit/i, code: 'RATE_LIMIT', retryable: true },
    ];

    const error = new Error('Rate limit exceeded');
    const result = mapError(error, mappings);

    expect(result.code).toBe('RATE_LIMIT');
    expect(result.retryable).toBe(true);
  });

  it('maps timeout errors', () => {
    const mappings: ErrorMapping[] = [
      { pattern: /timeout/i, code: 'TIMEOUT', retryable: true },
    ];

    const error = new Error('Request timeout');
    const result = mapError(error, mappings);

    expect(result.code).toBe('TIMEOUT');
    expect(result.retryable).toBe(true);
  });

  it('maps auth errors as non-retryable', () => {
    const mappings: ErrorMapping[] = [
      { pattern: /401/i, code: 'AUTH_ERROR', retryable: false },
    ];

    const error = new Error('401 Unauthorized');
    const result = mapError(error, mappings);

    expect(result.code).toBe('AUTH_ERROR');
    expect(result.retryable).toBe(false);
  });

  it('uses default code for unmapped errors', () => {
    const mappings: ErrorMapping[] = [];
    const error = new Error('Unknown error');

    const result = mapError(error, mappings, 'UNKNOWN_ERROR');

    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('handles string errors', () => {
    const mappings: ErrorMapping[] = [
      { pattern: 'test', code: 'NETWORK_ERROR', retryable: true },
    ];

    const result = mapError('test error message', mappings);

    expect(result.code).toBe('NETWORK_ERROR');
  });
});

describe('Mock Providers - Error Handling', () => {
  it('MockOpenAIProvider handles rate limit retry', async () => {
    const provider = createRetryMock('openai', 2, { success: true }, 'rate_limit');

    const result1 = await provider.complete('test');
    expect(result1.success).toBe(false);
    expect(result1.error?.code).toBe('RATE_LIMIT');

    const result2 = await provider.complete('test');
    expect(result2.success).toBe(false);
    expect(result2.error?.code).toBe('RATE_LIMIT');

    const result3 = await provider.complete('test');
    expect(result3.success).toBe(true);
  });

  it('MockProvider respects timeout delay', async () => {
    const start = Date.now();
    const provider = createDelayMock('openai', 100, { success: true });

    await provider.complete('test');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some margin
    expect(elapsed).toBeLessThan(200);
  });

  it('MockProvider tracks calls', async () => {
    const provider = createSuccessMock('openai', { test: 'data' });

    await provider.complete('prompt1');
    await provider.complete('prompt2');

    expect(provider.getCallCount()).toBe(2);
    expect(provider.getCalls()).toHaveLength(2);
    expect(provider.getLastCall()?.prompt).toBe('prompt2');
  });

  it('MockProvider can be reset', async () => {
    const provider = createSuccessMock('openai', { test: 'data' });

    await provider.complete('test');
    expect(provider.getCallCount()).toBe(1);

    provider.reset();
    expect(provider.getCallCount()).toBe(0);
    expect(provider.getCalls()).toHaveLength(0);
  });
});
