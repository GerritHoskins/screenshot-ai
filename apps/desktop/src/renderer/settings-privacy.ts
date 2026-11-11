/**
 * Settings > Privacy: secret shield options and which detection engine runs.
 */

import type { ExposedAPI, ShieldStatus } from '../preload/index';

export interface PrivacyTabDeps {
  api: ExposedAPI;
  updateSaveStatus: (message: string) => void;
}

const ENGINES: Record<string, string> = {
  win32: 'Windows built-in text recognition, on this computer.',
  darwin: 'macOS Vision text recognition, on this computer.',
};

function engineText(status: ShieldStatus): string {
  if (!status.enabled) return 'Off. Captures are sent without a scan.';
  if (!status.ocrAvailable) {
    return status.alwaysPreview
      ? 'Automatic detection is not available on this system. The review opens for every capture so you can cover areas yourself.'
      : 'Automatic detection is not available on this system. Turn on "Review every capture" to cover areas yourself.';
  }
  return ENGINES[status.platform] ?? 'Text recognition on this computer.';
}

export function initPrivacyTab({ api, updateSaveStatus }: PrivacyTabDeps): void {
  const enabled = document.getElementById('shield-enabled') as HTMLInputElement;
  const alwaysPreview = document.getElementById('shield-always-preview') as HTMLInputElement;
  const engine = document.getElementById('shield-engine') as HTMLSpanElement;

  const render = (status: ShieldStatus) => {
    enabled.checked = status.enabled;
    alwaysPreview.checked = status.alwaysPreview;
    engine.textContent = engineText(status);
  };

  const save = async (options: { enabled?: boolean; alwaysPreview?: boolean }, message: string) => {
    try {
      render(await api.settings.setShieldOptions(options));
      updateSaveStatus(message);
    } catch {
      engine.textContent = 'Could not save this setting.';
    }
  };

  enabled.addEventListener('change', () => save({ enabled: enabled.checked }, enabled.checked ? 'Secret shield on' : 'Secret shield off'));
  alwaysPreview.addEventListener('change', () => save({ alwaysPreview: alwaysPreview.checked }, alwaysPreview.checked ? 'Review every capture' : 'Review only when something is found'));

  api.settings.getShieldStatus().then(render).catch(() => { engine.textContent = 'Status unavailable.'; });
}
