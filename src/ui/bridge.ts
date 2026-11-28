import type { Bridge } from "../shared/protocol";

declare global {
  interface Window {
    claudesaurus?: Bridge;
  }
}

export async function connectBridge() {
  if (window.claudesaurus) return window.claudesaurus;
  const { createMockBridge } = await import("./mock");
  return createMockBridge();
}
