import { useCallback, useEffect, useRef, useState } from "react";
import { writeTextToClipboard } from "../lib/links";

export function useCopyToClipboard({ timeout = 2000 }: { timeout?: number; target?: string } = {}) {
  const [isCopied, setIsCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyToClipboard = useCallback(
    (value: string) => {
      if (!value) return;
      writeTextToClipboard(value);
      if (timer.current) clearTimeout(timer.current);
      setIsCopied(true);
      timer.current = setTimeout(() => setIsCopied(false), timeout);
    },
    [timeout],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { copyToClipboard, isCopied };
}
