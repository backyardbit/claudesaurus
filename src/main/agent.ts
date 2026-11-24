import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
  type ClientConnection,
  type ContentBlock,
  client,
  methods,
  ndJsonStream,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SystemPrompt,
} from "@agentclientprotocol/sdk";
import type { MainMessage, PastSession, PromptImage } from "../shared/protocol";

export type AgentOptions = {
  /** Directory Claude works in. */
  cwd: string;
  /** Node binary that runs the adapter. */
  nodePath: string;
  /** Path to claude-agent-acp's entry script. */
  adapterEntry: string;
  env: NodeJS.ProcessEnv;
  /** Settings to apply to every new session, by ACP config option id. */
  startupConfig: Record<string, string>;
  /** A past session to open instead of starting a new one. */
  resume: ResumeTarget | null;
  /** Text added to Claude's system prompt, describing what this client can display. */
  systemPromptAppend: string;
  emit(message: MainMessage): void;
};

export type ResumeTarget = { kind: "session"; sessionId: string } | { kind: "latest" };

type AuthStatusParams = {
  accounts?: { label?: string; email?: string; active?: boolean }[];
};

const STDERR_TAIL_BYTES = 4000;

/** claude-agent-acp's extension request that adds a message to the turn that is running. */
const STEER_METHOD = "_session/steering";

