import type { PlanEntry } from "@agentclientprotocol/sdk";
import { Circle, CircleCheck, CircleDashed } from "lucide-react";
import { useState } from "react";
import { Popover } from "./Popover";

function EntryIcon({ status }: { status: PlanEntry["status"] }) {
  if (status === "completed") return <CircleCheck size={14} className="plan-done" />;
  if (status === "in_progress") return <CircleDashed size={14} className="plan-active" />;
  return <Circle size={14} className="dim" />;
}

/** The current step of Claude's todo list, expanding to the whole list. */
export function PlanPill({ plan }: { plan: PlanEntry[] }) {
  const [open, setOpen] = useState(false);
  const done = plan.filter((entry) => entry.status === "completed").length;
  if (done === plan.length) return null;
  const current =
    plan.find((entry) => entry.status === "in_progress") ??
    plan.find((entry) => entry.status === "pending") ??
    plan.at(-1);
  if (!current) return null;
  return (
    <div className="plan-pill">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        trigger={
          <button type="button" className="chip plan" onClick={() => setOpen(!open)}>
            <EntryIcon status={current.status} />
            <span className="plan-current">{current.content}</span>
            <span className="dim">
              {done}/{plan.length}
            </span>
          </button>
        }
      >
        <div className="menu-title">Todo</div>
        <div className="plan-list">
          {plan.map((entry) => (
            <div key={entry.content} className={`plan-entry ${entry.status}`}>
              <EntryIcon status={entry.status} />
              <span>{entry.content}</span>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}
