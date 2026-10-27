/**
 * Retry Logic Unit Tests - Workstream H.1
 * Tests for retry mechanisms and exponential backoff.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  calculateBackoffDelay,
  sleep,
  withRetry,
} from '../../src/providers/base';
import { createAIError, createSuccessResponse, createErrorResponse } from '../../src/types/ai-response';
import type { ResponseMetadata } from '../../src/types/ai-response';

// Disable fake timers for retry tests - they cause timeouts
// Real delays are fast enough for tests (10ms baseDelay)

// Remove fake timers - use real timers for retry tests

describe('calculateBackoffDelay', () => {
  it('increases delay exponentially', () => {
    const baseDelay = 1000;
    const delays = [1, 2, 3, 4].map(attempt =>
      calculateBackoffDelay(attempt, baseDelay, 10000)
    );

    // Each attempt should have longer delay
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('respects maximum delay', () => {
    const delay = calculateBackoffDelay(10, 1000, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it('includes jitter for randomization', () => {
    const delays = Array.from({ length: 20 }, () =>
      calculateBackoffDelay(2, 1000, 10000)
    );

    // Should have variation due to jitter (±25%)
    const minDelay = Math.min(...delays);
    const maxDelay = Math.max(...delays);
    expect(maxDelay - minDelay).toBeGreaterThan(0);
  });

  it('handles attempt 0', () => {
    const delay = calculateBackoffDelay(0, 1000, 10000);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(10000);
  });
});

describe('sleep', () => {
  it('waits for specified duration', async () => {
    const start = Date.now();
    await sleep(100);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(150);
  });

  it('handles zero delay', async () => {
    const start = Date.now();
    await sleep(0);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});

describe('withRetry', () => {
  const createMetadata = (attempt: number, latencyMs: number): ResponseMetadata => ({
    model: 'test-model',
    provider: 'openai',
    promptTokens: 100,
    completionTokens: 50,
    latencyMs,
    attemptNumber: attempt,
  });

  // Use real timers for retry tests (they need actual delays)

  it('succeeds immediately without retries', async () => {
    const fn = vi.fn().mockResolvedValue(
      createSuccessResponse({ test: 'data' }, createMetadata(1, 100))
    );

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
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
        createSuccessResponse({ test: 'data' }, createMetadata(2, 150))
      );

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
    }, createMetadata);

    expect(result.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.metadata.attemptNumber).toBe(2);
  });

  it('does not retry non-retryable errors', async () => {
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
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe('AUTH_ERROR');
  });

  it('exhausts retries and returns last error', async () => {
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
    expect(result.error?.code).toBe('RATE_LIMIT');
    expect(result.metadata.attemptNumber).toBe(3);
  });

  it('calls onRetry callback for each retry', async () => {
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
        createErrorResponse(
          createAIError('RATE_LIMIT', 'Rate limit', { retryable: true }),
          createMetadata(2, 100)
        )
      )
      .mockResolvedValueOnce(
        createSuccessResponse({ test: 'data' }, createMetadata(3, 200))
      );

    await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
      onRetry,
    }, createMetadata);

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({ code: 'RATE_LIMIT' }),
      expect.any(Number)
    );
  });

  it('updates metadata with attempt number', async () => {
    const error = createAIError('RATE_LIMIT', 'Rate limit', { retryable: true });
    const fn = vi
      .fn()
      .mockResolvedValueOnce(createErrorResponse(error, createMetadata(1, 50)))
      .mockResolvedValueOnce(createSuccessResponse({ test: 'data' }, createMetadata(2, 150)));

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
    }, createMetadata);

    expect(result.metadata.attemptNumber).toBe(2);
  }, 10000);

  it('handles mixed retryable and non-retryable errors', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(
        createErrorResponse(
          createAIError('RATE_LIMIT', 'Rate limit', { retryable: true }),
          createMetadata(1, 50)
        )
      )
      .mockResolvedValueOnce(
        createErrorResponse(
          createAIError('AUTH_ERROR', 'Invalid key', { retryable: false }),
          createMetadata(2, 100)
        )
      );

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelay: 10,
      maxDelay: 100,
    }, createMetadata);

    expect(result.success).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2); // Stops after non-retryable error
    expect(result.error?.code).toBe('AUTH_ERROR');
  });
});
