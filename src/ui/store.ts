import type {
  AvailableCommand,
  ContentBlock,
  PermissionOption,
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { useSyncExternalStore } from "react";
import type {
  AccountInfo,
  Bridge,
  Drawing,
  MainMessage,
  PastSession,
  PromptImage,
  SessionInfo,
} from "../shared/protocol";
import {
  ClaudeCodeMetaSchema,
  type ToolInput,
  ToolInputSchema,
  ToolOutputSchema,
  type ToolResponse,
} from "./meta";

export type ToolState = {
  toolCallId: string;
  title: string;
  toolName: string | null;
  kind: ToolKind;
  status: ToolCallStatus;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
  /** The input as Claude sent it, shown as JSON for tools the page knows nothing about. */
  rawInput: unknown;
  input: ToolInput;
  output: string | null;
  response: ToolResponse | null;
  startedAt: number;
  endedAt: number | null;
  /** False for a call replayed from a past session, whose real times are not known. */
  timed: boolean;
  children: Item[];
};

/** The time an update arrived, and whether that says anything about when its work happened. */
type Moment = { now: number; timed: boolean };

export type Item =
  | { kind: "user"; id: string; messageId: string | null; text: string; images: PromptImage[] }
  | { kind: "assistant"; id: string; messageId: string | null; text: string }
  | {
      kind: "thought";
      id: string;
      text: string;
      startedAt: number;
      endedAt: number | null;
      timed: boolean;
    }
  | { kind: "tool"; id: string; tool: ToolState }
  | { kind: "notice"; id: string; severity: string; title: string; description: string | null }
  | { kind: "error"; id: string; message: string };

export type PermissionRequest = {
  requestId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
};

export type Draft = { text: string; images: PromptImage[] };

export type Usage = { used: number; size: number };

export type State = {
  phase: "connecting" | "ready" | "failed";
  failure: string | null;
  session: SessionInfo | null;
  account: AccountInfo | null;
  configOptions: SessionConfigOption[];
  items: Item[];
  running: boolean;
  turnStartedAt: number | null;
  queue: Draft[];
  plan: PlanEntry[];
  permissions: PermissionRequest[];
  usage: Usage | null;
  commands: AvailableCommand[];
  /** Sessions `/resume` can open, or null while they are being listed. */
  pastSessions: PastSession[] | null;
  /** True while a past session's conversation is being replayed into the page. */
  replaying: boolean;
  /** `/zen`: the conversation shows only what was said, without tool calls and thoughts. */
  zen: boolean;
  toast: string | null;
};

export const initialState: State = {
  phase: "connecting",
  failure: null,
  session: null,
  account: null,
  configOptions: [],
  items: [],
  running: false,
  turnStartedAt: null,
  queue: [],
  plan: [],
  permissions: [],
  usage: null,
  commands: [],
  pastSessions: null,
  replaying: false,
  zen: false,
  toast: null,
};

let nextId = 0;
function localId(prefix: string) {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function blockText(block: ContentBlock) {
  if (block.type === "text") return block.text;
  if (block.type === "resource_link") return `[${block.title ?? block.name}](${block.uri})`;
  return "";
}

function closeThoughts(items: Item[], now: number) {
  const last = items.at(-1);
  if (last?.kind !== "thought" || last.endedAt !== null) return items;
  return [...items.slice(0, -1), { ...last, endedAt: now }];
}

/** Adds streamed text to the message it continues, or starts the next message. */
function appendText(
  items: Item[],
  kind: "assistant" | "thought",
  text: string,
  messageId: string | null,
  { now, timed }: Moment,
) {
  if (!text) return items;
  const last = items.at(-1);
  if (kind === "assistant" && last?.kind === "assistant" && last.messageId === messageId) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }];
  }
  if (kind === "thought" && last?.kind === "thought" && last.endedAt === null) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }];
  }
  const closed = closeThoughts(items, now);
  if (kind === "assistant") {
    return [...closed, { kind, id: localId("assistant"), messageId, text }];
  }
  return [...closed, { kind, id: localId("thought"), text, startedAt: now, endedAt: null, timed }];
}

