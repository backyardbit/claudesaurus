import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createSessionStore } from "./sessionStore";

function temporaryFile() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "claudesaurus-")),
    "state",
    "sessions.json",
  );
}

test("a session's agent, title and usage survive a restart", () => {
  const file = temporaryFile();
  const first = createSessionStore(file);
  first.update("a", { agent: "codex-acp", title: "Fix the build" });
  first.update("a", { used: 10, size: 100 });
  expect(first.get("a")).toMatchObject({ agent: "codex-acp", title: "Fix the build", used: 10 });
  first.flush();
  expect(createSessionStore(file).get("a")).toMatchObject({
    agent: "codex-acp",
    title: "Fix the build",
    used: 10,
    size: 100,
  });
  expect(createSessionStore(file).get("unknown")).toBeNull();
});

test("two running copies keep each other's sessions", () => {
  const file = temporaryFile();
  const one = createSessionStore(file);
  const two = createSessionStore(file);
  one.update("a", { agent: "claude-acp" });
  two.update("b", { agent: "grok-build" });
  one.flush();
  two.flush();
  const later = createSessionStore(file);
  expect(later.get("a")?.agent).toBe("claude-acp");
  expect(later.get("b")?.agent).toBe("grok-build");
});

test("an update keeps what another copy saved about the session", () => {
  const file = temporaryFile();
  const one = createSessionStore(file);
  one.update("a", { agent: "claude-acp", title: "Plan the release" });
  one.flush();
  const two = createSessionStore(file);
  two.update("a", { used: 5, size: 100 });
  two.flush();
  expect(createSessionStore(file).get("a")).toMatchObject({
    agent: "claude-acp",
    title: "Plan the release",
    used: 5,
  });
});
