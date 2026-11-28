import { toastManager } from "../components/ui/toast";
import { prBridge } from "./prApi";

export function openLink(url: string) {
  prBridge().copy(url);
  toastManager.add({ type: "success", title: "Link copied", description: url });
}

export function writeTextToClipboard(text: string) {
  prBridge().copy(text);
}
