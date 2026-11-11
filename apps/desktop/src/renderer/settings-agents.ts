/**
 * Settings > Agents: turn the local MCP server on or off and connect agents.
 * The token never reaches this page; the main process copies the setup command.
 */

import type { ExposedAPI, McpStatus } from '../preload/index';

export interface AgentsTabDeps {
  api: ExposedAPI;
  showMessage: (element: HTMLDivElement, message: string, type: 'success' | 'error' | 'info') => void;
  updateSaveStatus: (message: string) => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing settings element #${id}`);
  return element as T;
}

export function initAgentsTab({ api, showMessage, updateSaveStatus }: AgentsTabDeps): void {
  const enabledInput = byId<HTMLInputElement>('mcp-enabled');
  const envHint = byId<HTMLSpanElement>('mcp-env-hint');
  const statusText = byId<HTMLSpanElement>('mcp-status');
  const urlText = byId<HTMLElement>('mcp-url');
  const copyButton = byId<HTMLButtonElement>('mcp-copy-command');
  const resetButton = byId<HTMLButtonElement>('mcp-reset-token');
  const message = byId<HTMLDivElement>('mcp-message');

  function render(status: McpStatus): void {
    enabledInput.checked = status.enabled;
    enabledInput.disabled = status.forcedByEnv;
    envHint.hidden = !status.forcedByEnv;
    copyButton.disabled = !status.running;
    urlText.textContent = status.url ?? 'Not running';

    if (status.running) {
      statusText.textContent = 'On: agents can request captures. You approve each one.';
    } else if (status.enabled && status.error) {
      statusText.textContent = `Could not start: ${status.error}`;
    } else if (status.enabled) {
      statusText.textContent = 'Starting...';
    } else {
      statusText.textContent = 'Off: agents cannot reach ScreenshotAI.';
    }
  }

  async function refresh(): Promise<void> {
    try {
      render(await api.settings.getMcpStatus());
    } catch {
      statusText.textContent = 'Status unavailable.';
    }
  }

  enabledInput.addEventListener('change', async () => {
    const enabled = enabledInput.checked;
    enabledInput.disabled = true;
    try {
      const status = await api.settings.setMcpEnabled(enabled);
      render(status);
      if (enabled && !status.running) {
        showMessage(message, status.error ?? 'Agent access is on but the server is not running.', 'error');
      } else {
        updateSaveStatus(enabled ? 'Agent access on' : 'Agent access off');
      }
    } catch {
      showMessage(message, 'Could not change agent access.', 'error');
      await refresh();
    }
  });

  copyButton.addEventListener('click', async () => {
    const result = await api.settings.copyMcpSetupCommand();
    if (result.success) {
      showMessage(message, 'Command copied. Paste it into a terminal to add ScreenshotAI to Claude Code.', 'success');
    } else {
      showMessage(message, result.error ?? 'Could not copy the command.', 'error');
    }
  });

  resetButton.addEventListener('click', async () => {
    if (!confirm('Reset the agent token? Agents set up with the current token will lose access until you add them again.')) return;
    try {
      render(await api.settings.resetMcpToken());
      showMessage(message, 'Token reset. Copy the command again to reconnect your agents.', 'success');
    } catch {
      showMessage(message, 'Could not reset the token.', 'error');
    }
  });

  void refresh();
}
