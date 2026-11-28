import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { PrBridge, PullRequestApi, PullRequestMethod } from "../../shared/pr";

declare global {
  interface Window {
    claudesaurusPr?: PrBridge;
  }
}

export function prBridge(): PrBridge {
  const bridge = window.claudesaurusPr;
  if (!bridge) throw new Error("The pull request viewer is not connected to Claudesaurus.");
  return bridge;
}

type Input<M extends PullRequestMethod> = Parameters<PullRequestApi[M]>[0];
type Output<M extends PullRequestMethod> = ReturnType<PullRequestApi[M]>;
type AnyOutput = Output<PullRequestMethod>;

export type CommandResult<A> = { _tag: "Success"; value: A } | { _tag: "Failure"; error: string };

function failureText(message: string) {
  return message.replace(/^(Error invoking remote method '[^']+': )?(Error: )?/, "");
}

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
  generation: number;
  listeners: Set<() => void>;
  read: () => Promise<AnyOutput>;
  snapshot: QueryView<AnyOutput>;
};

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

export type PrQuery<M extends PullRequestMethod> = { method: M; input: Input<M> };

export function prQuery<M extends PullRequestMethod>(method: M, { input }: { input: Input<M> }) {
  return { method, input } satisfies PrQuery<M>;
}

const IDLE: QueryView<never> = { data: null, error: null, isPending: false, refresh: () => {} };

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

export function refreshAllQueries() {
  for (const entry of entries.values()) void load(entry);
}

export function useRefreshOnFocus(refresh: () => void) {
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
}
