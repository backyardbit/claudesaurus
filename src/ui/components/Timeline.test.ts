import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { expect, test } from "vitest";
import type { MainMessage } from "../../shared/protocol";
import { initialState, reduce } from "../store";
import { loosePermissions, zenItems } from "./Timeline";

function update(sessionUpdate: SessionUpdate): MainMessage {
  return { type: "update", update: sessionUpdate };
}

function said(value: string, messageId: string): MainMessage {
  return update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: value },
    messageId,
  });
}

/** A turn that thinks, says something, runs a subagent that reads a file, then answers. */
const turn = [
  { type: "userMessage", text: "Look around", images: [] },
  update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } }),
  said("Let me look.", "a"),
  update({ sessionUpdate: "tool_call", toolCallId: "agent", title: "Explore" }),
  update({
    sessionUpdate: "tool_call",
    toolCallId: "inner",
    title: "Read a.ts",
    _meta: { claudeCode: { parentToolUseId: "agent" } },
  }),
  said("Found it.", "b"),
  {
    type: "permissionRequest",
    requestId: "p",
    toolCall: { toolCallId: "inner" },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  },
] satisfies MainMessage[];

const state = turn.reduce(
  (earlier, message, index) => reduce(earlier, message, index),
  initialState,
);

test("zen keeps what was said and drops tool calls and thoughts", () => {
  expect(zenItems(state.items).map((item) => item.kind)).toEqual([
    "user",
    "assistant",
    "assistant",
  ]);
});

test("a prompt sits under its tool card, or after the conversation when zen hides the card", () => {
  expect(loosePermissions(state.items, state.permissions)).toEqual([]);
  expect(loosePermissions(zenItems(state.items), state.permissions)).toEqual(state.permissions);
});
