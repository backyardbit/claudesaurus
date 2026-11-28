import type {
  PermissionOption,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

export type Drawing = "tiles" | "patches";

export type PromptImage = { data: string; mimeType: string };

export type PastSession = { sessionId: string; title: string | null; updatedAt: string | null };

export type AccountInfo = { label: string; email: string | null };

export type AgentFeatures = {
  resume: boolean;
  steer: boolean;
  systemPrompt: boolean;
  embeddedContext: boolean;
};

export type AgentIdentity = { id: string; name: string };

export type AgentChoice = AgentIdentity & { version: string; description: string | null };

export type AuthChoice = {
  id: string;
  name: string;
  description: string | null;
  kind: "agent" | "terminal";
};

export type AuthRequest = {
  methods: AuthChoice[];
  status: string | null;
  command: string | null;
};

export type SessionInfo = {
  sessionId: string;
  cwd: string;
  agent: AgentIdentity;
  agentVersion: string;
  features: AgentFeatures;
  configOptions: SessionConfigOption[];
  loadingHistory: boolean;
};

export type UiMessage =
  | { type: "ready" }
  | { type: "prompt"; text: string; images: PromptImage[] }
  | { type: "steer"; text: string; images: PromptImage[] }
  | { type: "cancel" }
  | { type: "permission"; requestId: string; optionId: string | null }
  | { type: "setConfig"; configId: string; value: string | boolean }
  | { type: "newSession" }
  | { type: "listSessions" }
  | { type: "resume"; sessionId: string }
  | { type: "listAgents" }
  | { type: "switchAgent"; agentId: string }
  | { type: "authenticate"; methodId: string }
  | { type: "retryAuth" }
  | { type: "setDrawing"; drawing: Drawing }
  | { type: "setZen"; zen: boolean }
  | { type: "copy"; text: string }
  | { type: "openLink"; url: string }
  | { type: "restart" }
  | { type: "quit" };

export type MainMessage =
  | { type: "connecting"; agent: AgentIdentity; detail: string | null }
  | { type: "auth"; auth: AuthRequest }
  | { type: "agents"; agents: AgentChoice[] }
  | { type: "session"; session: SessionInfo }
  | { type: "account"; account: AccountInfo }
  | { type: "historyLoaded" }
  | { type: "zen"; zen: boolean }
  | { type: "updateReady"; version: string }
  | { type: "draft"; text: string }
  | { type: "toast"; text: string }
  | { type: "celebrate"; pr: number | null }
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
