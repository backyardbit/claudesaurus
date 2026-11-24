import type {
  PermissionOption,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

/**
 * How frames reach the terminal. "tiles" resends a fixed square around every change, which is
 * what PixelGUI does in Rex. "patches" sends only the changed area, which is far less data.
 */
export type Drawing = "tiles" | "patches";

export type PromptImage = { data: string; mimeType: string };

export type AccountInfo = { label: string; email: string | null };

export type SessionInfo = {
  sessionId: string;
  cwd: string;
  agentName: string;
  agentVersion: string;
  configOptions: SessionConfigOption[];
  /** True for a past session whose conversation is about to be replayed as updates. */
  loadingHistory: boolean;
};

/** Messages the chat page sends to the main process. */
export type UiMessage =
  | { type: "ready" }
  | { type: "prompt"; text: string; images: PromptImage[] }
  /** A message for the turn that is running, which Claude reads before it carries on. */
  | { type: "steer"; text: string; images: PromptImage[] }
  | { type: "cancel" }
  | { type: "permission"; requestId: string; optionId: string | null }
  | { type: "setConfig"; configId: string; value: string | boolean }
  | { type: "newSession" }
  | { type: "setDrawing"; drawing: Drawing }
  | { type: "copy"; text: string }
  | { type: "openLink"; url: string }
  | { type: "quit" };

/** Messages the main process sends to the chat page. */
export type MainMessage =
  | { type: "connecting" }
  | { type: "session"; session: SessionInfo }
  | { type: "account"; account: AccountInfo }
  | { type: "historyLoaded" }
  | { type: "configOptions"; configOptions: SessionConfigOption[] }
  | { type: "userMessage"; text: string; images: PromptImage[] }
  | { type: "update"; update: SessionUpdate }
  | {
      type: "permissionRequest";
      requestId: string;
      toolCall: ToolCallUpdate;
      options: PermissionOption[];
    }
  | { type: "permissionClosed"; requestId: string }
  | { type: "turnEnded"; stopReason: StopReason | "error" }
  | { type: "error"; message: string; fatal: boolean };

export const UI_CHANNEL = "claudesaurus:ui";
export const MAIN_CHANNEL = "claudesaurus:main";

export type Bridge = {
  send(message: UiMessage): void;
  subscribe(listener: (message: MainMessage) => void): () => void;
};
