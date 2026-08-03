import { contextBridge, ipcRenderer } from "electron";

type DisplayChoice = { id: string; name: string };

type DisplayPayload = {
  displays: DisplayChoice[];
  thumbnails: string[];
};

contextBridge.exposeInMainWorld("chooserApi", {
  onList: (cb: (payload: DisplayPayload) => void) => {
    ipcRenderer.on("display:list", (_event, payload) => cb(payload));
  },
  choose: (index: number) => {
    ipcRenderer.send("display:choose", index);
  },
  cancel: () => {
    ipcRenderer.send("display:cancel");
  }
});
