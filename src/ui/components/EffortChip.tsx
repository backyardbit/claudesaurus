import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { Brain, ChevronDown } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { choices } from "../configChoices";
import { useActions } from "../store";
import { Popover } from "./Popover";

/** How long the slider rests on a stop before the choice is sent, so a drag sends one change. */
const COMMIT_DELAY_MS = 250;

/** How long to wait for the adapter to confirm a change before showing its own value again. */
const CONFIRM_TIMEOUT_MS = 3000;

/** The hues the lowest and highest effort are drawn in: blue, through green and yellow, to red. */
const LOWEST_HUE = 235;
const HIGHEST_HUE = 25;

/** The stop that means "whatever the model's default is", which is not a place on the scale. */
const DEFAULT_VALUE = "default";

/**
 * The color of one stop, cooler for less effort and warmer for more.
 * Returns null for the default stop, which has no level to show.
 */
export function effortColor(values: string[], index: number) {
  const value = values[index];
  if (value === undefined || value === DEFAULT_VALUE) return null;
  const levels = values.filter((candidate) => candidate !== DEFAULT_VALUE);
  const fraction = levels.length > 1 ? levels.indexOf(value) / (levels.length - 1) : 1;
  const hue = LOWEST_HUE + (HIGHEST_HUE - LOWEST_HUE) * fraction;
  return `oklch(0.66 0.17 ${Math.round(hue)})`;
}

type EffortStyle = CSSProperties & Record<"--effort-color" | "--effort-fraction", string>;

/** Places a step's dot along the rail, as a fraction of the thumb's travel. */
type StopStyle = CSSProperties & Record<"--stop", string>;

/**
 * The effort setting as a pill that opens a slider with one stop per level. The pill and the
 * slider take the color of the chosen level.
 */
export function EffortChip({ option }: { option: SessionConfigOption }) {
  const actions = useActions();
  const levels = choices(option);
  const [open, setOpen] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const slider = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new option object is the adapter's answer
  useEffect(() => {
    if (timer.current === null) setDragged(null);
  }, [option]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (open) slider.current?.focus();
  }, [open]);

  const current = levels.findIndex((level) => level.value === option.currentValue);
  const index = dragged ?? Math.max(0, current);
  const level = levels[index];
  if (!level) return null;

  function showAdapterValue() {
    timer.current = null;
    setDragged(null);
  }

  function move(next: number) {
    setDragged(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const chosen = levels[next];
      if (!chosen || chosen.value === option.currentValue) {
        showAdapterValue();
        return;
      }
      actions.setConfig(option.id, chosen.value);
      timer.current = window.setTimeout(showAdapterValue, CONFIRM_TIMEOUT_MS);
    }, COMMIT_DELAY_MS);
  }

  const values = levels.map((candidate) => candidate.value);
  const fractionOf = (position: number) =>
    String(levels.length > 1 ? position / (levels.length - 1) : 1);
  const style: EffortStyle = {
    "--effort-color": effortColor(values, index) ?? "var(--faint)",
    "--effort-fraction": fractionOf(index),
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          className="chip effort-chip"
          title={option.name}
          style={style}
          onClick={() => setOpen(!open)}
        >
          <Brain size={13} />
          <span>{level.name}</span>
          <ChevronDown size={12} />
        </button>
      }
    >
      <div className="effort-panel" style={style}>
        <div className="effort-heading">
          <span>{option.name}</span>
          <span className="effort-name">{level.name}</span>
        </div>
        <div className="effort-slider">
          <div className="effort-rail">
            <div className="effort-fill" />
          </div>
          {levels.map((stop, position) => {
            const stopStyle: StopStyle = { "--stop": fractionOf(position) };
            return (
              <span
                key={stop.value}
                className={position < index ? "effort-dot passed" : "effort-dot"}
                style={stopStyle}
              />
            );
          })}
          <input
            ref={slider}
            type="range"
            min={0}
            max={levels.length - 1}
            step={1}
            value={index}
            aria-label={option.name}
            aria-valuetext={level.name}
            onChange={(event) => move(Number(event.target.value))}
          />
        </div>
      </div>
    </Popover>
  );
}
