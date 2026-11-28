import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveResumeFileArgs } from "../../bin/runtime.mjs";
import {
  createResumeReporter,
  encodeClearResume,
  encodeResume,
  OSC7577_TOKEN_ENV,
  ownerPid,
  pruneResumeFiles,
  RESUME_FILE_MAX_AGE_MS,
  resumeCommand,
  takeResumeToken,
} from "./resume";

const SPEC_TOKEN = "dummy-token-replace-me";
const temps: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudesaurus-resume-test-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("matches the official OSC 7577 spec test vectors", () => {
  expect(
    encodeResume({
      pid: 74877,
      time: 1795543200,
      argv: ["nvim", "-S", "/home/user/.local/state/nvim/sessions/8f2c1d.vim"],
      token: SPEC_TOKEN,
    }),
  ).toBe(
    "\x1b]7577;pid=74877:time=1795543200:argv=bnZpbQ==,LVM=,L2hvbWUvdXNlci8ubG9jYWwvc3RhdGUvbnZpbS9zZXNzaW9ucy84ZjJjMWQudmlt:mac=9dbb99bfb856749a87563839d7ce9062818d78cf25909db93f309e0cd3b1909b\x1b\\",
  );

  expect(encodeClearResume({ pid: 74877, time: 1795543200, token: SPEC_TOKEN })).toBe(
    "\x1b]7577;pid=74877:time=1795543200:clear=1:mac=c30603369f98fef581a4098be889175b0c74f0641e49f8b25f4326cb38f97c93\x1b\\",
  );

  expect(
    encodeResume({
      pid: 74877,
      time: 1795543200,
      argv: ["lazygit"],
      cwd: "/home/user/src/project",
      token: SPEC_TOKEN,
    }),
  ).toBe(
    "\x1b]7577;pid=74877:time=1795543200:argv=bGF6eWdpdA==:cwd=L2hvbWUvdXNlci9zcmMvcHJvamVjdA==:mac=35cb909805c380336efd3689a125acc774a9dec8422a1d21492ebec06ca758e1\x1b\\",
  );

  expect(
    encodeResume({
      pid: 90412,
      time: 1795543200,
      argv: ["resume-wrap", "ssh", "devbox"],
      token: SPEC_TOKEN,
    }),
  ).toBe(
    "\x1b]7577;pid=90412:time=1795543200:argv=cmVzdW1lLXdyYXA=,c3No,ZGV2Ym94:mac=e76149d0ba54a83570ffab0583867dacdfa23928ba9d18604f0badea88b62b65\x1b\\",
  );
});

test("rejects invalid argv[0], relative cwd, control characters and oversized reports", () => {
  expect(encodeResume({ pid: 1, time: 1, argv: ["./run.sh"], token: SPEC_TOKEN })).toBeNull();
  expect(encodeResume({ pid: 1, time: 1, argv: ["-flag"], token: SPEC_TOKEN })).toBeNull();
  expect(
    encodeResume({ pid: 1, time: 1, argv: ["claudesaurus"], cwd: "project", token: SPEC_TOKEN }),
  ).toBeNull();
  expect(
    encodeResume({ pid: 1, time: 1, argv: ["claudesaurus", "a\nb"], token: SPEC_TOKEN }),
  ).toBeNull();
  expect(
    encodeResume({
      pid: 1,
      time: 1,
      argv: ["claudesaurus"],
      cwd: "/tmp/a\x7fb",
      token: SPEC_TOKEN,
    }),
  ).toBeNull();
  expect(
    encodeResume({
      pid: 1,
      time: 1,
      argv: ["claudesaurus", ...Array.from({ length: 64 }, () => "x")],
      token: SPEC_TOKEN,
    }),
  ).toBeNull();
  expect(
    encodeResume({
      pid: 1,
      time: 1,
      argv: ["claudesaurus", "a".repeat(2000)],
      token: SPEC_TOKEN,
    }),
  ).toBeNull();
});

test("takeResumeToken reads and strips OSC7577_TOKEN from the environment", () => {
  const env: NodeJS.ProcessEnv = { [OSC7577_TOKEN_ENV]: SPEC_TOKEN, OTHER: "1" };
  expect(takeResumeToken(env)).toBe(SPEC_TOKEN);
  expect(OSC7577_TOKEN_ENV in env).toBe(false);
  expect(env.OTHER).toBe("1");
  expect(takeResumeToken(env)).toBeNull();
});

test("ownerPid and resumeCommand parse valid launcher environment values", () => {
  expect(ownerPid({ CLAUDESAURUS_OWNER_PID: "4242" })).toBe(4242);
  expect(ownerPid({ CLAUDESAURUS_OWNER_PID: "not-a-pid" })).toBe(process.pid);
  expect(
    resumeCommand({ CLAUDESAURUS_COMMAND: JSON.stringify(["/usr/local/bin/claudesaurus"]) }),
  ).toEqual(["/usr/local/bin/claudesaurus"]);
  expect(
    resumeCommand({ CLAUDESAURUS_COMMAND: JSON.stringify(["./bin/claudesaurus.mjs"]) }),
  ).toBeNull();
});

