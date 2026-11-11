import { contextBridge, ipcRenderer } from "electron";

export type ShieldPreviewBox = { x: number; y: number; w: number; h: number; source: 'detected' | 'manual'; rule?: string; label?: string };

export type ShieldPreviewPayload = {
  dataUrl: string;
  width: number;
  height: number;
  boxes: ShieldPreviewBox[];
  notice: 'none' | 'scan-failed' | 'scan-unavailable' | 'shield-off';
  agent?: { clientName: string; reason?: string };
};

contextBridge.exposeInMainWorld("shieldApi", {
  onPreview: (cb: (payload: ShieldPreviewPayload) => void) => {
    ipcRenderer.once("shield:preview", (_event, payload) => cb(payload));
    ipcRenderer.send("shield:ready");
  },
  submit: (boxes: ShieldPreviewBox[]) => {
    ipcRenderer.send("shield:submit", boxes);
  },
  cancel: () => {
    ipcRenderer.send("shield:cancel");
  },
});
