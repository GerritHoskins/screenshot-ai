import type { AIResponse, AIError, AIErrorCode, ResponseMetadata } from '../types/ai-response.js';
import { createAIError, createErrorResponse } from '../types/ai-response.js';

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export interface ImageInput { base64: string; mimeType: ImageMimeType }
export interface CompletionOptions { signal?: AbortSignal }
export interface FetchRequest {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}
/** Deliberately small structural contract compatible with web and native fetch. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  body?: { cancel(): Promise<unknown> } | null;
}
export type FetchLike = (url: string, init: FetchRequest) => Promise<FetchResponse>;

export interface ProviderConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
  maxRetries: number;
  retryBaseDelay: number;
  retryMaxDelay: number;
  fetch?: FetchLike;
}
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  model: '', maxTokens: 4096, temperature: 0.1, timeout: 30000,
  maxRetries: 3, retryBaseDelay: 1000, retryMaxDelay: 10000,
};
export interface AIProvider {
  readonly name: 'openai' | 'anthropic';
  readonly config: ProviderConfig;
  complete<T>(prompt: string, image?: ImageInput, options?: CompletionOptions): Promise<AIResponse<T>>;
  validateConfig(): Promise<boolean>;
}
export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  onRetry?: (attempt: number, error: AIError, delay: number) => void;
  retryAfterSeconds?: number;
  signal?: AbortSignal;
}
const safeRequestErrors = new WeakSet<object>();
function requestError(error: AIError): AIError {
  safeRequestErrors.add(error);
  return error;
}
/** Only errors created by the request lifecycle may retain their messages. */
export function isTrustedRequestError(error: unknown): error is AIError {
  return typeof error === 'object' && error !== null && safeRequestErrors.has(error);
}
export function invalidProviderResponseError(): AIError {
  return requestError(createAIError('INVALID_RESPONSE', 'The provider returned an invalid response.'));
}
export function isValidAbortSignal(signal: unknown): signal is AbortSignal {
  try {
    return typeof signal === 'object' && signal !== null &&
      typeof (signal as AbortSignal).aborted === 'boolean' &&
      typeof (signal as AbortSignal).addEventListener === 'function' &&
      typeof (signal as AbortSignal).removeEventListener === 'function';
  } catch {
    return false;
  }
}
export function safeModelMetadata(model: unknown, fallback: string): string {
  return typeof model === 'string' && model.trim().length > 0 ? model.trim() : fallback;
}
export function cancelledError(): AIError {
  return requestError(createAIError('CANCELLED', 'The analysis request was cancelled.', { retryable: false }));
}
export function validateImageInput(image: unknown): image is ImageInput {
  if (!image || typeof image !== 'object') return false;
  const value = image as Partial<ImageInput>;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(value.mimeType ?? '') ||
      typeof value.base64 !== 'string' || value.base64.length === 0 || value.base64.length % 4 !== 0) return false;
  const unpadded = value.base64.endsWith('==') ? value.base64.slice(0, -2)
    : value.base64.endsWith('=') ? value.base64.slice(0, -1) : value.base64;
  // No repeated capture groups: real screenshots can contain millions of bytes.
  return /^[A-Za-z0-9+/]+$/.test(unpadded);
}
export function validProviderConfig(config: ProviderConfig): boolean {
  return typeof config.model === 'string' && config.model.trim().length > 0 && config.model === config.model.trim() &&
    Number.isSafeInteger(config.maxTokens) && config.maxTokens > 0 &&
    Number.isFinite(config.temperature) && config.temperature >= 0 && config.temperature <= 2 &&
    Number.isFinite(config.timeout) && config.timeout >= 0 &&
    Number.isSafeInteger(config.maxRetries) && config.maxRetries >= 0 && config.maxRetries <= 10 &&
    Number.isFinite(config.retryBaseDelay) && config.retryBaseDelay >= 0 &&
    Number.isFinite(config.retryMaxDelay) && config.retryMaxDelay >= 0 &&
    (config.fetch === undefined || typeof config.fetch === 'function');
}
export function mergeDefined<T extends object>(defaults: T, overrides: Partial<T>): T {
  return { ...defaults, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) };
}
export function calculateBackoffDelay(attempt: number, baseDelay: number, maxDelay: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) {
    const milliseconds = retryAfterSeconds * 1000;
    return Math.min(milliseconds + milliseconds * 0.1 * (Math.random() * 2 - 1), maxDelay);
  }
  const exponential = baseDelay * Math.pow(2, attempt);
  return Math.min(exponential + exponential * 0.25 * (Math.random() * 2 - 1), maxDelay);
}
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal !== undefined && !isValidAbortSignal(signal)) { reject(createAIError('INVALID_REQUEST', 'Invalid cancellation signal.')); return; }
    if (signal?.aborted) { reject(cancelledError()); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(cancelledError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export async function withRetry<T>(fn: () => Promise<AIResponse<T>>, options: RetryOptions, createMetadata: (attempt: number, latencyMs: number) => ResponseMetadata): Promise<AIResponse<T>> {
  const started = Date.now();
  if (options.signal !== undefined && !isValidAbortSignal(options.signal)) {
    return createErrorResponse(createAIError('INVALID_REQUEST', 'Invalid cancellation signal.'), createMetadata(1, 0));
  }
  const retries = Number.isSafeInteger(options.maxRetries) && options.maxRetries >= 0 ? options.maxRetries : 0;
  let lastError: AIError | undefined;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (options.signal?.aborted) return createErrorResponse(cancelledError(), createMetadata(attempt, Date.now() - started));
    try {
      const result = await fn();
      const metadata = { ...result.metadata, attemptNumber: attempt, latencyMs: Date.now() - started };
      if (result.success || (result.error && !result.error.retryable)) return { ...result, metadata };
      lastError = result.error;
    } catch (error) {
      lastError = isAIError(error) ? error : createAIError('UNKNOWN_ERROR', 'The operation failed.');
      if (!lastError.retryable) return createErrorResponse(lastError, createMetadata(attempt, Date.now() - started));
    }
    if (attempt > retries) break;
    const delay = calculateBackoffDelay(attempt, options.baseDelay, options.maxDelay, lastError?.retryAfterSeconds ?? options.retryAfterSeconds);
    options.onRetry?.(attempt, lastError ?? createAIError('UNKNOWN_ERROR', 'The operation failed.'), delay);
    try { await sleep(delay, options.signal); }
    catch { return createErrorResponse(cancelledError(), createMetadata(attempt, Date.now() - started)); }
  }
  return createErrorResponse(lastError ?? createAIError('UNKNOWN_ERROR', 'All retry attempts failed'), createMetadata(retries + 1, Date.now() - started));
}
/** The same signal cancels the HTTP request and its response-body read. */
export async function withAbortTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal !== undefined && !isValidAbortSignal(signal)) throw createAIError('INVALID_REQUEST', 'Invalid cancellation signal.');
  if (signal?.aborted) throw cancelledError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => { controller.abort(); reject(cancelledError()); };
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(requestError(createAIError('TIMEOUT', 'The provider request timed out.'))); }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } catch (error) {
    if (signal?.aborted) throw cancelledError();
    if (controller.signal.aborted) throw requestError(createAIError('TIMEOUT', 'The provider request timed out.'));
    throw error;
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener('abort', cancel);
  }
}
export function isAIError(error: unknown): error is AIError {
  return typeof error === 'object' && error !== null && 'code' in error &&
    'message' in error && typeof error.message === 'string' &&
    'retryable' in error && typeof error.retryable === 'boolean';
}
export function providerHttpError(provider: string, status: number, retryAfter: string | null): AIError {
  if (!Number.isInteger(status) || status < 100 || status > 599) return invalidProviderResponseError();
  const code: AIErrorCode = status === 401 || status === 403 ? 'AUTH_ERROR'
    : status === 429 || status === 529 ? 'RATE_LIMIT'
    : status === 408 || status === 504 ? 'TIMEOUT'
    : status >= 500 ? 'MODEL_ERROR' : 'INVALID_REQUEST';
  const error = requestError(createAIError(code, provider + ' request failed (HTTP ' + status + ').', { retryable: status === 408 || status === 429 || status >= 500 }));
  const seconds = typeof retryAfter === 'string' ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) error.retryAfterSeconds = seconds;
  return error;
}
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutError: AIError): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeoutError), timeoutMs); });
  try { return await Promise.race([promise, deadline]); }
  finally { clearTimeout(timer); }
}
export interface ErrorMapping { pattern: RegExp | string; code: AIErrorCode; retryable: boolean }
/** Generic classification helper. Provider clients use safe HTTP errors instead. */
export function mapError(error: unknown, mappings: ErrorMapping[], defaultCode: AIErrorCode = 'UNKNOWN_ERROR'): AIError {
  const message = error instanceof Error ? error.message : String(error);
  let retryAfterSeconds: number | undefined;
  if (error instanceof Error && 'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number') retryAfterSeconds = error.retryAfterSeconds;
  for (const mapping of mappings) {
    if (mapping.pattern instanceof RegExp) mapping.pattern.lastIndex = 0;
    const matches = typeof mapping.pattern === 'string' ? message.includes(mapping.pattern) : mapping.pattern.test(message);
    if (matches) {
      const result = createAIError(mapping.code, message, { cause: error instanceof Error ? error : undefined, retryable: mapping.retryable });
      if (retryAfterSeconds !== undefined && mapping.retryable) result.retryAfterSeconds = retryAfterSeconds;
      return result;
    }
  }
  return createAIError(defaultCode, message, { cause: error instanceof Error ? error : undefined });
}
export function extractJsonFromResponse(text: string): string {
  let cleaned = text.trim();
  const codeBlock = cleaned.match(/^\x60\x60\x60(?:json|JSON)?\s*\n?([\s\S]*?)\n?\x60\x60\x60$/);
  if (codeBlock) cleaned = codeBlock[1].trim();
  if (cleaned.startsWith(String.fromCharCode(96, 96, 96))) cleaned = cleaned.replace(/^\x60\x60\x60(?:json|JSON)?\s*\n?/, '').replace(/\n?\x60\x60\x60$/, '').trim();
  // A complete JSON value (including arrays of objects) needs no extraction.
  try { JSON.parse(cleaned); return cleaned; } catch { /* Try prose-wrapped JSON below. */ }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  return cleaned;
}
export function parseJsonResponse<T>(text: string): T { return JSON.parse(extractJsonFromResponse(text)) as T; }
