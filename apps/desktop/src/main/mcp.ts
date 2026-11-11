/**
 * Desktop glue for MCP server mode: settings, token file and the user's
 * approval of every capture an agent asks for.
 */

import { app, BrowserWindow, clipboard } from 'electron';
import { shieldCapture } from './shield';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '@logging';
import { McpProtocolHandler, McpToolError } from '@/mcp/protocol';
import { startMcpHttpServer, type RunningMcpServer } from '@/mcp/http-server';
import type { AIResponse, ScreenshotAnalysis } from '@shared-types/ai-response';

export const DEFAULT_MCP_PORT = 47615;
export const CONNECTION_FILE_NAME = 'mcp-connection.json';
export const AGENT_BUSY_MESSAGE = 'ScreenshotAI is busy with another capture or analysis. Try again shortly.';

const logger = getLogger();

export interface McpSettings {
  enabled: boolean;
  port: number;
}

export interface AgentBridge {
  getMainWindow(): BrowserWindow | null;
  /** Opens the region selector. Throws McpToolError when the app is busy. */
  captureForAgent(): Promise<Buffer | null>;
  /** Runs analysis through the normal UI flow. Null when cancelled. */
  analyzeForAgent(png: Buffer, signal: AbortSignal): Promise<AIResponse<ScreenshotAnalysis> | null>;
}

export function readMcpSettings(): McpSettings {
  let enabled = false;
  let port = DEFAULT_MCP_PORT;
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      enabled = raw?.mcp?.enabled === true;
      const configuredPort = raw?.mcp?.port;
      if (Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535) port = configuredPort;
    }
  } catch (error) {
    logger.warn('mcp', 'Failed to read MCP settings', error instanceof Error ? error : undefined);
  }
  if (process.env.SCREENSHOT_AI_MCP === '1') enabled = true;
  return { enabled, port };
}

/** Reuse the per-install token, or create one. The file is readable only by the current user. */
function loadOrCreateToken(filePath: string): string {
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof existing?.token === 'string' && /^[A-Za-z0-9_-]{43,}$/.test(existing.token)) return existing.token;
  } catch {
    // missing or unreadable: create a new token below
  }
  return randomBytes(32).toString('base64url');
}

function writeConnectionFile(filePath: string, url: string, token: string): void {
  const contents = {
    url,
    token,
    note: 'Local MCP endpoint for ScreenshotAI. Keep this token private; it lets local agents request screen captures.',
  };
  fs.writeFileSync(filePath, JSON.stringify(contents, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

async function startAgentServer(bridge: AgentBridge): Promise<RunningMcpServer | null> {
  const settings = readMcpSettings();
  if (!settings.enabled) {
    logger.info('mcp', 'MCP server mode disabled');
    return null;
  }

  const handler = new McpProtocolHandler({
    captureRegion: async (request) => {
      logger.info('mcp', 'Agent requested a capture', { client: request.clientName, hasReason: !!request.reason });
      const png = await bridge.captureForAgent();
      if (!png) return null;
      // The review window is the approval step: the shield covers secrets and the user sends or cancels.
      const reviewed = await shieldCapture(png, { parent: bridge.getMainWindow(), agent: { clientName: request.clientName, reason: request.reason } });
      logger.info('mcp', 'Agent capture decision', { approved: reviewed !== null });
      return reviewed;
    },
    analyze: (png, signal) => bridge.analyzeForAgent(png, signal),
  });

  const connectionPath = getConnectionPath();
  const token = loadOrCreateToken(connectionPath);
  try {
    const server = await startMcpHttpServer({
      port: settings.port,
      token,
      handler,
      onError: (error) => logger.error('mcp', 'MCP server error', error),
    });
    writeConnectionFile(connectionPath, server.url, token);
    // Never log the token itself.
    logger.info('mcp', 'MCP server listening', { url: server.url, connectionFile: connectionPath });
    return server;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    lastStartError = code === 'EADDRINUSE'
      ? `Port ${settings.port} is already in use. Change "mcp.port" in settings.json or close the other app.`
      : 'The agent server could not start. See the logs for details.';
    logger.error('mcp', 'Failed to start MCP server', error instanceof Error ? error : undefined, { port: settings.port, code });
    return null;
  }
}

// ============================================================================
// Lifecycle (driven by app start/quit and the Settings > Agents toggle)
// ============================================================================

export interface McpStatus {
  enabled: boolean;
  /** SCREENSHOT_AI_MCP=1 keeps the server on regardless of the toggle. */
  forcedByEnv: boolean;
  running: boolean;
  url: string | null;
  port: number;
  connectionFile: string;
  error: string | null;
}

let activeBridge: AgentBridge | null = null;
let activeServer: RunningMcpServer | null = null;
let lastStartError: string | null = null;
let lifecycle: Promise<unknown> = Promise.resolve();

function getConnectionPath(): string {
  return path.join(app.getPath('userData'), CONNECTION_FILE_NAME);
}

/** Run lifecycle changes one at a time so quick toggles cannot race. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = lifecycle.then(task, task);
  lifecycle = next.catch(() => undefined);
  return next;
}

export function getMcpStatus(): McpStatus {
  const settings = readMcpSettings();
  return {
    enabled: settings.enabled,
    forcedByEnv: process.env.SCREENSHOT_AI_MCP === '1',
    running: activeServer !== null,
    url: activeServer?.url ?? null,
    port: settings.port,
    connectionFile: getConnectionPath(),
    error: activeServer ? null : lastStartError,
  };
}

/** Start, stop or restart the server so it matches the saved settings. */
export function applyMcpSettings(): Promise<McpStatus> {
  return serialize(async () => {
    if (activeServer) {
      await activeServer.close();
      activeServer = null;
    }
    lastStartError = null;
    if (activeBridge) activeServer = await startAgentServer(activeBridge);
    return getMcpStatus();
  });
}

export function initAgentServer(bridge: AgentBridge): Promise<McpStatus> {
  activeBridge = bridge;
  return applyMcpSettings();
}

export function stopAgentServer(): Promise<void> {
  activeBridge = null;
  return serialize(async () => {
    await activeServer?.close();
    activeServer = null;
  });
}

/** Put the `claude mcp add` command on the clipboard so the token never passes through the renderer. */
export function copyMcpSetupCommand(): { success: boolean; error?: string } {
  if (!activeServer) return { success: false, error: 'Turn on agent access first.' };
  const token = loadOrCreateToken(getConnectionPath());
  clipboard.writeText(`claude mcp add --transport http screenshot-ai ${activeServer.url} --header "Authorization: Bearer ${token}"`);
  return { success: true };
}

/** Issue a new token; agents configured with the old one lose access. */
export async function resetMcpToken(): Promise<McpStatus> {
  await serialize(async () => {
    fs.rmSync(getConnectionPath(), { force: true });
  });
  logger.info('mcp', 'MCP token reset');
  return applyMcpSettings();
}

export { McpToolError };
