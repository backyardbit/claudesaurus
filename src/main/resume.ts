import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** Environment variable terminals set to indicate OSC 7577 support and authenticate reports. */
export const OSC7577_TOKEN_ENV = "OSC7577_TOKEN";

/** Minimum total sequence length every OSC 7577 terminal guarantees to accept. */
export const MAX_RESUME_BYTES = 2048;

/** Minimum argv element count every OSC 7577 terminal guarantees to accept. */
export const MAX_RESUME_ARGV = 64;

/** How long resume state files are kept after their last save or load. */
export const RESUME_FILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Control characters forbidden in decoded argv elements and cwd (U+0000–001F, U+007F–009F). */
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

/**
 * Whether `program` is a valid OSC 7577 `argv[0]`: an absolute path, or a bare command name that
 * does not start with `-` and contains no path separators. Relative paths are forbidden.
 */
function isValidProgram(program: string) {
  if (program.length === 0 || CONTROL_CHAR.test(program)) return false;
  if (path.isAbsolute(program)) return true;
  if (program.startsWith("-")) return false;
  return !program.includes("/") && !program.includes("\\");
}

function signBody(body: string, token: string) {
  return createHash("sha256").update(`${body}:${token}`, "utf8").digest("hex");
}

/**
 * Encodes a Program Resume Protocol report (OSC 7577). Returns null if the arguments break any
 * protocol rule or the finished sequence exceeds the 2048-byte minimum parser limit.
 * https://www.superlogical.com/rex/docs/build/program-resume
 */
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

/** Encodes a `clear=1` report, removing this process's resume record when the user quits. */
export function encodeClearResume(options: EncodeClearOptions): string | null {
  const { pid, time, token } = options;
  if (!token || !isPositiveInteger(pid) || !isPositiveInteger(time)) return null;
  const body = `pid=${pid}:time=${time}:clear=1`;
  const sequence = `\x1b]7577;${body}:mac=${signBody(body, token)}\x1b\\`;
  return Buffer.byteLength(sequence, "utf8") <= MAX_RESUME_BYTES ? sequence : null;
}

/**
 * Reads and immediately deletes `OSC7577_TOKEN` from `env` so child processes (agents, tools,
 * git/gh helpers) cannot inherit it and forge resume records.
 */
export function takeResumeToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env[OSC7577_TOKEN_ENV];
  delete env[OSC7577_TOKEN_ENV];
  return token && token.length > 0 ? token : null;
}

/** The owning process PID reported in OSC 7577: the outer launcher, or this process. */
export function ownerPid(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CLAUDESAURUS_OWNER_PID;
  if (raw && /^[1-9][0-9]*$/.test(raw)) {
    const parsed = Number(raw);
    if (isPositiveInteger(parsed)) return parsed;
  }
  return process.pid;
}

const CommandSchema = z.array(z.string().min(1)).min(1);

/** How to start this install of Claudesaurus again, as the launcher put it in the environment. */
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

/** Folder holding per-instance resume state files, readable only by this user. */
export function resumeStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const state = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "claudesaurus", "resume");
}

/** Writes a state file atomically inside a `0700` folder with `0600` permissions. */
export function writeResumeState(file: string, state: ResumeState) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best-effort on filesystems that do not support POSIX modes.
  }
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** Removes resume state files whose last save or load is older than `maxAgeMs`. */
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
    } catch {
      // Another instance may have removed it concurrently.
    }
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

/**
 * Maintains one per-instance resume state file and reports it to the terminal with OSC 7577.
 * Does nothing when the terminal did not provide `OSC7577_TOKEN` or no launch command is known.
 */
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
    // Keep timestamps monotonic per pid even if the clock steps back slightly between reports.
    const current = Math.floor(now() / 1000);
    lastTime = Math.max(lastTime, current);
    return lastTime;
  }

  function removeFile() {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Already gone.
    }
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
      // If the command can no longer be represented, clear any earlier record per spec.
      clearRecord();
      return;
    }
    reported = true;
    write(sequence);
  }

  return {
    /** Saves the latest resumable state and reports it when it changed. */
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
        // Without a saved state file, do not leave a stale resume record behind.
        clearRecord();
        return;
      }
      lastJson = json;
      sendCurrent();
    },
    /** Re-emits the current resume report with a fresh timestamp, e.g. on SIGCONT. */
    rereport() {
      if (!reported) return;
      sendCurrent();
    },
    /** Removes the state file and sends `clear=1`, for when the user intentionally quits. */
    clear() {
      clearRecord();
    },
  };
}
