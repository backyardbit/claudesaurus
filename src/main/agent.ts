import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
  type AuthMethod,
  type ClientConnection,
  type ContentBlock,
  client,
  type McpServer,
  methods,
  ndJsonStream,
  type PermissionOption,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SystemPrompt,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { z } from "zod";
import type {
  AgentFeatures,
  AgentIdentity,
  AuthChoice,
  AuthRequest,
  MainMessage,
  PastSession,
  PromptImage,
} from "../shared/protocol";
import { agentFeatures, pickStartupConfig } from "./capabilities";

/** A program to run, with the variables it needs on top of the app's environment. */
export type LaunchCommand = { command: string; args: string[]; env: Map<string, string> };

export type AgentOptions = {
  /** Directory the agent works in. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The agent's registry id, and the name to show until its entry is read. */
  agent: AgentIdentity;
  /**
   * Installs the agent if it needs to be, reporting how far along it is, and says how to run it
   * and what it is called.
   */
  prepare(report: (detail: string) => void): Promise<{ name: string; launch: LaunchCommand }>;
  /** Settings given on the command line, by name: model, effort and mode. */
  startupConfig: ReadonlyMap<string, string>;
  /** A past session to open instead of starting a new one. */
  resume: ResumeTarget | null;
  /** Text for the agent's system prompt, describing what this client can display. */
  systemPromptAppend: string;
  /** MCP servers every session gets, such as the one with the `celebrate` tool. */
  mcpServers: McpServer[];
  /**
   * Opens a terminal pane running the command, for a login the agent does in a terminal, and
   * resolves to whether it succeeded once it exits. Null where no pane can be opened.
   */
  openTerminal(command: LaunchCommand, label: string): Promise<boolean> | null;
  emit(message: MainMessage): void;
};

export type ResumeTarget = { kind: "session"; sessionId: string } | { kind: "latest" };

/** The adapter's `auth/status_update` notification: the accounts it can use. */
const AuthStatusSchema = z.object({
  accounts: z
    .array(
      z.object({
        label: z.string().optional(),
        email: z.string().optional(),
        active: z.boolean().optional(),
      }),
    )
    .optional(),
});

const STDERR_TAIL_BYTES = 4000;

/** ACP's error code for a request that needs the user to sign in first. */
const AUTH_REQUIRED = -32000;

const AuthRequiredSchema = z.object({ code: z.literal(AUTH_REQUIRED) });

/** Where the note on what the page draws comes from, for agents that take it as a prompt block. */
const CONTEXT_URI = "claudesaurus://display-guide";

/** The extension request that adds a message to the turn that is running. */
const STEER_METHOD = "_session/steering";

type SteerResponse = { outcome: "injected" | "promptRequired" | "startedNewTurn" };

/** What a failed request threw, as text: its message when it has one. */
const ErrorMessageSchema = z.union([
  z.object({ message: z.string() }).transform(({ message }) => message),
  z.unknown().transform(String),
]);

