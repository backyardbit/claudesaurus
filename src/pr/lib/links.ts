import { toastManager } from "../components/ui/toast";
import { prBridge } from "./prApi";

/**
 * Following a link. The page draws into a terminal that may be on another computer, so it
 * cannot open a browser there; like the chat, it copies the address instead.
 */
export function openLink(url: string) {
  prBridge().copy(url);
  toastManager.add({ type: "success", title: "Link copied", description: url });
}

export function writeTextToClipboard(text: string) {
  prBridge().copy(text);
}
