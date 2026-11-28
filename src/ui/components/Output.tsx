import { ChevronDown } from "lucide-react";
import { useState } from "react";

const COLLAPSED_LINES = 8;

export function Output({ text, tone = "normal" }: { text: string; tone?: "normal" | "error" }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.replace(/\n$/, "").split("\n");
  const visible = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
  const hidden = lines.length - visible.length;
  return (
    <div className={`card output ${tone}`}>
      <pre>{visible.join("\n")}</pre>
      {hidden > 0 && (
        <button type="button" className="more" onClick={() => setExpanded(true)}>
          {hidden} more {hidden === 1 ? "line" : "lines"} <ChevronDown size={13} />
        </button>
      )}
    </div>
  );
}