/** Adds a replayed piece of a user message to the message it belongs to, or starts the next one. */
function appendUserChunk(
  items: Item[],
  block: ContentBlock,
  messageId: string | null,
  now: number,
) {
  const image = block.type === "image" ? { data: block.data, mimeType: block.mimeType } : null;
  const text = blockText(block);
  const last = items.at(-1);
  if (last?.kind === "user" && last.messageId === messageId && messageId !== null) {
    const images = image ? [...last.images, image] : last.images;
    return [...items.slice(0, -1), { ...last, text: last.text + text, images }];
  }
  if (!image && !text.trim()) return items;
  const user: Item = {
    kind: "user",
    id: localId("user"),
    messageId,
    text: text.trimStart(),
    images: image ? [image] : [],
  };
  return [...closeThoughts(items, now), user];
}

function isSettled(status: ToolCallStatus) {
  return status === "completed" || status === "failed";
}

function mergeTool(tool: ToolState, update: ToolCallUpdate, now: number): ToolState {
  const meta = ClaudeCodeMetaSchema.parse(update._meta);
  const status = update.status ?? tool.status;
  const rawInput = update.rawInput ?? tool.rawInput;
  return {
    ...tool,
    title: update.title ?? tool.title,
    toolName: meta.toolName ?? update.name ?? tool.toolName,
    kind: update.kind ?? tool.kind,
    status,
    content: update.content ?? tool.content,
    locations: update.locations ?? tool.locations,
    rawInput,
    input: ToolInputSchema.parse(rawInput),
    output: update.rawOutput == null ? tool.output : ToolOutputSchema.parse(update.rawOutput),
    response: meta.toolResponse ?? tool.response,
    endedAt: tool.endedAt ?? (isSettled(status) ? now : null),
  };
}

function newTool(update: ToolCallUpdate, { now, timed }: Moment): ToolState {
  const blank: ToolState = {
    toolCallId: update.toolCallId,
    title: "",
    toolName: null,
    kind: "other",
    status: "pending",
    content: [],
    locations: [],
    rawInput: undefined,
    input: {},
    output: null,
    response: null,
    startedAt: now,
    endedAt: null,
    timed,
    children: [],
  };
  return mergeTool(blank, update, now);
}

/** Replaces the tool with the given id, wherever it is nested. Returns the same array if absent. */
function mapTool(
  items: Item[],
  toolCallId: string,
  change: (tool: ToolState) => ToolState,
): Item[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.kind !== "tool") return item;
    if (item.tool.toolCallId === toolCallId) {
      changed = true;
      return { ...item, tool: change(item.tool) };
    }
    const children = mapTool(item.tool.children, toolCallId, change);
    if (children === item.tool.children) return item;
    changed = true;
    return { ...item, tool: { ...item.tool, children } };
  });
  return changed ? next : items;
}

function applyToList(items: Item[], update: SessionUpdate, moment: Moment): Item[] {
  const { now } = moment;
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      return appendUserChunk(items, update.content, update.messageId ?? null, now);
    case "agent_message_chunk":
      return appendText(
        items,
        "assistant",
        blockText(update.content),
        update.messageId ?? null,
        moment,
      );
    case "agent_thought_chunk":
      return appendText(items, "thought", blockText(update.content), null, moment);
    case "tool_call":
    case "tool_call_update": {
      const merged = mapTool(items, update.toolCallId, (tool) => mergeTool(tool, update, now));
      if (merged !== items) return merged;
      const tool = newTool(update, moment);
      return [...closeThoughts(items, now), { kind: "tool", id: tool.toolCallId, tool }];
    }
    case "notice":
      return [
        ...closeThoughts(items, now),
        {
          kind: "notice",
          id: localId("notice"),
          severity: update.severity,
          title: update.title,
          description: update.description ?? null,
        },
      ];
    default:
      return items;
  }
}

