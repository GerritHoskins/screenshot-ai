/**
 * MCP (Model Context Protocol) JSON-RPC handler for ScreenshotAI.
 *
 * Transport-agnostic and Electron-free so it can be unit tested. The desktop
 * app supplies the capture/analysis dependencies; every capture still needs the
 * user's own region selection and approval (enforced by those dependencies).
 */

import { randomUUID } from 'crypto';
import type { AIResponse, ScreenshotAnalysis } from '../types/ai-response';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SERVER_INFO = { name: 'screenshot-ai', version: '0.1.0' } as const;

/** Captures handed to an agent can be analyzed later by id, for this long. */
export const CAPTURE_TTL_MS = 10 * 60 * 1000;
const MAX_REASON_LENGTH = 200;
const MAX_CLIENT_NAME_LENGTH = 64;
const CAPTURE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcId = string | number;

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Thrown by dependencies for expected, user-facing tool failures (busy, declined, ...). */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

export interface CaptureRequest {
  /** Sanitized reason supplied by the agent, shown to the user. */
  reason?: string;
  /** Sanitized client name from `initialize`, shown to the user. */
  clientName: string;
}

export interface McpDependencies {
  /**
   * Let the user select a region and approve sharing it.
   * Returns a PNG, or null when the user cancelled or declined.
   */
  captureRegion(request: CaptureRequest): Promise<Buffer | null>;
  /** Analyze with the user's configured provider and API key. */
  analyze(png: Buffer, signal: AbortSignal): Promise<AIResponse<ScreenshotAnalysis> | null>;
  now?: () => number;
}

export interface CallContext {
  signal?: AbortSignal;
}

