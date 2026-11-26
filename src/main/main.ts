import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { McpServer } from "@agentclientprotocol/sdk";
import { z } from "zod";
import { MAIN_CHANNEL, type MainMessage, UI_CHANNEL, type UiMessage } from "../shared/protocol";
import { type Agent, createAgent, type ResumeTarget } from "./agent";
import { createChatSocket } from "./chatSocket";
import { startDebugCapture } from "./debug";
import { agentChoices, openRexPane, prepareLaunch } from "./launch";
import { openPage } from "./page";
import { agentName, resolveAgentId } from "./registry";
import { createReplayAgent } from "./replay";
import {
  createResumeReporter,
  OSC7577_TOKEN_ENV,
  ownerPid,
  type ResumeState,
  resumeCommand,
  takeResumeToken,
} from "./resume";
import { openPullRequestPane, rexBlock, takeDraftFile } from "./rexPanes";
import { loadSettings, saveSettings } from "./settings";
import { createStatusReporter } from "./status";
import { SYSTEM_PROMPT_APPEND } from "./systemPrompt";
import { type ReadyUpdate, startAutoUpdater } from "./updater";
import { createUsageStore } from "./usageStore";

const cwd = process.cwd();
const resumeToken = takeResumeToken();

const GITHUB_PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

/** Variables the pixel runtime sets for itself; the agent's shell commands must not inherit them. */
const RUNTIME_ENV_PREFIXES = ["ELECTRON_", "PIXEL_", "CHROME_"];

function agentEnv() {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === OSC7577_TOKEN_ENV) continue;
    if (RUNTIME_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return env;
}

/** A flag left without its value is left out, as if it was not given. */
const optionalString = z.string().optional().catch(undefined);

const FlagsSchema = z.object({
  model: optionalString,
  effort: optionalString,
  mode: optionalString,
  resume: optionalString,
  continue: z.boolean().optional().catch(undefined),
  agent: optionalString,
  "draft-file": optionalString,
});

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: { type: "string" },
    effort: { type: "string" },
    mode: { type: "string" },
    resume: { type: "string" },
    continue: { type: "boolean" },
    agent: { type: "string" },
    "draft-file": { type: "string" },
  },
  strict: false,
});
const flags = FlagsSchema.parse(values);

/** A task the PR viewer left for this chat, put in the composer the first time the page loads. */
let draft = takeDraftFile(flags["draft-file"]);

/**
 * Tasks from a PR viewer this chat opened, put in the composer as they arrive, and the agent's
 * `celebrate` calls, played on the page as they come.
 */
const chatSocket = createChatSocket((message) => {
  if (message.type === "celebrate") emit(message);
  else if (pageReady) view.webContents.send(MAIN_CHANNEL, message satisfies MainMessage);
  else draft = message.text;
});

/** Session settings given on the command line, by name. */
function startupConfig() {
  const config = new Map<string, string>();
  for (const name of ["model", "effort", "mode"] as const) {
    const value = flags[name];
    if (value !== undefined) config.set(name, value);
  }
  return config;
}

/** The past session the command line asks for: `--resume ID`, or `--continue` for the latest here. */
function resumeTarget(): ResumeTarget | null {
  if (flags.resume !== undefined) return { kind: "session", sessionId: flags.resume };
  return flags.continue ? { kind: "latest" } : null;
}

/**
 * Writes an escape sequence to the terminal beside the frames PixelGUI draws. One short write is
 * never mixed into another program's write, so it cannot land inside a frame.
 */
function writeToTerminal(sequence: string) {
  try {
    fs.writeSync(process.stdout.fd, sequence);
  } catch {
    // Status reports are a courtesy; a terminal that cannot take one must not stop the chat.
  }
}

const status = createStatusReporter(writeToTerminal);
const resume = createResumeReporter({
  write: writeToTerminal,
  token: process.env.CLAUDESAURUS_REPLAY ? null : resumeToken,
  pid: ownerPid(),
  command: resumeCommand(),
  cwd,
});
process.on("SIGCONT", () => resume.rereport());
const usageStore = createUsageStore();

