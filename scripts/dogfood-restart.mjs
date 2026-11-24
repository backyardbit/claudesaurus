// Restarts a Claudesaurus pane on a new build, from inside the session running in that pane.
//
//   node scripts/dogfood-restart.mjs BLOCK PIXEL_PID SESSION_ID
//
// It waits for the turn in the pane to end, quits the app, and runs
// `claudesaurus --resume SESSION_ID` in the shell under it. Start it detached, for example with
// `systemd-run --user --collect`, because quitting the app ends the session that started it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [, , block, pid, sessionId] = process.argv;
const state = path.join(os.homedir(), ".local", "state", "claudesaurus");
const POLL_MS = 3000;
const QUIET_POLLS = 3;

function log(text) {
  fs.mkdirSync(state, { recursive: true });
  fs.appendFileSync(path.join(state, "restart.log"), `${new Date().toISOString()} ${text}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rex = (...args) => execFileSync("rex", args, { encoding: "utf8" });
const alive = () => fs.existsSync(`/proc/${pid}`);

function debugPort() {
  const sockets = execFileSync("ss", ["-ltnp"], { encoding: "utf8" }).split("\n");
  return sockets.find((line) => line.includes(`pid=${pid},`))?.match(/127\.0\.0\.1:(\d+)/)?.[1];
}

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

/** True while a turn runs, a prompt waits, or the user has typed something they have not sent. */
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

rex("send-key", "--block", block, "ctrl+q");
for (let waited = 0; alive() && waited < 20; waited += 1) await sleep(500);
if (alive()) {
  log("the app did not quit; leaving it running");
  process.exit(1);
}
await sleep(1000);
rex("send", "--block", block, `claudesaurus --resume ${sessionId}`);
rex("send-key", "--block", block, "enter");
log(`restarted ${sessionId}`);
