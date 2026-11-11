/**
 * Loopback-only MCP "Streamable HTTP" transport (JSON responses, no SSE).
 *
 * Security boundary for agent access:
 * - binds to 127.0.0.1 only
 * - requires `Authorization: Bearer <token>` (constant-time comparison)
 * - rejects foreign Host/Origin headers (DNS rebinding and browser pages)
 * - caps request body size and accepts JSON only
 */

import { createHash, timingSafeEqual } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { JSONRPC_ERRORS, type CallContext, type JsonRpcResponse } from './protocol';

export const MCP_PATH = '/mcp';
export const MAX_BODY_BYTES = 64 * 1024;

export interface McpMessageHandler {
  handleMessage(message: unknown, context?: CallContext): Promise<JsonRpcResponse | null>;
}

export interface McpHttpServerOptions {
  /** 0 picks a free port. */
  port: number;
  token: string;
  handler: McpMessageHandler;
  onError?: (error: Error) => void;
}

export interface RunningMcpServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isAuthorized(header: string | undefined, token: string): boolean {
  if (!header || !token) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(token));
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Non-browser clients send no Origin; a browser page may only reach us from loopback. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function sendStatus(res: http.ServerResponse, status: number, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...extraHeaders });
  res.end();
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function startMcpHttpServer(options: McpHttpServerOptions): Promise<RunningMcpServer> {
  if (!options.token || options.token.length < 32) {
    return Promise.reject(new Error('MCP token must be at least 32 characters'));
  }

  let boundPort = options.port;

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host, boundPort) || !isAllowedOrigin(req.headers.origin)) {
        return sendStatus(res, 403);
      }
      const pathname = (req.url ?? '').split('?')[0];
      if (pathname !== MCP_PATH) return sendStatus(res, 404);
      if (!isAuthorized(req.headers.authorization, options.token)) {
        return sendStatus(res, 401, { 'WWW-Authenticate': 'Bearer' });
      }
      // No server-initiated SSE stream and no sessions: only POST is supported.
      if (req.method !== 'POST') return sendStatus(res, 405, { Allow: 'POST' });

      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.startsWith('application/json')) return sendStatus(res, 415);

      const body = await readBody(req);
      if (body === null) return sendStatus(res, 413);

      let message: unknown;
      try {
        message = JSON.parse(body);
      } catch {
        return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: JSONRPC_ERRORS.PARSE_ERROR, message: 'Parse error' } });
      }
      if (Array.isArray(message)) {
        return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: JSONRPC_ERRORS.INVALID_REQUEST, message: 'Batch requests are not supported' } });
      }

      // Abort long-running tool calls (capture, analysis) if the client goes away.
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });

      const response = await options.handler.handleMessage(message, { signal: controller.signal });
      if (res.destroyed) return;
      if (response === null) return sendStatus(res, 202);
      return sendJson(res, 200, response);
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) {
        sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: JSONRPC_ERRORS.INTERNAL_ERROR, message: 'Internal error' } });
      } else {
        res.end();
      }
    }
  });

  // A capture waits for the user's selection, so allow long-lived requests.
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 30 * 1000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject);
      if (options.onError) server.on('error', options.onError);
      boundPort = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${boundPort}${MCP_PATH}`,
        port: boundPort,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