const { root, view } = openPage({
  name: "Claudesaurus",
  html: path.join("ui", "index.html"),
  onQuit: () => quit(),
  onResize(size) {
    debug?.note("resize", size);
  },
  onFocus(focused) {
    debug?.note("focus", focused);
    status.focus(focused);
  },
});

const debugDirectory = process.env.CLAUDESAURUS_DEBUG_DIR;
const debug = debugDirectory ? startDebugCapture(debugDirectory, view.webContents) : null;
if (debugDirectory) {
  root.setLogFile(path.join(debugDirectory, "engine.log"));
  setInterval(() => debug?.note("stats", { at: Date.now(), ...root.surfaceStats() }), 1000);
  // SIGUSR2 starts an engine profile, and a second one stops it and notes where it was saved.
  let profiling = false;
  process.on("SIGUSR2", async () => {
    profiling = !profiling;
    if (profiling) root.startProfile();
    else debug?.note("profile", await root.stopProfile());
  });
}

const settings = loadSettings();

/** `CLAUDESAURUS_RENDER` overrides PixelGUI's render settings, for measuring: '{"maxFps":10}'. */
function applyDrawing() {
  root.setRender({
    tiles: settings.drawing === "patches" ? "off" : "auto",
    ...JSON.parse(process.env.CLAUDESAURUS_RENDER ?? "{}"),
  });
}
applyDrawing();

/** Everything sent since the session began, replayed when the page (re)loads. */
let history: MainMessage[] = [];
let pageReady = false;

let sessionId: string | null = null;
let canResumeSession = false;
let hasConversation = false;
let pendingResumeId: string | null = flags.resume ?? null;
let readyUpdate: ReadyUpdate | null = null;

