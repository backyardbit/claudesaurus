import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { formatDuration } from "../format";
import { Markdown } from "./Markdown";

type ThoughtProps = { text: string; startedAt: number; endedAt: number | null; timed: boolean };

function thoughtLabel({ startedAt, endedAt, timed }: ThoughtProps) {
  if (endedAt === null) return "Thinking…";
  return timed ? `Thought for ${formatDuration(endedAt - startedAt)}` : "Thought";
}

export function Thought(props: ThoughtProps) {
  const { text } = props;
  const [open, setOpen] = useState(false);
  const label = thoughtLabel(props);
  return (
    <div className="thought">
      <button type="button" className="thought-row" onClick={() => setOpen(!open)}>
        {label} <ChevronRight size={13} className={`chevron ${open ? "open" : ""}`} />
      </button>
      {open && (
        <div className="thought-body">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}