interface StoredCapture {
  png: Buffer;
  createdAt: number;
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export const TOOL_DEFINITIONS = [
  {
    name: 'capture_region',
    title: 'Capture a screen region',
    description:
      'Ask the user to select a region of their screen and approve sharing it. Returns the PNG image and a capture_id ' +
      'that analyze_capture accepts. The user may cancel; nothing is captured without their selection.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          maxLength: MAX_REASON_LENGTH,
          description: 'Short explanation shown to the user, e.g. "See the error dialog you mentioned".',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'analyze_capture',
    title: 'Analyze a screen capture',
    description:
      "Analyze a capture with the user's configured AI provider (spends the user's API credits) and return " +
      'structured findings: answer, extracted text, code blocks and issues. Pass capture_id from capture_region, ' +
      'or omit it to ask the user for a new capture.',
    inputSchema: {
      type: 'object',
      properties: {
        capture_id: { type: 'string', description: 'Id returned by capture_region within the last 10 minutes.' },
        reason: { type: 'string', maxLength: MAX_REASON_LENGTH, description: 'Shown to the user when a new capture is needed.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
] as const;

/** Strip control characters and clamp length for text that is shown to the user. */
export function sanitizeDisplayText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidId(id: unknown): id is JsonRpcId {
  return (typeof id === 'string' && id.length <= 256) || (typeof id === 'number' && Number.isFinite(id));
}

function errorResponse(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolError(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export class McpProtocolHandler {
  private clientName = 'An MCP client';
  private readonly captures = new Map<string, StoredCapture>();
  private toolInFlight = false;
  private readonly now: () => number;

  constructor(private readonly deps: McpDependencies) {
    this.now = deps.now ?? Date.now;
  }

  /** Handle one parsed JSON-RPC message. Returns null for notifications. */
  async handleMessage(message: unknown, context: CallContext = {}): Promise<JsonRpcResponse | null> {
    if (!isPlainObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      const id = isPlainObject(message) && isValidId(message.id) ? message.id : null;
      return errorResponse(id, JSONRPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC request');
    }

    const isNotification = !('id' in message);
    if (!isNotification && !isValidId(message.id)) {
      return errorResponse(null, JSONRPC_ERRORS.INVALID_REQUEST, 'Invalid request id');
    }
    if (isNotification) return null; // notifications/initialized, cancelled, etc. need no reply

    const id = message.id as JsonRpcId;
    const params = message.params === undefined ? {} : message.params;
    if (!isPlainObject(params)) {
      return errorResponse(id, JSONRPC_ERRORS.INVALID_PARAMS, 'params must be an object');
    }

    switch (message.method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: this.initialize(params) };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } };
      case 'tools/call':
        return this.callTool(id, params, context);
      default:
        return errorResponse(id, JSONRPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  }

  private initialize(params: Record<string, unknown>) {
    const clientInfo = isPlainObject(params.clientInfo) ? params.clientInfo : {};
    this.clientName = sanitizeDisplayText(clientInfo.name, MAX_CLIENT_NAME_LENGTH) ?? 'An MCP client';
    const requested = params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === requested) ?? SUPPORTED_PROTOCOL_VERSIONS[0];
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        'Use capture_region when you need to see something on the user\'s screen. The user selects the region and ' +
        'approves it, so explain why in `reason`. Use analyze_capture for OCR, code extraction or error explanations.',
    };
  }

  private async callTool(id: JsonRpcId, params: Record<string, unknown>, context: CallContext): Promise<JsonRpcResponse> {
    const name = params.name;
    const args = params.arguments === undefined ? {} : params.arguments;
    if (typeof name !== 'string' || !TOOL_DEFINITIONS.some((t) => t.name === name)) {
      return errorResponse(id, JSONRPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
    }
    if (!isPlainObject(args)) {
      return errorResponse(id, JSONRPC_ERRORS.INVALID_PARAMS, 'arguments must be an object');
    }
    const allowed = name === 'capture_region' ? ['reason'] : ['reason', 'capture_id'];
    const unknownKey = Object.keys(args).find((key) => !allowed.includes(key));
    if (unknownKey) {
      return errorResponse(id, JSONRPC_ERRORS.INVALID_PARAMS, `Unknown argument: ${unknownKey}`);
    }
    if (args.reason !== undefined && typeof args.reason !== 'string') {
      return errorResponse(id, JSONRPC_ERRORS.INVALID_PARAMS, 'reason must be a string');
    }
    if (args.capture_id !== undefined && (typeof args.capture_id !== 'string' || !CAPTURE_ID_PATTERN.test(args.capture_id))) {
      return errorResponse(id, JSONRPC_ERRORS.INVALID_PARAMS, 'capture_id must be an id returned by capture_region');
    }

    if (this.toolInFlight) {
      return { jsonrpc: '2.0', id, result: toolError('ScreenshotAI is already handling another agent request. Try again shortly.') };
    }
    this.toolInFlight = true;
    try {
      const reason = sanitizeDisplayText(args.reason, MAX_REASON_LENGTH);
      const result = name === 'capture_region'
        ? await this.captureRegion(reason)
        : await this.analyzeCapture(args.capture_id as string | undefined, reason, context.signal);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (error instanceof McpToolError) {
        return { jsonrpc: '2.0', id, result: toolError(error.message) };
      }
      // Never echo internal error details (paths, stack traces) to the agent.
      return { jsonrpc: '2.0', id, result: toolError('ScreenshotAI could not complete the request.') };
    } finally {
      this.toolInFlight = false;
    }
  }

  private async captureRegion(reason: string | undefined): Promise<ToolResult> {
    const png = await this.deps.captureRegion({ reason, clientName: this.clientName });
    if (!png) return toolError('The user cancelled or declined the capture.');

    this.pruneCaptures();
    const captureId = randomUUID();
    this.captures.clear(); // keep only the latest capture in memory
    this.captures.set(captureId, { png, createdAt: this.now() });
    return {
      content: [
        { type: 'text', text: `Captured a screen region (capture_id: ${captureId}). Pass it to analyze_capture for structured analysis.` },
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      ],
      structuredContent: { capture_id: captureId, bytes: png.length },
    };
  }

  private async analyzeCapture(captureId: string | undefined, reason: string | undefined, signal?: AbortSignal): Promise<ToolResult> {
    let png: Buffer | null;
    if (captureId) {
      this.pruneCaptures();
      png = this.captures.get(captureId)?.png ?? null;
      if (!png) return toolError('That capture_id is unknown or expired. Call capture_region again.');
    } else {
      png = await this.deps.captureRegion({ reason, clientName: this.clientName });
      if (!png) return toolError('The user cancelled or declined the capture.');
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.deps.analyze(png, controller.signal);
      if (!response) return toolError('The analysis was cancelled.');
      if (!response.success || !response.data) {
        const message = sanitizeDisplayText(response.error?.message, 300) ?? 'Analysis failed.';
        return toolError(`Analysis failed (${response.error?.code ?? 'UNKNOWN_ERROR'}): ${message}`);
      }
      const meta = response.metadata;
      const structured = {
        analysis: response.data,
        provider: meta?.provider,
        model: meta?.model,
        latencyMs: meta?.latencyMs,
        tokens: meta ? { prompt: meta.promptTokens, completion: meta.completionTokens } : undefined,
      };
      return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private pruneCaptures(): void {
    const cutoff = this.now() - CAPTURE_TTL_MS;
    for (const [key, value] of this.captures) {
      if (value.createdAt < cutoff) this.captures.delete(key);
    }
  }
}
