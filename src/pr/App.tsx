import { useEffect } from "react";
import type { PrContext } from "~/contracts";
import { PullRequestDetailPanel } from "./components/pullRequest/PullRequestDetailPanel";
import { AnchoredToastProvider, ToastProvider } from "./components/ui/toast";
import { prBridge } from "./lib/prApi";

export function App({ context }: { context: PrContext }) {
  const { reference } = context;
  useEffect(() => {
    document.title = `${reference.repository}#${reference.number}`;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "q") prBridge().quit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reference]);
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <PullRequestDetailPanel reference={reference} openedFromChat={context.openedFromChat} />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
