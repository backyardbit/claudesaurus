import type {} from "@zenbu-labs/pixel/preload";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { PR_CHANNEL, type PrBridge } from "../shared/pr";
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

const prBridge: PrBridge = {
  target: () => ipcRenderer.invoke(PR_CHANNEL, "target"),
  call: (method, input) => ipcRenderer.invoke(PR_CHANNEL, "call", method, input),
  handoff: (input) => ipcRenderer.invoke(PR_CHANNEL, "handoff", input),
  copy: (text) => ipcRenderer.send(PR_CHANNEL, "copy", text),
  quit: () => ipcRenderer.send(PR_CHANNEL, "quit"),
};

if (window === window.top) {
  contextBridge.exposeInMainWorld("claudesaurus", bridge);
  contextBridge.exposeInMainWorld("claudesaurusPr", prBridge);
  contextBridge.exposeInMainWorld("pixel", {
    theme: () => pixel.theme(),
    onTheme: (subscriber: Parameters<typeof pixel.onTheme>[0]) => pixel.onTheme(subscriber),
    quit: () => pixel.quit(),
  });
}