function applyItems(items: Item[], update: SessionUpdate, moment: Moment): Item[] {
  const parent = ClaudeCodeMetaSchema.parse(update._meta).parentToolUseId;
  if (parent) {
    const nested = mapTool(items, parent, (tool) => ({
      ...tool,
      children: applyToList(tool.children, update, moment),
    }));
    if (nested !== items) return nested;
  }
  return applyToList(items, update, moment);
}

function settleTools(items: Item[], now: number): Item[] {
  return items.map((item) => {
    if (item.kind !== "tool") return item;
    const { tool } = item;
    const children = settleTools(tool.children, now);
    if (isSettled(tool.status)) return { ...item, tool: { ...tool, children } };
    return { ...item, tool: { ...tool, children, status: "failed", endedAt: now } };
  });
}

function applyUpdate(state: State, update: SessionUpdate, now: number): State {
  switch (update.sessionUpdate) {
    case "plan":
      return { ...state, plan: update.entries };
    case "plan_update":
      return update.plan.type === "items" ? { ...state, plan: update.plan.entries } : state;
    case "plan_removed":
      return { ...state, plan: [] };
    case "available_commands_update":
      return { ...state, commands: update.availableCommands };
    case "config_option_update":
      return { ...state, configOptions: update.configOptions };
    case "current_mode_update":
      return {
        ...state,
        configOptions: state.configOptions.map((option) =>
          option.category === "mode" && option.type === "select"
            ? { ...option, currentValue: update.currentModeId }
            : option,
        ),
      };
    case "usage_update":
      return {
        ...state,
        usage: { used: update.used, size: update.size },
      };
    default: {
      const items = applyItems(state.items, update, { now, timed: !state.replaying });
      return items === state.items ? state : { ...state, items };
    }
  }
}

export function reduce(state: State, message: MainMessage, now: number): State {
  switch (message.type) {
    case "connecting":
      return { ...state, phase: "connecting" };
    case "session":
      return {
        ...initialState,
        phase: "ready",
        account: state.account,
        session: message.session,
        configOptions: message.session.configOptions,
        commands: state.commands,
        zen: state.zen,
        replaying: message.session.loadingHistory,
      };
    case "historyLoaded":
      return { ...state, replaying: false };
    case "zen":
      return { ...state, zen: message.zen };
    case "sessions":
      return { ...state, pastSessions: message.sessions };
    case "account":
      return { ...state, account: message.account };
    case "configOptions":
      return { ...state, configOptions: message.configOptions };
    case "userMessage":
      return {
        ...state,
        running: true,
        // A message sent into a running turn continues it, so the turn keeps its start.
        turnStartedAt: state.running ? state.turnStartedAt : now,
        items: [
          ...closeThoughts(state.items, now),
          {
            kind: "user",
            id: localId("user"),
            messageId: null,
            text: message.text,
            images: message.images,
          },
        ],
      };
    case "update":
      return applyUpdate(state, message.update, now);
    case "permissionRequest":
      return {
        ...state,
        permissions: [
          ...state.permissions,
          { requestId: message.requestId, toolCall: message.toolCall, options: message.options },
        ],
      };
    case "permissionClosed": {
      const closed = state.permissions.find((request) => request.requestId === message.requestId);
      if (!closed) return state;
      return {
        ...state,
        permissions: state.permissions.filter((request) => request !== closed),
        // The wait for an answer is not part of how long the tool ran.
        items: mapTool(state.items, closed.toolCall.toolCallId, (tool) =>
          tool.endedAt === null ? { ...tool, startedAt: now } : tool,
        ),
      };
    }
    case "turnEnded":
      return {
        ...state,
        running: false,
        turnStartedAt: null,
        items: settleTools(closeThoughts(state.items, now), now),
      };
    case "error":
      if (message.fatal)
        return { ...state, phase: "failed", failure: message.message, running: false };
      return {
        ...state,
        items: [...state.items, { kind: "error", id: localId("error"), message: message.message }],
      };
  }
}

