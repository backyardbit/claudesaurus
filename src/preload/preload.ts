import type {} from "@zenbu-labs/pixel/preload";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { type Bridge, MAIN_CHANNEL, type MainMessage, UI_CHANNEL } from "../shared/protocol";

const bridge: Bridge = {
  send(message) {
    ipcRenderer.send(UI_CHANNEL, message);
  },
  subscribe(listener) {
    const handler = (_event: IpcRendererEvent, message: MainMessage) => listener(message);
    ipcRenderer.on(MAIN_CHANNEL, handler);
    return () => ipcRenderer.removeListener(MAIN_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("claudesaurus", bridge);
contextBridge.exposeInMainWorld("pixel", {
  theme: () => pixel.theme(),
  onTheme: (subscriber: Parameters<typeof pixel.onTheme>[0]) => pixel.onTheme(subscriber),
  quit: () => pixel.quit(),
});