function readAppVersion() {
  if (process.env.CLAUDESAURUS_VERSION) return process.env.CLAUDESAURUS_VERSION;
  try {
    const pkg = z
      .object({ version: z.string() })
      .safeParse(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")));
    return pkg.success ? pkg.data.version : "";
  } catch {
    return "";
  }
}

function reportResume() {
  const activeSession = (canResumeSession && hasConversation ? sessionId : null) ?? pendingResumeId;
  const state: ResumeState = {
    version: 1,
    kind: "chat",
    agentId: currentAgentId,
    sessionId: activeSession,
  };
  if (activeSession === null && currentAgentId === firstAgentId) {
    if (flags.model) state.model = flags.model;
    if (flags.effort) state.effort = flags.effort;
    if (flags.mode) state.mode = flags.mode;
  }
  resume.update(state);
}

function emit(message: MainMessage) {
  debug?.record(message);
  status.observe(message);
  // Another agent starting replaces everything shown before, and its progress replaces itself.
  if (message.type === "connecting") {
    history = [];
    currentAgentId = message.agent.id;
    sessionId = null;
    canResumeSession = false;
    hasConversation = false;
    reportResume();
  }
  if (message.type === "session") {
    pendingResumeId = null;
    sessionId = message.session.sessionId;
    currentAgentId = message.session.agent.id;
    canResumeSession = message.session.features.resume;
    hasConversation = message.session.loadingHistory;
    history = history.filter((earlier) => earlier.type === "account");
    root.setTitle("Claudesaurus");
    reportResume();
  }
  if (message.type === "userMessage") {
    hasConversation = true;
    reportResume();
  }
  if (message.type === "update") {
    if (
      !hasConversation &&
      (message.update.sessionUpdate === "user_message_chunk" ||
        message.update.sessionUpdate === "agent_message_chunk")
    ) {
      hasConversation = true;
      reportResume();
    }
    if (message.update.sessionUpdate === "session_info_update" && message.update.title) {
      root.setTitle(`Claudesaurus · ${message.update.title}`);
    }
    if (message.update.sessionUpdate === "usage_update" && sessionId) {
      usageStore.set(sessionId, { used: message.update.used, size: message.update.size });
    }
  }
  // A list answers one request, and a page that reloads asks again. A party happens once.
  if (!["sessions", "agents", "celebrate"].includes(message.type)) history.push(message);
  if (pageReady) view.webContents.send(MAIN_CHANNEL, message);
  if (message.type === "historyLoaded") restoreUsage();
}

/** A reopened session gets the context usage it last reported, which Claude does not replay. */
function restoreUsage() {
  const usage = sessionId ? usageStore.get(sessionId) : null;
  if (usage) emit({ type: "update", update: { sessionUpdate: "usage_update", ...usage } });
}

const adapterPackage = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
const claude = {
  nodePath: process.env.CLAUDESAURUS_NODE ?? "node",
  adapterEntry: path.join(path.dirname(adapterPackage), "dist", "index.js"),
};

/** The MCP server with the `celebrate` tool, which reaches this chat through its socket. */
function celebrateServer(): McpServer {
  return {
    name: "claudesaurus",
    command: claude.nodePath,
    args: [path.join(__dirname, "celebrate.cjs")],
    env: [{ name: "CLAUDESAURUS_CHAT_SOCKET", value: chatSocket.path() }],
  };
}

/** `--agent` picks the agent for this run; otherwise the one last picked with `/agent`. */
const firstAgentId = resolveAgentId(flags.agent ?? settings.agent);
let currentAgentId = firstAgentId;

/**
 * Starts an agent. The first one gets what the command line asked for; one picked later with
 * `/agent` starts plain, since a model or mode named for one agent rarely means much to another.
 */
function startAgent(
  agentId: string,
  resume: ResumeTarget | null,
  config = new Map<string, string>(),
): Agent {
  const started = createAgent({
    cwd,
    env: agentEnv(),
    agent: { id: agentId, name: agentName(agentId, null) },
    prepare: (report) => prepareLaunch(agentId, claude, report),
    startupConfig: config,
    resume,
    systemPromptAppend: SYSTEM_PROMPT_APPEND,
    mcpServers: [celebrateServer()],
    openTerminal: (command, label) => openRexPane(command, cwd, label),
    emit,
  });
  void started.start();
  return started;
}

let agent: Agent = process.env.CLAUDESAURUS_REPLAY
  ? createReplayAgent(process.env.CLAUDESAURUS_REPLAY, emit)
  : startAgent(firstAgentId, resumeTarget(), startupConfig());
if (process.env.CLAUDESAURUS_REPLAY) void agent.start();

/** Starts a new session on another agent, and makes it the one the next launch starts with. */
function switchAgent(nextId: string) {
  agent.dispose();
  pendingResumeId = null;
  currentAgentId = nextId;
  settings.agent = nextId;
  saveSettings(settings);
  agent = startAgent(nextId, null);
}

async function listAgents() {
  const version = JSON.parse(fs.readFileSync(adapterPackage, "utf8")).version ?? "";
  emit({ type: "agents", agents: await agentChoices(String(version)) });
}

const updateUrl = process.env.CLAUDESAURUS_UPDATE_URL;
const autoUpdateEnabled =
  (process.env.CLAUDESAURUS_PACKAGED === "1" || Boolean(updateUrl)) &&
  !process.env.CLAUDESAURUS_REPLAY &&
  process.env.CLAUDESAURUS_NO_AUTO_UPDATE !== "1";

const updater = autoUpdateEnabled
  ? startAutoUpdater({
      currentVersion: readAppVersion(),
      nodePath: claude.nodePath,
      releaseUrl: updateUrl,
      initialDelayMs: updateUrl ? 500 : undefined,
      pollIntervalMs: updateUrl ? 2000 : undefined,
      checkIntervalMs: updateUrl ? 0 : undefined,
      onUpdateReady(update) {
        readyUpdate = update;
        debug?.note("updateReady", update);
        if (pageReady) {
          view.webContents.send(MAIN_CHANNEL, {
            type: "updateReady",
            version: update.version,
          } satisfies MainMessage);
        }
      },
    })
  : null;

function quit(clearResume = true) {
  updater?.stop();
  debug?.stop();
  chatSocket.close();
  usageStore.flush();
  status.clear();
  if (clearResume) resume.clear();
  agent.dispose();
  root.stop();
}

function restart() {
  const restartFile = process.env.CLAUDESAURUS_RESTART_FILE;
  if (!restartFile) {
    emit({
      type: "error",
      fatal: false,
      message: "Restart is only available when started with the claudesaurus command.",
    });
    return;
  }
  const payload = {
    sessionId: canResumeSession && hasConversation ? sessionId : null,
    agentId: currentAgentId,
    root: readyUpdate?.root ?? null,
    version: readyUpdate?.version ?? null,
  };
  fs.writeFileSync(restartFile, JSON.stringify(payload));
  quit(false);
}

function toast(text: string) {
  view.webContents.send(MAIN_CHANNEL, { type: "toast", text } satisfies MainMessage);
}

/**
 * Following a link from the chat. A pull request opens in a viewer beside the chat when there is
 * Rex to split; anything else is copied, since the page cannot open a browser on the computer
 * the terminal runs on.
 */
async function openLink(url: string) {
  if (rexBlock && GITHUB_PULL_REQUEST_URL.test(url)) {
    try {
      await openPullRequestPane(url, cwd, chatSocket.path());
      toast("Opened the pull request");
      return;
    } catch (error) {
      debug?.note("openPullRequestPane", String(error));
    }
  }
  root.setClipboard(url);
  toast("Link copied");
}

view.webContents.ipc.on(UI_CHANNEL, (event, message: UiMessage) => {
  // A frame inside the page, such as an html block, must not be able to send prompts or answer
  // permission requests, even if it reaches the channel.
  if (event.senderFrame !== view.webContents.mainFrame) return;
  switch (message.type) {
    case "ready":
      pageReady = true;
      view.webContents.send(MAIN_CHANNEL, { type: "zen", zen: settings.zen } satisfies MainMessage);
      if (readyUpdate) {
        view.webContents.send(MAIN_CHANNEL, {
          type: "updateReady",
          version: readyUpdate.version,
        } satisfies MainMessage);
      }
      if (draft !== null) {
        view.webContents.send(MAIN_CHANNEL, { type: "draft", text: draft } satisfies MainMessage);
        draft = null;
      }
      for (const earlier of history) view.webContents.send(MAIN_CHANNEL, earlier);
      break;
    case "prompt":
      emit({ type: "userMessage", text: message.text, images: message.images });
      void agent.prompt(message.text, message.images);
      break;
    case "steer":
      emit({ type: "userMessage", text: message.text, images: message.images });
      void agent.steer(message.text, message.images);
      break;
    case "cancel":
      void agent.cancel();
      break;
    case "permission":
      agent.resolvePermission(message.requestId, message.optionId);
      break;
    case "setConfig":
      void agent.setConfig(message.configId, message.value);
      break;
    case "newSession":
      void agent.newSession();
      break;
    case "listSessions":
      void agent.listSessions();
      break;
    case "resume":
      void agent.resume(message.sessionId);
      break;
    case "listAgents":
      void listAgents();
      break;
    case "switchAgent":
      switchAgent(message.agentId);
      break;
    case "authenticate":
      void agent.authenticate(message.methodId);
      break;
    case "retryAuth":
      void agent.retryAuth();
      break;
    case "setDrawing":
      settings.drawing = message.drawing;
      saveSettings(settings);
      applyDrawing();
      break;
    case "setZen":
      settings.zen = message.zen;
      saveSettings(settings);
      break;
    case "copy":
      root.setClipboard(message.text);
      break;
    case "openLink":
      void openLink(message.url);
      break;
    case "restart":
      restart();
      break;
    case "quit":
      quit();
      break;
  }
});

// Only the chat page itself reloading makes it lose what it was sent. Frames inside it, such as
// an HTML preview, load all the time.
view.webContents.on("did-start-navigation", (details) => {
  if (details.isMainFrame && !details.isSameDocument) pageReady = false;
});

view.webContents.on("did-finish-load", () => {
  debug?.note("info", { ...root.info, displayScale: root.displayScale });
});
