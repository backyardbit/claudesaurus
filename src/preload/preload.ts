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

/** The PR viewer's line to its main process: each call is one `invoke` on its own channel. */
const prBridge: PrBridge = {
  target: () => ipcRenderer.invoke(PR_CHANNEL, "target"),
  call: (method, input) => ipcRenderer.invoke(PR_CHANNEL, "call", method, input),
  handoff: (input) => ipcRenderer.invoke(PR_CHANNEL, "handoff", input),
  copy: (text) => ipcRenderer.send(PR_CHANNEL, "copy", text),
  quit: () => ipcRenderer.send(PR_CHANNEL, "quit"),
};

// PixelGUI runs this preload in every frame, including the sandboxed frames of html blocks, whose
// content comes from the model. Only the chat page itself gets the bridge.
if (window === window.top) {
  contextBridge.exposeInMainWorld("claudesaurus", bridge);
  contextBridge.exposeInMainWorld("claudesaurusPr", prBridge);
  contextBridge.exposeInMainWorld("pixel", {
    theme: () => pixel.theme(),
    onTheme: (subscriber: Parameters<typeof pixel.onTheme>[0]) => pixel.onTheme(subscriber),
    quit: () => pixel.quit(),
  });
}
