import { type CSSProperties, useState } from "react";
import { formatTokens } from "../format";
import { useAppState } from "../store";
import { Popover } from "./Popover";

/** From this share of the context on, the chip turns yellow, and from the second, red. */
const WARN_AT = 0.75;
const FULL_AT = 0.9;

type ContextStyle = CSSProperties & Record<"--context-color" | "--context-fraction", string>;

function contextColor(fraction: number) {
  if (fraction >= FULL_AT) return "var(--red)";
  if (fraction >= WARN_AT) return "var(--yellow)";
  return "var(--muted)";
}

/** A ring that fills clockwise from the top as the context fills. */
function Ring({ fraction }: { fraction: number | null }) {
  return (
    <svg className="context-ring" viewBox="0 0 16 16" width={15} height={15} aria-hidden>
      <circle className="context-ring-track" cx={8} cy={8} r={6.25} pathLength={100} />
      {fraction !== null && fraction > 0 && (
        <circle
          className="context-ring-fill"
          cx={8}
          cy={8}
          r={6.25}
          pathLength={100}
          strokeDasharray={`${Math.max(fraction * 100, 2)} 100`}
        />
      )}
    </svg>
  );
}

/**
 * How full the agent's context is, as a ring in the composer that opens the figures. The figures
 * are unknown until the agent reports them in a turn.
 */
export function ContextChip() {
  const usage = useAppState((state) => state.usage);
  const agentName = useAppState((state) => state.agent?.name ?? "the agent");
  const [open, setOpen] = useState(false);
  const known = usage !== null && usage.size > 0;
  const fraction = known ? Math.min(1, usage.used / usage.size) : null;
  const percent = fraction === null ? null : Math.round(fraction * 100);
  const style: ContextStyle = {
    "--context-color": contextColor(fraction ?? 0),
    "--context-fraction": String(fraction ?? 0),
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      trigger={
        <button
          type="button"
          className={percent === null ? "chip context-chip icon-only" : "chip context-chip"}
          style={style}
          onClick={() => setOpen(!open)}
        >
          <Ring fraction={fraction} />
          {percent !== null && <span className="context-percent">{percent}%</span>}
        </button>
      }
    >
      <div className="context-panel" style={style}>
        <div className="context-heading">
          <span>Context window</span>
          {percent !== null && <span className="context-percent-strong">{percent}% full</span>}
        </div>
        <div className="context-meter">
          <div className="context-meter-fill" />
        </div>
        {known ? (
          <div className="context-figures">
            <span>
              <strong>{formatTokens(usage.used)}</strong> used
            </span>
            <span>
              {formatTokens(Math.max(0, usage.size - usage.used))} left of{" "}
              {formatTokens(usage.size)}
            </span>
          </div>
        ) : (
          <div className="context-figures">Shows after {agentName}'s next reply</div>
        )}
      </div>
    </Popover>
  );
}
