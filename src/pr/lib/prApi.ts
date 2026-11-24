import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { PrBridge, PullRequestApi, PullRequestMethod } from "../../shared/pr";

declare global {
  interface Window {
    claudesaurusPr?: PrBridge;
  }
}

/** The main process, which reads and writes GitHub for the page. */
export function prBridge(): PrBridge {
  const bridge = window.claudesaurusPr;
  if (!bridge) throw new Error("The pull request viewer is not connected to Claudesaurus.");
  return bridge;
}

type Input<M extends PullRequestMethod> = Parameters<PullRequestApi[M]>[0];
type Output<M extends PullRequestMethod> = ReturnType<PullRequestApi[M]>;
type AnyOutput = Output<PullRequestMethod>;

/** What a command answers: its value, or why it failed, in T3 Code's shape. */
export type CommandResult<A> = { _tag: "Success"; value: A } | { _tag: "Failure"; error: string };

/** A thrown error as a sentence: without Electron's note of where it crossed `invoke`. */
function failureText(message: string) {
  return message.replace(/^(Error invoking remote method '[^']+': )?(Error: )?/, "");
}

/**
 * Runs one GitHub command and says how it went instead of throwing. It takes `{ input }`, the
 * request shape the ported T3 Code components call their commands with.
 */
export function usePrCommand<M extends PullRequestMethod>(method: M) {
  return useCallback(
    async ({ input }: { input: Input<M> }): Promise<CommandResult<Output<M>>> => {
      try {
        return { _tag: "Success", value: await prBridge().call(method, input) };
      } catch (error) {
        return { _tag: "Failure", error: failureText(String(error)) };
      }
    },
    [method],
  );
}

export type QueryView<A> = {
  data: A | null;
  error: string | null;
  isPending: boolean;
  refresh: () => void;
};

type Entry = {
  /** Bumped by each read, so an older answer arriving late is dropped. */
  generation: number;
  listeners: Set<() => void>;
  read: () => Promise<AnyOutput>;
  snapshot: QueryView<AnyOutput>;
};

/** Reads shared by every component asking the same question, so one refresh updates them all. */
const entries = new Map<string, Entry>();

function publish(entry: Entry, change: Partial<QueryView<AnyOutput>>) {
  entry.snapshot = { ...entry.snapshot, ...change };
  for (const listener of entry.listeners) listener();
}

async function load(entry: Entry) {
  const generation = ++entry.generation;
  publish(entry, { isPending: true });
  try {
    const data = await entry.read();
    if (generation === entry.generation) publish(entry, { data, error: null, isPending: false });
  } catch (error) {
    if (generation === entry.generation) {
      publish(entry, { error: failureText(String(error)), isPending: false });
    }
  }
}

function entryFor(key: string, read: () => Promise<AnyOutput>) {
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: Entry = {
    generation: 0,
    listeners: new Set(),
    read,
    snapshot: { data: null, error: null, isPending: false, refresh: () => void load(entry) },
  };
  entries.set(key, entry);
  void load(entry);
  return entry;
}

/** One GitHub read, named by its method and input, for `usePrQuery`. */
export type PrQuery<M extends PullRequestMethod> = { method: M; input: Input<M> };

export function prQuery<M extends PullRequestMethod>(method: M, { input }: { input: Input<M> }) {
  return { method, input } satisfies PrQuery<M>;
}

const IDLE: QueryView<never> = { data: null, error: null, isPending: false, refresh: () => {} };

/** A GitHub read, kept and shared by its input; null reads nothing. */
export function usePrQuery<M extends PullRequestMethod>(
  query: PrQuery<M> | null,
): QueryView<Output<M>> {
  const entry =
    query === null
      ? null
      : entryFor(`${query.method}:${JSON.stringify(query.input)}`, () =>
          prBridge().call(query.method, query.input),
        );
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!entry) return () => {};
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [entry],
  );
  const view = useSyncExternalStore(subscribe, () => entry?.snapshot ?? IDLE);
  // SAFETY: entries are keyed by method, and an entry only ever holds what its own method's
  // read answered, so its data is that method's output.
  return view as QueryView<Output<M>>;
}

/** Reads every kept answer again, as the refresh button asks. */
export function refreshAllQueries() {
  for (const entry of entries.values()) void load(entry);
}

/** Calls `refresh` when the pane comes back into focus, so a long-open viewer stays current. */
export function useRefreshOnFocus(refresh: () => void) {
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
}
