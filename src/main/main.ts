import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRoot, type WebViewProps } from "@zenbu-labs/pixel";
import { z } from "zod";
import { MAIN_CHANNEL, type MainMessage, UI_CHANNEL, type UiMessage } from "../shared/protocol";
import { createAgent, type ResumeTarget } from "./agent";
import { startDebugCapture } from "./debug";
import { createReplayAgent } from "./replay";
import { loadSettings, saveSettings } from "./settings";
import { createStatusReporter } from "./status";
import { SYSTEM_PROMPT_APPEND } from "./systemPrompt";
import { createUsageStore } from "./usageStore";

const cwd = process.cwd();

/** Variables the pixel runtime sets for itself; Claude's own shell commands must not inherit them. */
const RUNTIME_ENV_PREFIXES = ["ELECTRON_", "PIXEL_", "CHROME_"];

function agentEnv() {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
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
});

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    model: { type: "string" },
    effort: { type: "string" },
    mode: { type: "string" },
    resume: { type: "string" },
    continue: { type: "boolean" },
  },
  strict: false,
});
const flags = FlagsSchema.parse(values);

/** Session settings given on the command line, by ACP config option id. */
function startupConfig() {
  const config: Record<string, string> = {};
  for (const id of ["model", "effort", "mode"] as const) {
    const value = flags[id];
    if (value !== undefined) config[id] = value;
  }
  return config;
}

/** The past session the command line asks for: `--resume ID`, or `--continue` for the latest here. */
function resumeTarget(): ResumeTarget | null {
  if (flags.resume !== undefined) return { kind: "session", sessionId: flags.resume };
  return flags.continue ? { kind: "latest" } : null;
}

/**
 * The terminal font size, in CSS pixels, that the page's own type sizes were designed against.
 * The page is zoomed so its text keeps that proportion to the terminal's text on any display.
 */
const DESIGN_TERMINAL_FONT_PX = 13;

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
const usageStore = createUsageStore();

/** What Ctrl with a key does to the zoom: in, out, or back to the start. */
function zoomStep(key: string) {
  switch (key) {
    case "=":
    case "+":
      return 1;
    case "-":
      return -1;
    case "0":
      return 0;
    default:
      return undefined;
  }
}

const root = createRoot({
  name: "Claudesaurus",
  devtools: false,
  onResize(size) {
    debug?.note("resize", size);
  },
  onFocus(focused) {
    debug?.note("focus", focused);
    status.focus(focused);
  },
  onKey(event) {
    if (event.kind !== "press" || !event.mods.ctrl) return;
    if (event.key === "q") {
      quit();
      return true;
    }
    const zoom = zoomStep(event.key);
    if (zoom !== undefined) {
      view.zoom(zoom);
      return true;
    }
  },
});

/** The corner radius of a Rex pane, in points. */
const REX_PANE_RADIUS_PT = 10;

/**
 * Rex draws its panes with rounded corners, and a square page would cover them. In Rex the page
 * is rounded the same way, over a clear background, so the pane's own corners show.
 */
const inRex = Boolean(process.env.REX_BLOCK);
if (inRex) root.setClearColor([0, 0, 0, 0]);

/**
 * loadFile's options leave out `style`, but it applies them after its own full-size style, so a
 * style given here is used. It replaces that one, so it repeats the full size.
 */
const pageOptions: Omit<WebViewProps, "src" | "hidden" | "autoFocus"> = {
  preload: path.join(__dirname, "preload.cjs"),
  onOpenWindow: () => "deny",
};
if (inRex) {
  pageOptions.style = {
    width: "100%",
    height: "100%",
    cornerRadius: REX_PANE_RADIUS_PT * root.displayScale,
  };
}
const view = root.loadFile(path.join(__dirname, "ui", "index.html"), pageOptions);

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

function emit(message: MainMessage) {
  debug?.record(message);
  status.observe(message);
  if (message.type === "session") {
    sessionId = message.session.sessionId;
    history = history.filter((earlier) => earlier.type === "account");
    root.setTitle("Claudesaurus");
  }
  if (message.type === "update" && message.update.sessionUpdate === "session_info_update") {
    if (message.update.title) root.setTitle(`Claudesaurus · ${message.update.title}`);
  }
  if (message.type === "update" && message.update.sessionUpdate === "usage_update" && sessionId) {
    usageStore.set(sessionId, { used: message.update.used, size: message.update.size });
  }
  // A session list answers one request; a page that reloads asks again.
  if (message.type !== "sessions") history.push(message);
  if (pageReady) view.webContents.send(MAIN_CHANNEL, message);
  if (message.type === "historyLoaded") restoreUsage();
}

/** A reopened session gets the context usage it last reported, which Claude does not replay. */
function restoreUsage() {
  const usage = sessionId ? usageStore.get(sessionId) : null;
  if (usage) emit({ type: "update", update: { sessionUpdate: "usage_update", ...usage } });
}

const adapterPackage = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");

const agent = process.env.CLAUDESAURUS_REPLAY
  ? createReplayAgent(process.env.CLAUDESAURUS_REPLAY, emit)
  : createAgent({
      cwd,
      nodePath: process.env.CLAUDESAURUS_NODE ?? "node",
      adapterEntry: path.join(path.dirname(adapterPackage), "dist", "index.js"),
      env: agentEnv(),
      startupConfig: startupConfig(),
      resume: resumeTarget(),
      systemPromptAppend: SYSTEM_PROMPT_APPEND,
      emit,
    });

function quit() {
  debug?.stop();
  usageStore.flush();
  status.clear();
  agent.dispose();
  root.stop();
}

view.webContents.ipc.on(UI_CHANNEL, (_event, message: UiMessage) => {
  switch (message.type) {
    case "ready":
      pageReady = true;
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
    case "setDrawing":
      settings.drawing = message.drawing;
      saveSettings(settings);
      applyDrawing();
      break;
    case "copy":
      root.setClipboard(message.text);
      break;
    case "openLink":
      root.setClipboard(message.url);
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
  // The terminal's font size is in device pixels. Where the page is already drawn at the
  // display's scale, as on a Retina Mac, only the rest of the difference is zoom.
  const terminalFontPx = root.info.basePx / root.displayScale;
  view.webContents.setZoomFactor(terminalFontPx / DESIGN_TERMINAL_FONT_PX);
  debug?.note("info", { ...root.info, displayScale: root.displayScale });
});

void agent.start();
