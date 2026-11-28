import { useSyncExternalStore } from "react";
import { resolveDiffThemeName } from "../lib/diffRendering";

function scheme(): "light" | "dark" {
  return document.documentElement.dataset.scheme === "dark" ? "dark" : "light";
}

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributeFilter: ["data-scheme"] });
  return () => observer.disconnect();
}

export function useTheme() {
  const resolvedTheme = useSyncExternalStore(subscribe, scheme);
  return { resolvedTheme, syntaxThemeName: resolveDiffThemeName(resolvedTheme) };
}