type SteerResponse = { outcome: "injected" | "promptRequired" | "startedNewTurn" };

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export function createAgent(options: AgentOptions) {
  const { emit } = options;
  let child: ChildProcessWithoutNullStreams | null = null;
  let connection: ClientConnection | null = null;
  let sessionId: string | null = null;
  let agentName = "Claude";
  let agentVersion = "";
  let stderrTail = "";
  let disposed = false;
  const pendingPermissions = new Map<string, (response: RequestPermissionResponse) => void>();

  function cancelPendingPermissions() {
    for (const [requestId, resolve] of pendingPermissions) {
      resolve({ outcome: { outcome: "cancelled" } });
      emit({ type: "permissionClosed", requestId });
    }
    pendingPermissions.clear();
  }

  function connect() {
    const spawned = spawn(options.nodePath, [options.adapterEntry], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = spawned;
    spawned.stderr.setEncoding("utf8");
    spawned.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });
    spawned.on("error", (error) => {
      if (disposed) return;
      emit({ type: "error", fatal: true, message: `Could not start Claude: ${error.message}` });
    });
    spawned.on("exit", (code, signal) => {
      if (disposed) return;
      cancelPendingPermissions();
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      const detail = stderrTail.trim().split("\n").slice(-6).join("\n");
      emit({
        type: "error",
        fatal: true,
        message: `The Claude adapter exited (${reason}).${detail ? `\n${detail}` : ""}`,
      });
    });

    const app = client({ name: "claudesaurus" })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (params.sessionId !== sessionId) return;
        emit({ type: "update", update: params.update });
      })
      .onRequest(methods.client.session.requestPermission, ({ params, signal }) => {
        const requestId = randomUUID();
        return new Promise<RequestPermissionResponse>((resolve) => {
          pendingPermissions.set(requestId, resolve);
          signal.addEventListener("abort", () => {
            if (!pendingPermissions.delete(requestId)) return;
            resolve({ outcome: { outcome: "cancelled" } });
            emit({ type: "permissionClosed", requestId });
          });
          emit({
            type: "permissionRequest",
            requestId,
            toolCall: params.toolCall,
            options: params.options,
          });
        });
      })
      .onNotification("*", ({ method, params }) => {
        if (method !== "auth/status_update") return;
        const accounts = (params as AuthStatusParams).accounts ?? [];
        const account = accounts.find((candidate) => candidate.active) ?? accounts[0];
        if (!account) return;
        emit({
          type: "account",
          account: { label: account.label ?? "Claude", email: account.email ?? null },
        });
      });

    const stream = ndJsonStream(
      Writable.toWeb(spawned.stdin),
      Readable.toWeb(spawned.stdout) as ReadableStream<Uint8Array>,
    );
    connection = app.connect(stream);
    return connection;
  }

  const systemPrompt: SystemPrompt = {
    mode: "append",
    content: [{ type: "text", text: options.systemPromptAppend }],
  };

  /** Makes a session the current one and tells the page, which starts its conversation afresh. */
  function announce(id: string, configOptions: SessionConfigOption[], loadingHistory: boolean) {
    sessionId = id;
    emit({
      type: "session",
      session: {
        sessionId: id,
        cwd: options.cwd,
        agentName,
        agentVersion,
        configOptions,
        loadingHistory,
      },
    });
  }

  async function applyStartupConfig() {
    for (const [configId, value] of Object.entries(options.startupConfig)) {
      await setConfig(configId, value);
    }
  }

  async function openSession(active: ClientConnection) {
    const session = await active.agent.request(methods.agent.session.new, {
      cwd: options.cwd,
      mcpServers: [],
      systemPrompt,
    });
    announce(session.sessionId, session.configOptions ?? [], false);
    await applyStartupConfig();
  }

  /** Opens a past session. The adapter replays its conversation as updates while it loads. */
  async function loadSession(active: ClientConnection, id: string) {
    announce(id, [], true);
    const session = await active.agent.request(methods.agent.session.load, {
      sessionId: id,
      cwd: options.cwd,
      mcpServers: [],
      systemPrompt,
    });
    emit({ type: "historyLoaded" });
    emit({ type: "configOptions", configOptions: session.configOptions ?? [] });
    await applyStartupConfig();
  }

  /** The sessions started in this directory, newest first. */
  async function pastSessions(active: ClientConnection): Promise<PastSession[]> {
    const { sessions } = await active.agent.request(methods.agent.session.list, {
      cwd: options.cwd,
    });
    return sessions
      .map(({ sessionId, title, updatedAt }) => ({
        sessionId,
        title: title ?? null,
        updatedAt: updatedAt ?? null,
      }))
      .toSorted((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  async function latestSessionId(active: ClientConnection) {
    return (await pastSessions(active))[0]?.sessionId ?? null;
  }

  async function start() {
    emit({ type: "connecting" });
    try {
      const active = connect();
      const initialized = await active.agent.request(methods.agent.initialize, {
        protocolVersion: 1,
        clientInfo: { name: "claudesaurus", title: "Claudesaurus", version: "0.1.0" },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      });
      agentName = initialized.agentInfo?.title ?? initialized.agentInfo?.name ?? agentName;
      agentVersion = initialized.agentInfo?.version ?? "";
      const { resume } = options;
      const resumeId =
        resume?.kind === "session"
          ? resume.sessionId
          : resume
            ? await latestSessionId(active)
            : null;
      if (resumeId) await loadSession(active, resumeId);
      else await openSession(active);
    } catch (error) {
      emit({
        type: "error",
        fatal: true,
        message: `Could not start a Claude session: ${errorMessage(error)}`,
      });
    }
  }

  function promptBlocks(text: string, images: PromptImage[]) {
    const blocks: ContentBlock[] = images.map((image) => ({ type: "image", ...image }));
    if (text) blocks.push({ type: "text", text });
    return blocks;
  }

  async function prompt(text: string, images: PromptImage[]) {
    if (!connection || !sessionId) return;
    try {
      const response = await connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: promptBlocks(text, images),
      });
      emit({ type: "turnEnded", stopReason: response.stopReason });
    } catch (error) {
      emit({ type: "error", fatal: false, message: errorMessage(error) });
      emit({ type: "turnEnded", stopReason: "error" });
    }
  }

  /**
   * Sends a message into the turn that is running instead of after it. If that turn has just
   * ended, the adapter leaves the message to us, and it starts a turn of its own.
   */
  async function steer(text: string, images: PromptImage[]) {
    if (!connection || !sessionId) return;
    try {
      const response = await connection.agent.request<SteerResponse>(STEER_METHOD, {
        sessionId,
        prompt: promptBlocks(text, images),
        _meta: { steering: { idleBehavior: "promptRequired" } },
      });
      if (response.outcome === "promptRequired") await prompt(text, images);
    } catch (error) {
      emit({ type: "error", fatal: false, message: errorMessage(error) });
    }
  }

  async function cancel() {
    if (!connection || !sessionId) return;
    cancelPendingPermissions();
    await connection.agent.notify(methods.agent.session.cancel, { sessionId });
  }

  function resolvePermission(requestId: string, optionId: string | null) {
    const resolve = pendingPermissions.get(requestId);
    if (!resolve) return;
    pendingPermissions.delete(requestId);
    resolve({
      outcome: optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId },
    });
    emit({ type: "permissionClosed", requestId });
  }

  async function setConfig(configId: string, value: string | boolean) {
    if (!connection || !sessionId) return;
    try {
      const response = await connection.agent.request(
        methods.agent.session.setConfigOption,
        typeof value === "boolean"
          ? { sessionId, configId, type: "boolean", value }
          : { sessionId, configId, value },
      );
      emit({ type: "configOptions", configOptions: response.configOptions });
    } catch (error) {
      emit({
        type: "error",
        fatal: false,
        message: `Could not change ${configId}: ${errorMessage(error)}`,
      });
    }
  }

  async function newSession() {
    if (!connection) return;
    cancelPendingPermissions();
    try {
      await openSession(connection);
    } catch (error) {
      emit({
        type: "error",
        fatal: false,
        message: `Could not start a new session: ${errorMessage(error)}`,
      });
    }
  }

  async function listSessions() {
    if (!connection) return;
    try {
      emit({ type: "sessions", sessions: await pastSessions(connection) });
    } catch (error) {
      emit({ type: "sessions", sessions: [] });
      emit({
        type: "error",
        fatal: false,
        message: `Could not list sessions: ${errorMessage(error)}`,
      });
    }
  }

  async function resume(id: string) {
    if (!connection) return;
    cancelPendingPermissions();
    try {
      await loadSession(connection, id);
    } catch (error) {
      emit({
        type: "error",
        fatal: false,
        message: `Could not open session ${id}: ${errorMessage(error)}`,
      });
    }
  }

  function dispose() {
    disposed = true;
    cancelPendingPermissions();
    connection?.close();
    child?.kill();
  }

  return {
    start,
    prompt,
    steer,
    cancel,
    resolvePermission,
    setConfig,
    newSession,
    listSessions,
    resume,
    dispose,
  };
}

export type Agent = ReturnType<typeof createAgent>;
