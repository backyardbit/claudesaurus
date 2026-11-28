import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export type ContextUsage = { used: number; size: number };

const StoredSchema = z.record(
  z.string(),
  z.object({
    agent: z.string().optional(),
    title: z.string().optional(),
    used: z.number().optional(),
    size: z.number().optional(),
    updatedAt: z.number(),
  }),
);

type Stored = z.infer<typeof StoredSchema>;
export type StoredSession = Stored[string];

const MAX_SESSIONS = 500;
const SAVE_DELAY_MS = 1000;

function defaultFile() {
  const state = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(state, "claudesaurus", "sessions.json");
}

function read(file: string): Stored {
  try {
    return StoredSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return {};
  }
}

export function createSessionStore(file = defaultFile()) {
  const mine: Stored = {};
  let timer: NodeJS.Timeout | null = null;

  function save() {
    timer = null;
    const merged = { ...read(file), ...mine };
    const newest = Object.entries(merged)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(newest)));
    fs.renameSync(temporary, file);
  }

  function get(sessionId: string): StoredSession | null {
    return mine[sessionId] ?? read(file)[sessionId] ?? null;
  }

  return {
    get,
    update(sessionId: string, change: Partial<Omit<StoredSession, "updatedAt">>) {
      mine[sessionId] = { ...get(sessionId), ...change, updatedAt: Date.now() };
      timer ??= setTimeout(save, SAVE_DELAY_MS);
    },
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      save();
    },
  };
}
