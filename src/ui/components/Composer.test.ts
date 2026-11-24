import { expect, test } from "vitest";
import type { AgentChoice, PastSession } from "../../shared/protocol";
import { formatAge } from "../format";
import { matchAgents, matchCommands, matchSessions } from "./Composer";

const sessions: PastSession[] = [
  { sessionId: "aaaa-1", title: "Fix the scroll jump", updatedAt: "2026-11-23T10:00:00Z" },
  { sessionId: "bbbb-2", title: "Add a resume picker", updatedAt: "2026-11-22T10:00:00Z" },
  { sessionId: "cccc-3", title: null, updatedAt: null },
];

function ids(query: string, currentId: string | null = null) {
  return matchSessions(sessions, query, currentId).map((past) => past.sessionId);
}

test("lists every session but the open one when nothing is typed", () => {
  expect(ids("")).toEqual(["aaaa-1", "bbbb-2", "cccc-3"]);
  expect(ids("", "aaaa-1")).toEqual(["bbbb-2", "cccc-3"]);
});

test("keeps sessions whose title or id holds every typed word", () => {
  expect(ids("RESUME")).toEqual(["bbbb-2"]);
  expect(ids("the jump")).toEqual(["aaaa-1"]);
  expect(ids("cccc")).toEqual(["cccc-3"]);
  expect(ids("scroll picker")).toEqual([]);
});

test("says how long ago in the largest whole unit", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  expect(formatAge("2026-11-24T11:59:30Z", now)).toBe("just now");
  expect(formatAge("2026-11-24T11:55:00Z", now)).toBe("5m ago");
  expect(formatAge("2026-11-24T09:00:00Z", now)).toBe("3h ago");
  expect(formatAge("2026-11-20T12:00:00Z", now)).toBe("4d ago");
  expect(formatAge("not a date", now)).toBe("");
});

test("finds agents by name, id or description", () => {
  const agents: AgentChoice[] = [
    { id: "claude-acp", name: "Claude", version: "1", description: "Anthropic's Claude Code" },
    { id: "codex-acp", name: "Codex", version: "2", description: "OpenAI's coding assistant" },
    { id: "grok-build", name: "Grok Build", version: "1", description: null },
  ];
  const names = (query: string) => matchAgents(agents, query).map((agent) => agent.id);
  expect(names("")).toEqual(["claude-acp", "codex-acp", "grok-build"]);
  expect(names("GROK")).toEqual(["grok-build"]);
  expect(names("openai")).toEqual(["codex-acp"]);
  expect(names("acp")).toEqual(["claude-acp", "codex-acp"]);
});

test("offers /resume only to an agent that can reopen sessions", () => {
  const names = (canResume: boolean) =>
    matchCommands([], "/res", canResume).map((command) => command.name);
  expect(names(true)).toContain("resume");
  expect(names(false)).not.toContain("resume");
  expect(matchCommands([], "/age", false).map((command) => command.name)).toEqual(["agent"]);
});
