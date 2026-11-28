import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const [, , block, pid, sessionId] = process.argv;
const state = path.join(os.homedir(), ".local", "state", "claudesaurus");
const launcher = fileURLToPath(new URL("../bin/claudesaurus.mjs", import.meta.url));
const DETACHED = "CLAUDESAURUS_RESTART_DETACHED";
const POLL_MS = 3000;
const QUIET_POLLS = 3;

function log(text) {
  fs.mkdirSync(state, { recursive: true });
  fs.appendFileSync(path.join(state, "restart.log"), `${new Date().toISOString()} ${text}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rex = (...args) => execFileSync("rex", args, { encoding: "utf8" });

function alive() {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function debugPort() {
  const sockets =
    process.platform === "linux"
      ? execFileSync("ss", ["-ltnp"], { encoding: "utf8" })
          .split("\n")
          .filter((line) => line.includes(`pid=${pid},`))
      : execFileSync("lsof", ["-nP", "-a", "-p", pid, "-iTCP", "-sTCP:LISTEN"], {
          encoding: "utf8",
        }).split("\n");
  return sockets.map((line) => line.match(/127\.0\.0\.1:(\d+)/)?.[1]).find(Boolean);
}

const AGENT_IDS = new Map([
  ["claude-code", "claude-acp"],
  ["codex", "codex-acp"],
  ["grok-build", "grok-build"],
  ["agy", "antigravity-acp"],
  ["gemini", "gemini"],
  ["cursor-agent", "cursor"],
  ["opencode", "opencode"],
]);

const StatusSchema = z.object({ records: z.array(z.object({ app: z.string() })).min(1) });

function runningAgent() {
  try {
    const status = StatusSchema.parse(
      JSON.parse(rex("block", "call", "-b", block, "program_status")),
    );
    const app = status.records[0]?.app ?? "";
    return AGENT_IDS.get(app) ?? app;
  } catch {
    return null;
  }
}

function quote(word) {
  if (word.includes("'")) throw new Error(`cannot quote ${word} for every shell`);
  return `'${word}'`;
}

if (!process.env[DETACHED]) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, [DETACHED]: "1" },
    },
  );
  child.unref();
  console.log(`Restarting ${block} once its turn ends; see ${path.join(state, "restart.log")}`);
  process.exit(0);
}

process.on("uncaughtException", (error) => {
  log(`failed: ${error.message}`);
  process.exit(1);
});

async function evaluate(port, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((target) => target.type === "page" && target.url.includes("dist/ui"));
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    socket.onerror = reject;
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    socket.onmessage = (event) => {
      resolve(JSON.parse(event.data).result?.result?.value);
      socket.close();
    };
  });
}

const BUSY = `Boolean(
  document.querySelector(".working, .send.stop, .permission, .queued") ||
    document.querySelector("textarea")?.value
)`;

const port = debugPort();
if (!port) {
  log(`no debugging port for pid ${pid}; nothing done`);
  process.exit(1);
}
log(`watching ${block}, pid ${pid}, port ${port}`);

for (let quiet = 0; quiet < QUIET_POLLS; ) {
  await sleep(POLL_MS);
  if (!alive()) {
    log("the app is already gone; leaving the pane alone");
    process.exit(0);
  }
  const busy = await evaluate(port, BUSY).catch(() => true);
  quiet = busy ? 0 : quiet + 1;
}

const agent = runningAgent();
rex("send-key", "--block", block, "ctrl+q");
for (let waited = 0; alive() && waited < 20; waited += 1) await sleep(500);
if (alive()) {
  log("the app did not quit; leaving it running");
  process.exit(1);
}
await sleep(1000);
rex(
  "send",
  "--block",
  block,
  [process.execPath, launcher, "--resume", sessionId, ...(agent ? ["--agent", agent] : [])]
    .map(quote)
    .join(" "),
);
rex("send-key", "--block", block, "enter");
log(`restarted ${sessionId} with ${agent ?? "the saved agent"}`);
