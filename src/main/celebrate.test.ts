import { expect, test } from "vitest";
import { isCelebrateCall } from "./agent";

test("knows the celebrate call as Claude reports it", () => {
  expect(
    isCelebrateCall({
      toolCallId: "1",
      title: "claudesaurus: celebrate",
      _meta: { claudeCode: { toolName: "mcp__claudesaurus__celebrate" } },
    }),
  ).toBe(true);
  expect(
    isCelebrateCall({
      toolCallId: "2",
      title: "claudesaurus: celebrate",
      _meta: { claudeCode: { toolName: "mcp__other__celebrate" } },
    }),
  ).toBe(false);
});

test("knows the celebrate call as Antigravity reports it", () => {
  expect(
    isCelebrateCall({
      toolCallId: "1",
      title: "claudesaurus_celebrate",
      _meta: { mcp: { tool: "celebrate", server: "claudesaurus" }, is_mcp_tool_call: true },
    }),
  ).toBe(true);
  expect(
    isCelebrateCall({
      toolCallId: "2",
      title: "claudesaurus_celebrate",
      _meta: { mcp: { tool: "delete_everything", server: "claudesaurus" } },
    }),
  ).toBe(false);
});

test("falls back to the title, and asks about every other tool", () => {
  expect(isCelebrateCall({ toolCallId: "1", title: "claudesaurus_celebrate" })).toBe(true);
  expect(isCelebrateCall({ toolCallId: "2", title: "Bash" })).toBe(false);
  expect(isCelebrateCall({ toolCallId: "3" })).toBe(false);
});
