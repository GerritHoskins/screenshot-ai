/**
 * MCP server mode: JSON-RPC protocol handling and the loopback HTTP transport.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as http from 'http';
import {
  McpProtocolHandler,
  McpToolError,
  JSONRPC_ERRORS,
  CAPTURE_TTL_MS,
  sanitizeDisplayText,
  type McpDependencies,
} from '../../src/mcp/protocol';
import {
  startMcpHttpServer,
  isAuthorized,
  isAllowedOrigin,
  isAllowedHost,
  MAX_BODY_BYTES,
  type RunningMcpServer,
} from '../../src/mcp/http-server';
import { createSuccessResponse } from '../../src/types/ai-response';

const PNG = Buffer.from('fake-png-bytes');
const TOKEN = 'a'.repeat(43);

function metadata() {
  return { model: 'gpt-test', provider: 'openai' as const, promptTokens: 10, completionTokens: 5, latencyMs: 42, attemptNumber: 1 };
}

function makeDeps(overrides: Partial<McpDependencies> = {}): McpDependencies {
  return {
    captureRegion: vi.fn().mockResolvedValue(PNG),
    analyze: vi.fn().mockResolvedValue(createSuccessResponse({ answer: 'It is a TypeError', confidence: 0.9 } as never, metadata())),
    ...overrides,
  };
}

const call = (id: number, name: string, args?: Record<string, unknown>) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

describe('McpProtocolHandler', () => {
  it('negotiates the protocol version and records a sanitized client name', async () => {
    const deps = makeDeps();
    const handler = new McpProtocolHandler(deps);
    const init = await handler.handleMessage({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', clientInfo: { name: 'Claude\u0007 Code\u202e' }, capabilities: {} },
    });
    expect(init?.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} } });

    const unknownVersion = await handler.handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((unknownVersion?.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');

    await handler.handleMessage({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { clientInfo: { name: 'Claude\u0007 Code\u202e' } } });
    await handler.handleMessage(call(4, 'capture_region', { reason: 'See\nthe error' }));
    expect(deps.captureRegion).toHaveBeenCalledWith({ clientName: 'Claude Code', reason: 'See the error' });
  });

  it('returns null for notifications and lists both tools', async () => {
    const handler = new McpProtocolHandler(makeDeps());
    expect(await handler.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const list = await handler.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(['capture_region', 'analyze_capture']);
  });

  it('rejects malformed requests, unknown methods, tools and arguments', async () => {
    const handler = new McpProtocolHandler(makeDeps());
    expect((await handler.handleMessage('nope'))?.error?.code).toBe(JSONRPC_ERRORS.INVALID_REQUEST);
    expect((await handler.handleMessage({ jsonrpc: '2.0', id: {}, method: 'ping' }))?.error?.code).toBe(JSONRPC_ERRORS.INVALID_REQUEST);
    expect((await handler.handleMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }))?.error?.code).toBe(JSONRPC_ERRORS.METHOD_NOT_FOUND);
    expect((await handler.handleMessage(call(2, 'delete_files')))?.error?.code).toBe(JSONRPC_ERRORS.INVALID_PARAMS);
    expect((await handler.handleMessage(call(3, 'capture_region', { display: 'all' })))?.error?.code).toBe(JSONRPC_ERRORS.INVALID_PARAMS);
    expect((await handler.handleMessage(call(4, 'capture_region', { reason: 5 })))?.error?.code).toBe(JSONRPC_ERRORS.INVALID_PARAMS);
    expect((await handler.handleMessage(call(5, 'analyze_capture', { capture_id: '../../etc' })))?.error?.code).toBe(JSONRPC_ERRORS.INVALID_PARAMS);
  });

  it('capture_region returns the image and a capture id', async () => {
    const handler = new McpProtocolHandler(makeDeps());
    const res = await handler.handleMessage(call(1, 'capture_region'));
    const result = res?.result as { content: Array<{ type: string; data?: string }>; structuredContent: { capture_id: string } };
    expect(result.content.find((c) => c.type === 'image')?.data).toBe(PNG.toString('base64'));
    expect(result.structuredContent.capture_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports a declined capture as a tool error', async () => {
    const handler = new McpProtocolHandler(makeDeps({ captureRegion: vi.fn().mockResolvedValue(null) }));
    const res = await handler.handleMessage(call(1, 'capture_region'));
    expect(res?.result).toMatchObject({ isError: true });
  });

  it('analyzes a previous capture by id without asking for a new one', async () => {
    const deps = makeDeps();
    const handler = new McpProtocolHandler(deps);
    const captured = await handler.handleMessage(call(1, 'capture_region'));
    const captureId = (captured?.result as { structuredContent: { capture_id: string } }).structuredContent.capture_id;

    const analyzed = await handler.handleMessage(call(2, 'analyze_capture', { capture_id: captureId }));
    expect(deps.captureRegion).toHaveBeenCalledTimes(1);
    expect(deps.analyze).toHaveBeenCalledWith(PNG, expect.any(AbortSignal));
    expect(analyzed?.result).toMatchObject({
      structuredContent: { analysis: { answer: 'It is a TypeError' }, provider: 'openai', model: 'gpt-test', tokens: { prompt: 10, completion: 5 } },
    });
  });

  it('expires stored captures', async () => {
    let now = 1_000;
    const handler = new McpProtocolHandler(makeDeps({ now: () => now }));
    const captured = await handler.handleMessage(call(1, 'capture_region'));
    const captureId = (captured?.result as { structuredContent: { capture_id: string } }).structuredContent.capture_id;
    now += CAPTURE_TTL_MS + 1;
    const res = await handler.handleMessage(call(2, 'analyze_capture', { capture_id: captureId }));
    expect(res?.result).toMatchObject({ isError: true });
  });

  it('turns busy errors into tool errors and hides internal errors', async () => {
    const busy = new McpProtocolHandler(makeDeps({ captureRegion: vi.fn().mockRejectedValue(new McpToolError('busy now')) }));
    expect(JSON.stringify((await busy.handleMessage(call(1, 'capture_region')))?.result)).toContain('busy now');

    const broken = new McpProtocolHandler(makeDeps({ captureRegion: vi.fn().mockRejectedValue(new Error('C:\\secret\\path failed')) }));
    const text = JSON.stringify((await broken.handleMessage(call(1, 'capture_region')))?.result);
    expect(text).not.toContain('secret');
  });

  it('allows only one tool call at a time', async () => {
    let release!: (b: Buffer) => void;
    const handler = new McpProtocolHandler(makeDeps({ captureRegion: () => new Promise((r) => { release = r; }) }));
    const first = handler.handleMessage(call(1, 'capture_region'));
    const second = await handler.handleMessage(call(2, 'capture_region'));
    expect(second?.result).toMatchObject({ isError: true });
    release(PNG);
    expect((await first)?.result).not.toHaveProperty('isError');
  });

  it('forwards caller cancellation to the analysis', async () => {
    let seen: AbortSignal | undefined;
    const handler = new McpProtocolHandler(makeDeps({
      analyze: (_png, signal) => {
        seen = signal;
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null)));
      },
    }));
    const controller = new AbortController();
    const pending = handler.handleMessage(call(1, 'analyze_capture'), { signal: controller.signal });
    await vi.waitFor(() => expect(seen).toBeDefined());
    controller.abort();
    expect(seen?.aborted).toBe(true);
    expect((await pending)?.result).toMatchObject({ isError: true });
  });

  it('sanitizes display text', () => {
    expect(sanitizeDisplayText('  a\u0000b\u202ec  ', 50)).toBe('a b c');
    expect(sanitizeDisplayText('x'.repeat(10), 5)).toBe('xxxx…');
    expect(sanitizeDisplayText(42, 5)).toBeUndefined();
  });
});

describe('MCP HTTP transport helpers', () => {
  it('checks bearer tokens, hosts and origins', () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isAuthorized(undefined, TOKEN)).toBe(false);
    expect(isAuthorized(TOKEN, TOKEN)).toBe(false);
    expect(isAllowedHost('127.0.0.1:4000', 4000)).toBe(true);
    expect(isAllowedHost('evil.example:4000', 4000)).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
  });
});

describe('startMcpHttpServer', () => {
  let server: RunningMcpServer | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });

  function post(body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    const url = new URL(server!.url);
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: url.port, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  it('refuses short tokens', async () => {
    await expect(startMcpHttpServer({ port: 0, token: 'short', handler: new McpProtocolHandler(makeDeps()) })).rejects.toThrow();
  });

  it('serves JSON-RPC to authorized loopback clients only', async () => {
    server = await startMcpHttpServer({ port: 0, token: TOKEN, handler: new McpProtocolHandler(makeDeps()) });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const ok = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ jsonrpc: '2.0', id: 1, result: {} });

    expect((await post('{}', { Authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await post('{}', { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('{}', { Host: 'evil.example' })).status).toBe(403);
    expect((await post('{}', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post('x'.repeat(MAX_BODY_BYTES + 1))).status).toBe(413);
    expect(JSON.parse((await post('{bad json')).body).error.code).toBe(JSONRPC_ERRORS.PARSE_ERROR);
    expect((await post('[]')).status).toBe(400);
    expect((await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status).toBe(202);
  });
});
