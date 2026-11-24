import { expect, test } from "vitest";
import { ClaudeCodeMetaSchema, ToolInputSchema, ToolOutputSchema } from "./meta";

test("reads the adapter's fields and leaves out the ones of another type", () => {
  const meta = ClaudeCodeMetaSchema.parse({
    claudeCode: {
      toolName: "Edit",
      parentToolUseId: 7,
      toolResponse: {
        stdout: "ok",
        numFiles: "two",
        structuredPatch: [{ oldStart: 1, newStart: 1, lines: ["-a", "+b"] }],
      },
    },
  });
  expect(meta).toEqual({
    toolName: "Edit",
    parentToolUseId: undefined,
    toolResponse: {
      stdout: "ok",
      stderr: undefined,
      numFiles: undefined,
      numLines: undefined,
      structuredPatch: [{ oldStart: 1, newStart: 1, lines: ["-a", "+b"] }],
    },
  });
});

test("has no fields for a message without the adapter's meta", () => {
  expect(ClaudeCodeMetaSchema.parse(undefined)).toEqual({});
  expect(ClaudeCodeMetaSchema.parse({ other: true })).toEqual({});
});

test("drops a malformed patch rather than the whole response", () => {
  const meta = ClaudeCodeMetaSchema.parse({
    claudeCode: { toolResponse: { stdout: "ok", structuredPatch: [{ oldStart: "1" }] } },
  });
  expect(meta.toolResponse?.stdout).toBe("ok");
  expect(meta.toolResponse?.structuredPatch).toBeUndefined();
});

test("reads a tool's input whatever else it holds", () => {
  expect(
    ToolInputSchema.parse({ command: "ls", timeout: 5, todos: [{ status: "completed" }] }),
  ).toMatchObject({ command: "ls", todos: [{ status: "completed" }] });
  expect(ToolInputSchema.parse({ command: ["ls"] }).command).toBeUndefined();
  expect(ToolInputSchema.parse("not an object")).toEqual({});
  expect(ToolOutputSchema.parse({ text: "x" })).toBeNull();
  expect(ToolOutputSchema.parse("x")).toBe("x");
});
