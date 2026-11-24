import { expect, test } from "vitest";
import type { MainMessage } from "../shared/protocol";
import {
  CLEAR_STATUS,
  createStatusReporter,
  encodeNotification,
  encodeStatus,
  type StatusReport,
} from "./status";

const PREFIX = "\x1b]7501;";
const TERMINATOR = "\x1b\\";

function decode(sequence: string) {
  if (!sequence.startsWith(PREFIX) || !sequence.endsWith(TERMINATOR)) return { other: sequence };
  const body = sequence.slice(PREFIX.length, -TERMINATOR.length);
  const pairs = Object.fromEntries(body.split(":").map((pair) => pair.split(/=(.*)/s)));
  if (pairs.msg) pairs.msg = Buffer.from(pairs.msg, "base64").toString("utf8");
  return pairs as Record<string, string>;
}

function reporter() {
  const written: string[] = [];
  let time = 0;
  const status = createStatusReporter(
    (sequence) => written.push(sequence),
    () => time,
  );
  return {
    status,
    states: () => written.map(decode),
    advance(ms: number) {
      time += ms;
    },
  };
}

const session: MainMessage = {
  type: "session",
  session: {
    sessionId: "s",
    cwd: "/w",
    agentName: "Claude",
    agentVersion: "1",
    configOptions: [],
    loadingHistory: false,
  },
};
const prompt: MainMessage = { type: "userMessage", text: "go", images: [] };

function tool(title: string): MainMessage {
  return { type: "update", update: { sessionUpdate: "tool_call", toolCallId: title, title } };
}

test("encodes a report with the app name and a base64 message", () => {
  const report: StatusReport = { state: "working", message: "Edit a.ts" };
  expect(encodeStatus(report)).toBe(
    `\x1b]7501;state=working:app=claudesaurus:msg=${btoa("Edit a.ts")}\x1b\\`,
  );
  expect(encodeStatus({ state: "idle" })).toBe("\x1b]7501;state=idle:app=claudesaurus\x1b\\");
});

test("keeps control characters and long text out of a report", () => {
  const { msg } = decode(
    encodeStatus({ state: "done", message: `one\ntwo\x1b[0m ${"x".repeat(400)}` }),
  );
  expect(msg).not.toMatch(/\p{Cc}/u);
  expect(msg?.startsWith("one two [0m")).toBe(true);
  expect(msg?.length).toBe(200);
});

test("a notification's text cannot add fields", () => {
  expect(encodeNotification("a;b", "c;d\ne")).toBe("\x1b]777;notify;a,b;c,d e\x1b\\");
});

test("reports idle, then working with what Claude is doing, then done when out of sight", () => {
  const { status, states, advance } = reporter();
  status.focus(false);
  status.observe(session);
  status.observe(prompt);
  status.observe(tool("Read a.ts"));
  advance(100);
  status.observe(tool("Read b.ts"));
  advance(2000);
  status.observe(tool("Edit a.ts"));
  status.observe({ type: "turnEnded", stopReason: "end_turn" });
  expect(states()).toMatchObject([
    { state: "idle" },
    { state: "working" },
    { state: "working", msg: "Read a.ts" },
    { state: "working", msg: "Edit a.ts" },
    { state: "done" },
    { other: encodeNotification("Claudesaurus", "Claude finished") },
  ]);
});

test("a turn that ends in view is idle, with no notification", () => {
  const { status, states } = reporter();
  status.focus(true);
  status.observe(prompt);
  status.observe({ type: "turnEnded", stopReason: "end_turn" });
  expect(states()).toMatchObject([{ state: "working" }, { state: "idle" }]);
});

test("coming back to a finished turn marks it seen", () => {
  const { status, states } = reporter();
  status.observe(prompt);
  status.observe({ type: "turnEnded", stopReason: "end_turn" });
  status.focus(true);
  expect(states().map((state) => state.state)).toEqual(["working", "done", "idle"]);
});

test("a permission prompt blocks until it is answered", () => {
  const { status, states } = reporter();
  status.focus(true);
  status.observe(prompt);
  status.observe({
    type: "permissionRequest",
    requestId: "p",
    toolCall: { toolCallId: "t", title: "rm -rf build" },
    options: [],
  });
  status.observe({ type: "permissionClosed", requestId: "p" });
  expect(states()).toMatchObject([
    { state: "working" },
    { state: "blocked", kind: "permission", msg: "rm -rf build" },
    { state: "working" },
  ]);
});

test("stopping a turn is idle, and a failed one is an error", () => {
  const { status, states } = reporter();
  status.focus(true);
  status.observe(prompt);
  status.observe({ type: "turnEnded", stopReason: "cancelled" });
  status.observe(prompt);
  status.observe({ type: "turnEnded", stopReason: "error" });
  expect(states().map((state) => state.state)).toEqual(["working", "idle", "working", "error"]);
});

test("history replayed from a past session reports nothing", () => {
  const { status, states } = reporter();
  status.observe(session);
  status.observe(tool("Read a.ts"));
  expect(states()).toMatchObject([{ state: "idle" }]);
});

test("clearing removes the records", () => {
  const { status, states } = reporter();
  status.clear();
  expect(CLEAR_STATUS).toBe("\x1b]7501;state=clear\x1b\\");
  expect(states()).toEqual([{ state: "clear" }]);
});