export function createAgent(options: AgentOptions) {
  /** Once another agent takes over, nothing this one still has in flight reaches the page. */
  function emit(message: MainMessage) {
    if (!disposed) options.emit(message);
  }
  let child: ChildProcessWithoutNullStreams | null = null;
  let connection: ClientConnection | null = null;
  let sessionId: string | null = null;
  const agent = { ...options.agent };
  let agentVersion = "";
  let features: AgentFeatures = {
    resume: false,
    steer: false,
    systemPrompt: false,
    embeddedContext: false,
  };
  let launch: LaunchCommand | null = null;
  let authMethods: AuthMethod[] = [];
  let auth: AuthRequest | null = null;
  /** True until the session's first prompt, for agents that get the note in it. */
  let contextPending = false;
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

  function connect(command: LaunchCommand) {
    const spawned = spawn(command.command, command.args, {
      cwd: options.cwd,
      env: { ...options.env, ...Object.fromEntries(command.env) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = spawned;
    spawned.stderr.setEncoding("utf8");
    spawned.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });
    spawned.on("error", (error) => {
      if (disposed) return;
      emit({
        type: "error",
        fatal: true,
        message: `Could not start ${agent.name}: ${error.message}`,
      });
    });
    spawned.on("exit", (code, signal) => {
      if (disposed) return;
      cancelPendingPermissions();
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      const detail = stderrTail.trim().split("\n").slice(-6).join("\n");
      emit({
        type: "error",
        fatal: true,
        message: `${agent.name} exited (${reason}).${detail ? `\n${detail}` : ""}`,
      });
    });

    const app = client({ name: "claudesaurus" })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (params.sessionId !== sessionId) return;
        emit({ type: "update", update: params.update });
      })
      .onRequest(methods.client.session.requestPermission, ({ params, signal }) => {
        const allow = isCelebrateCall(params.toolCall) ? allowOption(params.options) : null;
        if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } };
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
        const status = AuthStatusSchema.safeParse(params);
        const accounts = (status.success && status.data.accounts) || [];
        const account = accounts.find((candidate) => candidate.active) ?? accounts[0];
        if (!account) return;
        emit({
          type: "account",
          account: { label: account.label ?? agent.name, email: account.email ?? null },
        });
      });

    const stream = ndJsonStream(
      Writable.toWeb(spawned.stdin),
      // SAFETY: stdout has no encoding set, so the stream it becomes yields Buffers, which are
      // Uint8Arrays; Node types the web stream's chunks as `any`.
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
    auth = null;
    contextPending = !features.systemPrompt;
    emit({
      type: "session",
      session: {
        sessionId: id,
        cwd: options.cwd,
        agent,
        agentVersion,
        features,
        configOptions,
        loadingHistory,
      },
    });
  }

  /** Applies the command line's settings that the session has options for. */
  async function applyStartupConfig(configOptions: SessionConfigOption[]) {
    const { applied, skipped } = pickStartupConfig(options.startupConfig, configOptions);
    for (const { configId, value } of applied) await setConfig(configId, value);
    if (skipped.length === 0) return;
    const flags = skipped.map((name) => `--${name}`).join(", ");
    emit({ type: "error", fatal: false, message: `${agent.name} has no setting for ${flags}.` });
  }

  /** The session fields that carry the note on what the page draws, where the agent takes it. */
  function promptFields() {
    return features.systemPrompt ? { systemPrompt } : {};
  }

  async function openSession(active: ClientConnection) {
    const session = await active.agent.request(methods.agent.session.new, {
      cwd: options.cwd,
      mcpServers: options.mcpServers,
      ...promptFields(),
    });
    announce(session.sessionId, session.configOptions ?? [], false);
    await applyStartupConfig(session.configOptions ?? []);
  }

  /** Opens a past session. The agent replays its conversation as updates while it loads. */
  async function loadSession(active: ClientConnection, id: string) {
    announce(id, [], true);
    const session = await active.agent.request(methods.agent.session.load, {
      sessionId: id,
      cwd: options.cwd,
      mcpServers: options.mcpServers,
      ...promptFields(),
    });
    emit({ type: "historyLoaded" });
    emit({ type: "configOptions", configOptions: session.configOptions ?? [] });
    await applyStartupConfig(session.configOptions ?? []);
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

  /** The past session the command line asks for, if the agent can reopen one. */
  async function resumeId(active: ClientConnection) {
    const { resume } = options;
    if (!resume) return null;
    if (!features.resume) {
      const message = `${agent.name} cannot reopen past sessions, so this is a new one.`;
      emit({ type: "error", fatal: false, message });
      return null;
    }
    return resume.kind === "session" ? resume.sessionId : await latestSessionId(active);
  }

  /** Opens the first session, or asks the user to sign in when the agent needs that first. */
  async function openFirst(active: ClientConnection) {
    try {
      const id = await resumeId(active);
      if (id) await loadSession(active, id);
      else await openSession(active);
    } catch (error) {
      if (!AuthRequiredSchema.safeParse(error).success || authMethods.length === 0) throw error;
      const status = auth ? `Still not signed in: ${ErrorMessageSchema.parse(error)}` : null;
      showAuth({ status, command: null });
    }
  }

  function showAuth(change: Omit<AuthRequest, "methods">) {
    auth = { methods: authMethods.map(authChoice), ...change };
    emit({ type: "auth", auth });
  }

  async function start() {
    emit({ type: "connecting", agent, detail: null });
    try {
      const prepared = await options.prepare((detail) =>
        emit({ type: "connecting", agent, detail }),
      );
      if (disposed) return;
      agent.name = prepared.name;
      launch = prepared.launch;
      emit({ type: "connecting", agent, detail: `Starting ${agent.name}…` });
      const active = connect(launch);
      const initialized = await active.agent.request(methods.agent.initialize, {
        protocolVersion: 1,
        clientInfo: { name: "claudesaurus", title: "Claudesaurus", version: "0.1.0" },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          auth: { terminal: true },
        },
      });
      agentVersion = initialized.agentInfo?.version ?? "";
      features = agentFeatures(initialized);
      authMethods = initialized.authMethods ?? [];
      await openFirst(active);
    } catch (error) {
      if (disposed) return;
      emit({
        type: "error",
        fatal: true,
        message: `Could not start a ${agent.name} session: ${ErrorMessageSchema.parse(error)}`,
      });
    }
  }

  /** Signs in with one of the agent's methods, then opens the session it was waiting for. */
  async function authenticate(methodId: string) {
    const method = authMethods.find((candidate) => candidate.id === methodId);
    if (!connection || !launch || !method) return;
    if ("type" in method && method.type === "terminal") {
      const login = terminalLogin(launch, method);
      const finished = options.openTerminal(login, `${agent.name} sign-in`);
      if (!finished) {
        showAuth({
          status: "Run this in a terminal to sign in, then choose Try again.",
          command: shellCommand(login),
        });
        return;
      }
      showAuth({
        status: "Sign in in the pane that opened below this one. This carries on when it closes.",
        command: null,
      });
      if (await finished) await retryAuth();
      else if (!disposed) {
        showAuth({ status: "The sign-in pane closed without signing in.", command: null });
      }
      return;
    }
    showAuth({
      status: `Signing in with ${method.name}. Finish in the browser window that opens.`,
      command: null,
    });
    try {
      await connection.agent.request(methods.agent.authenticate, { methodId });
      await openFirst(connection);
    } catch (error) {
      if (disposed) return;
      const status = `Could not sign in: ${ErrorMessageSchema.parse(error)}`;
      showAuth({ status, command: null });
    }
  }

  async function retryAuth() {
    if (!connection || !auth) return;
    showAuth({ status: "Trying again…", command: null });
    try {
      await openFirst(connection);
    } catch (error) {
      if (disposed) return;
      showAuth({ status: ErrorMessageSchema.parse(error), command: null });
    }
  }

  /**
   * The note on what the page draws, for an agent that takes no system prompt: a resource the
   * first prompt carries, or plain text where the agent takes no resources.
   */
  function contextBlock(): ContentBlock {
    const text = options.systemPromptAppend;
    if (!features.embeddedContext) return { type: "text", text: `${text}\n\n---\n\n` };
    return { type: "resource", resource: { uri: CONTEXT_URI, mimeType: "text/markdown", text } };
  }

  function promptBlocks(text: string, images: PromptImage[]) {
    const blocks: ContentBlock[] = images.map((image) => ({ type: "image", ...image }));
    if (text) blocks.push({ type: "text", text });
    if (contextPending) {
      contextPending = false;
      blocks.unshift(contextBlock());
    }
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
      emit({ type: "error", fatal: false, message: ErrorMessageSchema.parse(error) });
      emit({ type: "turnEnded", stopReason: "error" });
    }
  }

  /**
   * Sends a message into the turn that is running instead of after it. If that turn has just
   * ended, the adapter leaves the message to us, and it starts a turn of its own.
   */
  async function steer(text: string, images: PromptImage[]) {
    if (!connection || !sessionId || !features.steer) return;
    try {
      const response = await connection.agent.request<SteerResponse>(STEER_METHOD, {
        sessionId,
        prompt: promptBlocks(text, images),
        _meta: { steering: { idleBehavior: "promptRequired" } },
      });
      if (response.outcome === "promptRequired") await prompt(text, images);
    } catch (error) {
      emit({ type: "error", fatal: false, message: ErrorMessageSchema.parse(error) });
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
        value === true || value === false
          ? { sessionId, configId, type: "boolean", value }
          : { sessionId, configId, value },
      );
      emit({ type: "configOptions", configOptions: response.configOptions });
    } catch (error) {
      emit({
        type: "error",
        fatal: false,
        message: `Could not change ${configId}: ${ErrorMessageSchema.parse(error)}`,
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
        message: `Could not start a new session: ${ErrorMessageSchema.parse(error)}`,
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
        message: `Could not list sessions: ${ErrorMessageSchema.parse(error)}`,
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
        message: `Could not open session ${id}: ${ErrorMessageSchema.parse(error)}`,
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
    authenticate,
    retryAuth,
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

/** Where Claude reports the tool call's tool, by its full MCP name. */
const ClaudeToolMetaSchema = z.object({ claudeCode: z.object({ toolName: z.string() }) });

/** Where Antigravity reports an MCP tool call's server and tool. */
const McpToolMetaSchema = z.object({ mcp: z.object({ server: z.string(), tool: z.string() }) });

/** Titles agents give the call when they name its tool in no other way. */
const CELEBRATE_TITLES = new Set(["claudesaurus: celebrate", "claudesaurus_celebrate"]);

/**
 * Whether a tool call is the `celebrate` tool Claudesaurus serves, which does nothing but play an
 * animation and so needs no one's permission.
 */
export function isCelebrateCall(toolCall: ToolCallUpdate) {
  const claude = ClaudeToolMetaSchema.safeParse(toolCall._meta);
  if (claude.success) return claude.data.claudeCode.toolName === "mcp__claudesaurus__celebrate";
  const mcp = McpToolMetaSchema.safeParse(toolCall._meta);
  if (mcp.success)
    return mcp.data.mcp.server === "claudesaurus" && mcp.data.mcp.tool === "celebrate";
  return CELEBRATE_TITLES.has(toolCall.title ?? "");
}

function allowOption(permissionOptions: PermissionOption[]) {
  return permissionOptions.find((option) => option.kind === "allow_once") ?? null;
}

function authChoice(method: AuthMethod): AuthChoice {
  return {
    id: method.id,
    name: method.name,
    description: method.description ?? null,
    kind: "type" in method && method.type === "terminal" ? "terminal" : "agent",
  };
}

/**
 * The command for a `terminal` sign-in: the agent as it is launched, with the method's
 * arguments added and its variables on top, as ACP's `AuthMethodTerminal` describes.
 */
export function terminalLogin(
  launch: LaunchCommand,
  method: { args?: string[]; env?: { [name: string]: string } },
): LaunchCommand {
  return {
    command: launch.command,
    args: [...launch.args, ...(method.args ?? [])],
    env: new Map([...launch.env, ...Object.entries(method.env ?? {})]),
  };
}

/** Quotes a word for a POSIX shell, unless it needs none. */
function shellWord(word: string) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** A command as it would be typed in a terminal, variables first. */
export function shellCommand(command: LaunchCommand) {
  const variables = [...command.env].map(([name, value]) => `${name}=${shellWord(value)}`);
  return [...variables, command.command, ...command.args]
    .map((word, index) => (index < variables.length ? word : shellWord(word)))
    .join(" ");
}
