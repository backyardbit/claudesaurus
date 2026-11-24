import type { MainMessage } from "../shared/protocol";

/**
 * The name this program reports itself under while Claude runs, which terminals use to group,
 * label and pick an icon for records. Claudesaurus is a front end for Claude Code, so it reports
 * as Claude Code.
 */
const CLAUDE_APP = "claude-code";

/**
 * The program names Rex knows, and has icons for, by the ACP registry id of the agent: each
 * agent's own CLI name, such as `agy` for Antigravity.
 */
const AGENT_APPS = new Map([
  ["claude-acp", CLAUDE_APP],
  ["codex-acp", "codex"],
  ["grok-build", "grok-build"],
  ["antigravity-acp", "agy"],
  ["gemini", "gemini"],
  ["cursor", "cursor-agent"],
  ["opencode", "opencode"],
]);

/** What the Program Status Protocol allows as an app name. */
const APP_PATTERN = /^[A-Za-z0-9_.+-]{1,32}$/;

/**
 * The app name to report while an agent runs: the one Rex knows for it, else its registry id,
 * else Claude Code's when the id is not a valid name.
 */
export function statusApp(agentId: string) {
  const known = AGENT_APPS.get(agentId);
  if (known) return known;
  return APP_PATTERN.test(agentId) ? agentId : CLAUDE_APP;
}

const MAX_TEXT_LENGTH = 200;

/** The least time between two reports that only change what the agent is working on. */
const ACTIVITY_INTERVAL_MS = 2000;

export type StatusReport =
  | { state: "idle" }
  | { state: "working"; message: string | null }
  | { state: "blocked"; message: string }
  | { state: "done"; message: string }
  | { state: "error"; message: string };

/** Makes text safe for one line of a report: no control characters, and not too long. */
function oneLine(text: string) {
  const clean = text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > MAX_TEXT_LENGTH ? `${clean.slice(0, MAX_TEXT_LENGTH - 1)}…` : clean;
}

function base64(text: string) {
  return Buffer.from(oneLine(text), "utf8").toString("base64");
}

/**
 * Encodes a report as a Program Status Protocol sequence (OSC 7501), which tells the terminal
 * whether this program is idle, working, waiting on the user, finished or failed.
 * https://www.superlogical.com/rex/docs/build/program-status
 */
export function encodeStatus(report: StatusReport, app = CLAUDE_APP) {
  const pairs = [`state=${report.state}`, `app=${app}`];
  if (report.state === "blocked") pairs.push("kind=permission");
  if ("message" in report && report.message) pairs.push(`msg=${base64(report.message)}`);
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}

/** Removes every record this program reported, for when it exits on purpose. */
export const CLEAR_STATUS = "\x1b]7501;state=clear\x1b\\";

/** Encodes a desktop notification (OSC 777), whose fields are separated by semicolons. */
export function encodeNotification(title: string, body: string) {
  const field = (text: string) => oneLine(text).replaceAll(";", ",");
  return `\x1b]777;notify;${field(title)};${field(body)}\x1b\\`;
}

type Clock = () => number;

/**
 * Follows the conversation and reports its state to the terminal: working while the agent runs,
 * blocked while a permission prompt waits, done when a turn finishes out of sight.
 */
export function createStatusReporter(write: (sequence: string) => void, now: Clock = Date.now) {
  /** Null until the terminal first says whether the pane has focus. */
  let focused: boolean | null = null;
  let running = false;
  let title: string | null = null;
  let agentName = "Claude";
  let app = CLAUDE_APP;
  let activity: string | null = null;
  let activityReportedAt = Number.NEGATIVE_INFINITY;
  let lastSequence = "";
  let lastState: StatusReport["state"] | null = null;
  const waiting = new Map<string, string>();

  function report(status: StatusReport) {
    const sequence = encodeStatus(status, app);
    if (sequence === lastSequence) return;
    lastSequence = sequence;
    lastState = status.state;
    write(sequence);
  }

  function notify(body: string) {
    if (focused === false) write(encodeNotification(title ?? "Claudesaurus", body));
  }

  function reportProgress() {
    const [question] = waiting.values();
    if (question !== undefined) report({ state: "blocked", message: question });
    else if (running) report({ state: "working", message: activity ?? title });
  }

  function finish(stopReason: string) {
    running = false;
    waiting.clear();
    if (stopReason === "cancelled") {
      report({ state: "idle" });
    } else if (stopReason === "error") {
      report({ state: "error", message: "The turn failed" });
      notify("The turn failed");
    } else if (focused === true) {
      report({ state: "idle" });
    } else {
      report({ state: "done", message: title ?? `${agentName} finished` });
      notify(`${agentName} finished`);
    }
  }

  return {
    observe(message: MainMessage) {
      switch (message.type) {
        case "connecting":
          // Another agent starting ends whatever the last one was doing.
          agentName = message.agent.name;
          app = statusApp(message.agent.id);
          running = false;
          waiting.clear();
          report({ state: "idle" });
          break;
        case "session":
          agentName = message.session.agent.name;
          running = false;
          waiting.clear();
          title = null;
          report({ state: "idle" });
          break;
        case "userMessage":
          running = true;
          activity = null;
          reportProgress();
          break;
        case "update": {
          const { update } = message;
          if (update.sessionUpdate === "session_info_update" && update.title) title = update.title;
          const startsWork =
            running &&
            (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") &&
            update.title;
          if (!startsWork || now() - activityReportedAt < ACTIVITY_INTERVAL_MS) break;
          activity = update.title ?? null;
          activityReportedAt = now();
          reportProgress();
          break;
        }
        case "permissionRequest": {
          const question = message.toolCall.title ?? `${agentName} needs permission`;
          waiting.set(message.requestId, question);
          reportProgress();
          notify(`Needs permission: ${question}`);
          break;
        }
        case "permissionClosed":
          if (waiting.delete(message.requestId)) reportProgress();
          break;
        case "turnEnded":
          finish(message.stopReason);
          break;
        case "error":
          if (!message.fatal) break;
          running = false;
          waiting.clear();
          report({
            state: "error",
            message: message.message.split("\n")[0] ?? `${agentName} stopped`,
          });
          notify(`${agentName} stopped`);
          break;
        default:
          break;
      }
    },
    /** Called when the pane gains or loses focus. Looking at a finished turn makes it seen. */
    focus(isFocused: boolean) {
      focused = isFocused;
      if (isFocused && lastState === "done") report({ state: "idle" });
    },
    clear() {
      write(CLEAR_STATUS);
    },
  };
}