test("reporter is a no-op without a token and creates no files", () => {
  const dir = path.join(makeTempDir(), "resume");
  const written: string[] = [];
  const reporter = createResumeReporter({
    write: (sequence) => written.push(sequence),
    token: null,
    pid: 123,
    command: ["/opt/homebrew/opt/claudesaurus/bin/claudesaurus"],
    cwd: "/tmp",
    dir,
    id: "instance-1",
  });
  reporter.update({ version: 1, kind: "chat", agentId: "claude-acp", sessionId: "abc" });
  reporter.rereport();
  reporter.clear();
  expect(written).toEqual([]);
  expect(fs.existsSync(dir)).toBe(false);
});

test("reporter writes 0700/0600 state file, updates on change, rereports on SIGCONT and clears on quit", () => {
  const dir = path.join(makeTempDir(), "resume");
  const written: string[] = [];
  let timeMs = 1_795_543_200_000;
  const reporter = createResumeReporter({
    write: (sequence) => written.push(sequence),
    token: SPEC_TOKEN,
    pid: 74877,
    command: ["/opt/homebrew/opt/claudesaurus/bin/claudesaurus"],
    cwd: "/Users/test/project",
    dir,
    id: "inst-1",
    now: () => timeMs,
  });

  const file = path.join(dir, "inst-1.json");
  reporter.update({
    version: 1,
    kind: "chat",
    agentId: "claude-acp",
    sessionId: null,
    model: "opus",
  });
  expect(written).toHaveLength(1);
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
    version: 1,
    kind: "chat",
    agentId: "claude-acp",
    sessionId: null,
    model: "opus",
  });
  if (process.platform !== "win32") {
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  }

  reporter.update({
    version: 1,
    kind: "chat",
    agentId: "claude-acp",
    sessionId: null,
    model: "opus",
  });
  expect(written).toHaveLength(1);

  timeMs += 5000;
  reporter.update({
    version: 1,
    kind: "chat",
    agentId: "claude-acp",
    sessionId: "015d3962-6f9e-45c3-92bc-c7cef5068215",
  });
  expect(written).toHaveLength(2);
  expect(written[1]).toContain("time=1795543205:");
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
    version: 1,
    kind: "chat",
    agentId: "claude-acp",
    sessionId: "015d3962-6f9e-45c3-92bc-c7cef5068215",
  });

  timeMs += 10_000;
  reporter.rereport();
  expect(written).toHaveLength(3);
  expect(written[2]).toContain("time=1795543215:");

  timeMs += 1000;
  reporter.clear();
  expect(fs.existsSync(file)).toBe(false);
  expect(written).toHaveLength(4);
  expect(written[3]).toBe(encodeClearResume({ pid: 74877, time: 1795543216, token: SPEC_TOKEN }));
  reporter.rereport();
  expect(written).toHaveLength(4);
});

test("prunes resume state files older than 30 days and keeps newer ones", () => {
  const dir = makeTempDir();
  const nowMs = 1_795_543_200_000;
  const oldFile = path.join(dir, "old.json");
  const freshFile = path.join(dir, "fresh.json");
  const unrelated = path.join(dir, "notes.txt");
  fs.writeFileSync(oldFile, "{}");
  fs.writeFileSync(freshFile, "{}");
  fs.writeFileSync(unrelated, "keep");
  const staleSec = (nowMs - RESUME_FILE_MAX_AGE_MS - 60_000) / 1000;
  const freshSec = (nowMs - 60_000) / 1000;
  fs.utimesSync(oldFile, staleSec, staleSec);
  fs.utimesSync(freshFile, freshSec, freshSec);
  fs.utimesSync(unrelated, staleSec, staleSec);

  pruneResumeFiles(dir, nowMs);
  expect(fs.existsSync(oldFile)).toBe(false);
  expect(fs.existsSync(freshFile)).toBe(true);
  expect(fs.existsSync(unrelated)).toBe(true);
});

test("resolveResumeFileArgs expands chat, empty chat, PR and missing resume files", () => {
  const dir = makeTempDir();
  const chatFile = path.join(dir, "chat.json");
  fs.writeFileSync(
    chatFile,
    JSON.stringify({
      version: 1,
      kind: "chat",
      agentId: "codex-acp",
      sessionId: "ses-123",
      model: "ignored-when-resuming",
    }),
  );
  expect(resolveResumeFileArgs(["--resume-file", chatFile])).toEqual([
    "--agent",
    "codex-acp",
    "--resume",
    "ses-123",
  ]);

  const emptyChatFile = path.join(dir, "empty.json");
  fs.writeFileSync(
    emptyChatFile,
    JSON.stringify({
      version: 1,
      kind: "chat",
      agentId: "claude-acp",
      sessionId: null,
      model: "opus",
      effort: "high",
      mode: "plan",
    }),
  );
  expect(resolveResumeFileArgs([`--resume-file=${emptyChatFile}`])).toEqual([
    "--agent",
    "claude-acp",
    "--model",
    "opus",
    "--effort",
    "high",
    "--mode",
    "plan",
  ]);

  const prFile = path.join(dir, "pr.json");
  fs.writeFileSync(
    prFile,
    JSON.stringify({ version: 1, kind: "pr", target: "backyardbit/claudesaurus#42" }),
  );
  expect(resolveResumeFileArgs(["--resume-file", prFile])).toEqual([
    "pr",
    "backyardbit/claudesaurus#42",
  ]);

  expect(resolveResumeFileArgs(["--resume-file", path.join(dir, "missing.json")])).toEqual([]);
  const corrupt = path.join(dir, "corrupt.json");
  fs.writeFileSync(corrupt, "not json");
  expect(resolveResumeFileArgs(["--resume-file", corrupt])).toEqual([]);
});
