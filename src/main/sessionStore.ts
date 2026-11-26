import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export type ContextUsage = { used: number; size: number };

/** What Claudesaurus remembers about a session it ran, by session id, and when it was last used. */
const StoredSchema = z.record(
  z.string(),
  z.object({
    /** The registry id of the agent the session belongs to; no other agent can open it. */
    agent: z.string().optional(),
    /** The agent's title for it, or else the first thing asked in it. */
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

/**
 * Remembers each session's agent, title and how full its context was. A session can only be
 * reopened by its own agent; some agents list sessions without a title or date; and Claude
 * reports context use only while a turn runs.
 */
export function createSessionStore(file = defaultFile()) {
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

  function get(sessionId: string): StoredSession | null {
    return mine[sessionId] ?? read(file)[sessionId] ?? null;
  }

  return {
    get,
    /** Records what is new about a session, keeping what was known of it before. */
    update(sessionId: string, change: Partial<Omit<StoredSession, "updatedAt">>) {
      mine[sessionId] = { ...get(sessionId), ...change, updatedAt: Date.now() };
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
