import type { Bridge } from "../shared/protocol";

declare global {
  interface Window {
    claudesaurus?: Bridge;
  }
}

/** The connection to the main process, or a scripted stand-in when the page runs in a plain browser. */
export async function connectBridge() {
  if (window.claudesaurus) return window.claudesaurus;
  const { createMockBridge } = await import("./mock");
  return createMockBridge();
}
