import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ContextUsage = { used: number; size: number };

type Stored = Record<string, ContextUsage & { updatedAt: number }>;

const MAX_SESSIONS = 200;
const SAVE_DELAY_MS = 1000;

function defaultFile() {
  const state = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(state, "claudesaurus", "usage.json");
}

function read(file: string): Stored {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Stored;
  } catch {
    return {};
  }
}

/**
 * Remembers how full each session's context was. Claude reports that only while a turn runs, so
 * without this a reopened session shows no figure until its next reply.
 */
export function createUsageStore(file = defaultFile()) {
  const mine: Stored = {};
  let timer: NodeJS.Timeout | null = null;

  function save() {
    timer = null;
    // Other running copies save to the same file, so their sessions are kept.
    const merged = { ...read(file), ...mine };
    const newest = Object.entries(merged)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(newest)));
    fs.renameSync(temporary, file);
  }

  return {
    get(sessionId: string): ContextUsage | null {
      const found = mine[sessionId] ?? read(file)[sessionId];
      return found ? { used: found.used, size: found.size } : null;
    },
    set(sessionId: string, usage: ContextUsage) {
      mine[sessionId] = { ...usage, updatedAt: Date.now() };
      timer ??= setTimeout(save, SAVE_DELAY_MS);
    },
    /** Writes anything not saved yet, for when the app is about to exit. */
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      save();
    },
  };
}
