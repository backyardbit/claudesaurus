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

/** A session that can be opened again, from the directory Claudesaurus runs in. */
export type PastSession = { sessionId: string; title: string | null; updatedAt: string | null };

export type AccountInfo = { label: string; email: string | null };

/** What an agent supports beyond the ACP baseline, from its answer to `initialize`. */
export type AgentFeatures = {
  /** Past sessions can be listed and opened again: `/resume` and `--continue`. */
  resume: boolean;
  /** A message can be sent into a running turn (`_session/steering`); otherwise it is queued. */
  steer: boolean;
  /** The session takes Claudesaurus's note on what the page draws as a system prompt append. */
  systemPrompt: boolean;
  /** Prompts may carry `resource` blocks, which is how the note goes in otherwise. */
  embeddedContext: boolean;
};

/** The agent a session runs on: its ACP registry id and the name to show for it. */
export type AgentIdentity = { id: string; name: string };

/** An agent `/agent` can switch to, from the ACP registry. */
export type AgentChoice = AgentIdentity & { version: string; description: string | null };

/** A way to sign in to the agent, from its `authMethods`. */
export type AuthChoice = {
  id: string;
  name: string;
  description: string | null;
  /** `agent` signs in by itself, as in a browser; `terminal` runs the agent's login in a pane. */
  kind: "agent" | "terminal";
};

/** The sign-in the agent asks for before it opens a session. */
export type AuthRequest = {
  methods: AuthChoice[];
  /** What is happening, such as a sign-in waiting in the browser, or why one failed. */
  status: string | null;
  /** A login command to run in a terminal, shown where Claudesaurus cannot open a pane. */
  command: string | null;
};

export type SessionInfo = {
  sessionId: string;
  cwd: string;
  agent: AgentIdentity;
  agentVersion: string;
  features: AgentFeatures;
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
  | { type: "listSessions" }
  | { type: "resume"; sessionId: string }
  | { type: "listAgents" }
  /** Starts a new session on another agent, which becomes the default for the next launch. */
  | { type: "switchAgent"; agentId: string }
  | { type: "authenticate"; methodId: string }
  /** Tries to open the session again, after signing in outside the app. */
  | { type: "retryAuth" }
  | { type: "setDrawing"; drawing: Drawing }
  | { type: "setZen"; zen: boolean }
  | { type: "copy"; text: string }
  | { type: "openLink"; url: string }
  | { type: "quit" };

/** Messages the main process sends to the chat page. */
export type MainMessage =
  /** The agent is being installed or started; `detail` says how far along it is. */
  | { type: "connecting"; agent: AgentIdentity; detail: string | null }
  | { type: "auth"; auth: AuthRequest }
  /** The answer to `listAgents`. */
  | { type: "agents"; agents: AgentChoice[] }
  | { type: "session"; session: SessionInfo }
  | { type: "account"; account: AccountInfo }
  | { type: "historyLoaded" }
  /** Whether `/zen` is on, as saved. Sent first whenever the page loads. */
  | { type: "zen"; zen: boolean }
  /** The answer to `listSessions`, newest first. */
  | { type: "sessions"; sessions: PastSession[] }
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
