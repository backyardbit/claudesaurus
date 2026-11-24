import { useWorkerPool, WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { type ReactNode, useEffect, useMemo } from "react";
import { useTheme } from "../hooks/useTheme";
import type { DiffThemeName } from "../lib/diffRendering";

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    void (async () => {
      try {
        const current = workerPool.getDiffRenderOptions();
        if (current.theme === themeName) return;
        await workerPool.setRenderOptions({ ...current, theme: themeName });
      } catch (cause) {
        console.error(`The diff worker could not switch to ${themeName}`, cause);
      }
    })();
  }, [themeName, workerPool]);

  return null;
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { syntaxThemeName } = useTheme();
  const workerPoolSize = useMemo(() => {
    const cores =
      typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
    return Math.max(2, Math.min(6, Math.floor(cores / 2)));
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new DiffsWorker(),
        poolSize: workerPoolSize,
        totalASTLRUCacheSize: 240,
      }}
      highlighterOptions={{
        theme: syntaxThemeName,
        tokenizeMaxLineLength: 1_000,
        useTokenTransformer: true,
      }}
    >
      <DiffWorkerThemeSync themeName={syntaxThemeName} />
      {children}
    </WorkerPoolContextProvider>
  );
}