/**
 * How often the page redraws while messages arrive. Every redraw is drawn again in the terminal,
 * so streamed text is shown in steps of this length instead of token by token.
 */
const NOTIFY_INTERVAL_MS = 80;

export function createStore(bridge: Bridge) {
  let state = initialState;
  let notifyTimer: number | null = null;
  let toastTimer: number | null = null;
  const listeners = new Set<() => void>();

  function notify() {
    notifyTimer = null;
    for (const listener of listeners) listener();
  }

  function set(next: State) {
    if (next === state) return;
    state = next;
    if (notifyTimer === null) notifyTimer = window.setTimeout(notify, NOTIFY_INTERVAL_MS);
  }

  function sendDraft(draft: Draft) {
    bridge.send({ type: "prompt", text: draft.text, images: draft.images });
  }

  bridge.subscribe((message) => {
    set(reduce(state, message, Date.now()));
    if (message.type !== "turnEnded") return;
    const [next, ...rest] = state.queue;
    if (!next) return;
    set({ ...state, queue: rest });
    sendDraft(next);
  });
  bridge.send({ type: "ready" });

  function showToast(toast: string) {
    set({ ...state, toast });
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ ...state, toast: null }), 1800);
  }

  /** Sends a message into the running turn, so Claude reads it before it carries on. */
  function sendNow(draft: Draft) {
    if (state.running) bridge.send({ type: "steer", text: draft.text, images: draft.images });
    else sendDraft(draft);
  }

  const actions = {
    /** Sends a message, or queues it while Claude works unless `now` sends it into the turn. */
    send(draft: Draft, { now = false } = {}) {
      if (state.phase !== "ready") return;
      if (state.running && !now) set({ ...state, queue: [...state.queue, draft] });
      else sendNow(draft);
    },
    unqueue(index: number) {
      set({ ...state, queue: state.queue.filter((_, position) => position !== index) });
    },
    sendQueuedNow(index: number) {
      const draft = state.queue[index];
      if (!draft) return;
      set({ ...state, queue: state.queue.filter((_, position) => position !== index) });
      sendNow(draft);
    },
    cancel() {
      if (state.running) bridge.send({ type: "cancel" });
    },
    answerPermission(requestId: string, optionId: string | null) {
      bridge.send({ type: "permission", requestId, optionId });
    },
    setConfig(configId: string, value: string | boolean) {
      bridge.send({ type: "setConfig", configId, value });
    },
    setDrawing(drawing: Drawing) {
      bridge.send({ type: "setDrawing", drawing });
      showToast(drawing === "patches" ? "Drawing changed areas only" : "Drawing in tiles");
    },
    toggleZen() {
      const zen = !state.zen;
      set({ ...state, zen });
      bridge.send({ type: "setZen", zen });
      showToast(zen ? "Zen: tool calls hidden" : "Showing tool calls");
    },
    newSession() {
      if (state.running) bridge.send({ type: "cancel" });
      bridge.send({ type: "newSession" });
    },
    /** Lists the sessions `/resume` can open, afresh each time it is typed. */
    listSessions() {
      set({ ...state, pastSessions: null });
      bridge.send({ type: "listSessions" });
    },
    resume(sessionId: string) {
      if (state.running) bridge.send({ type: "cancel" });
      bridge.send({ type: "resume", sessionId });
    },
    copy(text: string, label = "Copied") {
      bridge.send({ type: "copy", text });
      showToast(label);
    },
    openLink(url: string) {
      bridge.send({ type: "openLink", url });
      showToast("Link copied");
    },
    quit() {
      bridge.send({ type: "quit" });
    },
  };

  return {
    actions,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Store = ReturnType<typeof createStore>;

let store: Store | null = null;

export function installStore(created: Store) {
  store = created;
}

function currentStore() {
  if (!store) throw new Error("The store is used before it is installed.");
  return store;
}

export function useAppState<Selected>(select: (state: State) => Selected) {
  const active = currentStore();
  return useSyncExternalStore(active.subscribe, () => select(active.getState()));
}

export function useActions() {
  return currentStore().actions;
}
