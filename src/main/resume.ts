import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const OSC7577_TOKEN_ENV = "OSC7577_TOKEN";

export const MAX_RESUME_BYTES = 2048;

export const MAX_RESUME_ARGV = 64;

export const RESUME_FILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const CONTROL_CHAR = /\p{Cc}/u;

const ResumeChatSchema = z.object({
  version: z.literal(1),
  kind: z.literal("chat"),
  agentId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
});

const ResumePullRequestSchema = z.object({
  version: z.literal(1),
  kind: z.literal("pr"),
  target: z.string().min(1),
});

export const ResumeStateSchema = z.discriminatedUnion("kind", [
  ResumeChatSchema,
  ResumePullRequestSchema,
]);

export type ResumeState = z.infer<typeof ResumeStateSchema>;

export type EncodeResumeOptions = {
  pid: number;
  time: number;
  argv: readonly string[];
  cwd?: string;
  token: string;
};

export type EncodeClearOptions = {
  pid: number;
  time: number;
  token: string;
};

function isPositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidProgram(program: string) {
  if (program.length === 0 || CONTROL_CHAR.test(program)) return false;
  if (path.isAbsolute(program)) return true;
  if (program.startsWith("-")) return false;
  return !program.includes("/") && !program.includes("\\");
}

function signBody(body: string, token: string) {
  return createHash("sha256").update(`${body}:${token}`, "utf8").digest("hex");
}

export function encodeResume(options: EncodeResumeOptions): string | null {
  const { pid, time, argv, cwd, token } = options;
  if (!token || !isPositiveInteger(pid) || !isPositiveInteger(time)) return null;
  if (argv.length === 0 || argv.length > MAX_RESUME_ARGV) return null;
  const program = argv[0];
  if (program === undefined || !isValidProgram(program)) return null;
  for (const arg of argv) {
    if (CONTROL_CHAR.test(arg)) return null;
  }
  if (cwd !== undefined && (!path.isAbsolute(cwd) || CONTROL_CHAR.test(cwd))) return null;

  const encodedArgv = argv.map((arg) => Buffer.from(arg, "utf8").toString("base64")).join(",");
  const pairs = [`pid=${pid}`, `time=${time}`, `argv=${encodedArgv}`];
  if (cwd !== undefined) pairs.push(`cwd=${Buffer.from(cwd, "utf8").toString("base64")}`);

  const body = pairs.join(":");
  const sequence = `\x1b]7577;${body}:mac=${signBody(body, token)}\x1b\\`;
  return Buffer.byteLength(sequence, "utf8") <= MAX_RESUME_BYTES ? sequence : null;
}

export function encodeClearResume(options: EncodeClearOptions): string | null {
  const { pid, time, token } = options;
  if (!token || !isPositiveInteger(pid) || !isPositiveInteger(time)) return null;
  const body = `pid=${pid}:time=${time}:clear=1`;
  const sequence = `\x1b]7577;${body}:mac=${signBody(body, token)}\x1b\\`;
  return Buffer.byteLength(sequence, "utf8") <= MAX_RESUME_BYTES ? sequence : null;
}

export function takeResumeToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env[OSC7577_TOKEN_ENV];
  delete env[OSC7577_TOKEN_ENV];
  return token && token.length > 0 ? token : null;
}

export function ownerPid(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CLAUDESAURUS_OWNER_PID;
  if (raw && /^[1-9][0-9]*$/.test(raw)) {
    const parsed = Number(raw);
    if (isPositiveInteger(parsed)) return parsed;
  }
  return process.pid;
}

const CommandSchema = z.array(z.string().min(1)).min(1);

export function resumeCommand(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.CLAUDESAURUS_COMMAND;
  if (!raw) return null;
  try {
    const parsed = CommandSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const program = parsed.data[0];
    return program !== undefined && isValidProgram(program) ? parsed.data : null;
  } catch {
    return null;
  }
}

export function resumeStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const state = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "claudesaurus", "resume");
}

export function writeResumeState(file: string, state: ResumeState) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function pruneResumeFiles(
  dir: string,
  nowMs = Date.now(),
  maxAgeMs = RESUME_FILE_MAX_AGE_MS,
) {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const entry = path.join(dir, name);
    try {
      const stat = fs.statSync(entry);
      if (stat.isFile() && nowMs - stat.mtimeMs > maxAgeMs) fs.rmSync(entry, { force: true });
    } catch {}
  }
}

type Clock = () => number;

export type ResumeReporterOptions = {
  write: (sequence: string) => void;
  token: string | null;
  pid: number;
  command: readonly string[] | null;
  cwd: string;
  dir?: string;
  id?: string;
  now?: Clock;
};

export function createResumeReporter(options: ResumeReporterOptions) {
  const { write, token, pid, command, cwd } = options;
  if (!token || !command || command.length === 0) {
    return {
      update(_state: ResumeState) {},
      rereport() {},
      clear() {},
    };
  }

  const activeToken = token;
  const activeCommand = command;
  const dir = options.dir ?? resumeStateDir();
  const file = path.join(dir, `${options.id ?? randomUUID()}.json`);
  const now = options.now ?? Date.now;
  let pruned = false;
  let reported = false;
  let lastJson: string | null = null;
  let lastTime = 0;

  function timestamp() {
    const current = Math.floor(now() / 1000);
    lastTime = Math.max(lastTime, current);
    return lastTime;
  }

  function removeFile() {
    try {
      fs.rmSync(file, { force: true });
    } catch {}
  }

  function clearRecord() {
    removeFile();
    if (!reported) return;
    reported = false;
    lastJson = null;
    const sequence = encodeClearResume({ pid, time: timestamp(), token: activeToken });
    if (sequence) write(sequence);
  }

  function sendCurrent() {
    const sequence = encodeResume({
      pid,
      time: timestamp(),
      argv: [...activeCommand, "--resume-file", file],
      cwd,
      token: activeToken,
    });
    if (!sequence) {
      clearRecord();
      return;
    }
    reported = true;
    write(sequence);
  }

  return {
    update(state: ResumeState) {
      const json = JSON.stringify(state);
      if (json === lastJson && reported) return;
      if (!pruned) {
        pruned = true;
        pruneResumeFiles(dir, now());
      }
      try {
        writeResumeState(file, state);
      } catch {
        clearRecord();
        return;
      }
      lastJson = json;
      sendCurrent();
    },
    rereport() {
      if (!reported) return;
      sendCurrent();
    },
    clear() {
      clearRecord();
    },
  };
}
