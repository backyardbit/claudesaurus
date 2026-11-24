import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { expect, test } from "vitest";
import type { MainMessage } from "../shared/protocol";
import { initialState, reduce, type State } from "./store";

function play(messages: MainMessage[], from: State = initialState) {
  return messages.reduce((state, message, index) => reduce(state, message, 1000 + index), from);
}

function update(sessionUpdate: SessionUpdate): MainMessage {
  return { type: "update", update: sessionUpdate };
}

function text(sessionUpdate: "agent_message_chunk" | "agent_thought_chunk", value: string) {
  return update({ sessionUpdate, content: { type: "text", text: value } });
}

function session(loadingHistory: boolean): MainMessage {
  return {
    type: "session",
    session: {
      sessionId: "s",
      cwd: "/w",
      agentName: "Claude",
      agentVersion: "1",
      configOptions: [],
      loadingHistory,
    },
  };
}

test("joins streamed chunks into one assistant message", () => {
  const state = play([text("agent_message_chunk", "Hel"), text("agent_message_chunk", "lo")]);
  expect(state.items).toMatchObject([{ kind: "assistant", text: "Hello" }]);
});

test("starts a new message when the message id changes", () => {
  const chunk = (value: string, messageId: string) =>
    update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: value },
      messageId,
    });
  const state = play([chunk("One", "a"), chunk(".", "a"), chunk("Two", "b")]);
  expect(state.items).toMatchObject([
    { kind: "assistant", text: "One." },
    { kind: "assistant", text: "Two" },
  ]);
});

test("closes a thought when the answer starts", () => {
  const state = play([
    text("agent_thought_chunk", "hmm"),
    text("agent_thought_chunk", " ok"),
    text("agent_message_chunk", "Done"),
  ]);
  expect(state.items).toMatchObject([
    { kind: "thought", text: "hmm ok", startedAt: 1000, endedAt: 1002 },
    { kind: "assistant", text: "Done" },
  ]);
});

test("merges tool updates into the call they belong to", () => {
  const state = play([
    update({
      sessionUpdate: "tool_call",
      toolCallId: "a",
      title: "Terminal",
      kind: "execute",
      status: "pending",
      _meta: { claudeCode: { toolName: "Bash" } },
    }),
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "a",
      title: "ls",
      rawInput: { command: "ls" },
    }),
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "a",
      status: "completed",
      rawOutput: "file",
    }),
  ]);
  expect(state.items).toHaveLength(1);
  expect(state.items[0]).toMatchObject({
    kind: "tool",
    tool: {
      toolName: "Bash",
      title: "ls",
      status: "completed",
      rawInput: { command: "ls" },
      rawOutput: "file",
      startedAt: 1000,
      endedAt: 1002,
    },
  });
});

test("nests a subagent's work under the call that started it", () => {
  const state = play([
    update({ sessionUpdate: "tool_call", toolCallId: "agent", title: "Explore" }),
    update({
      sessionUpdate: "tool_call",
      toolCallId: "inner",
      title: "Read a.ts",
      _meta: { claudeCode: { parentToolUseId: "agent" } },
    }),
    update({ sessionUpdate: "tool_call_update", toolCallId: "inner", status: "completed" }),
  ]);
  expect(state.items).toHaveLength(1);
  expect(state.items[0]).toMatchObject({
    kind: "tool",
    tool: { children: [{ kind: "tool", tool: { toolCallId: "inner", status: "completed" } }] },
  });
});

test("a turn's end stops the clock and fails calls that never finished", () => {
  const state = play([
    { type: "userMessage", text: "go", images: [] },
    update({ sessionUpdate: "tool_call", toolCallId: "a", title: "ls", status: "in_progress" }),
    { type: "turnEnded", stopReason: "cancelled" },
  ]);
  expect(state.running).toBe(false);
  expect(state.items[1]).toMatchObject({ kind: "tool", tool: { status: "failed", endedAt: 1002 } });
});

test("a new session clears the conversation but keeps the account", () => {
  const state = play([
    { type: "account", account: { label: "Max", email: null } },
    { type: "userMessage", text: "hi", images: [] },
    session(false),
  ]);
  expect(state).toMatchObject({
    phase: "ready",
    items: [],
    running: false,
    account: { label: "Max" },
  });
});

test("replays a past session's messages without starting a turn or timing its work", () => {
  const piece = (value: string, messageId: string) =>
    update({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: value },
      messageId,
    });
  const state = play([
    session(true),
    piece(" \n\nfirst", "u1"),
    piece(" part", "u1"),
    text("agent_thought_chunk", "hmm"),
    update({ sessionUpdate: "tool_call", toolCallId: "a", title: "ls", status: "completed" }),
    text("agent_message_chunk", "Done"),
    piece("second", "u2"),
    { type: "historyLoaded" },
  ]);
  expect(state.running).toBe(false);
  expect(state.replaying).toBe(false);
  expect(state.items).toMatchObject([
    { kind: "user", text: "first part" },
    { kind: "thought", text: "hmm", timed: false },
    { kind: "tool", tool: { toolCallId: "a", timed: false } },
    { kind: "assistant", text: "Done" },
    { kind: "user", text: "second" },
  ]);
});

test("work after a replay is timed again", () => {
  const state = play([
    session(true),
    { type: "historyLoaded" },
    update({ sessionUpdate: "tool_call", toolCallId: "a", title: "ls" }),
  ]);
  expect(state.items[0]).toMatchObject({ kind: "tool", tool: { timed: true } });
});

test("tracks pending permission requests", () => {
  const asked = play([
    {
      type: "permissionRequest",
      requestId: "p",
      toolCall: { toolCallId: "a" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    },
  ]);
  expect(asked.permissions).toHaveLength(1);
  expect(play([{ type: "permissionClosed", requestId: "p" }], asked).permissions).toHaveLength(0);
});
