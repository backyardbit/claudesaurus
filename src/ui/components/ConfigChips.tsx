import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  Check,
  ChevronDown,
  type LucideIcon,
  Shield,
  SlidersHorizontal,
  Sparkle,
} from "lucide-react";
import { useState } from "react";
import { choices } from "../configChoices";
import { useActions } from "../store";
import { EffortChip } from "./EffortChip";
import { Popover } from "./Popover";

/**
 * The adapter lists the two states of an on/off setting in no fixed order (fast mode is off/on,
 * ultracode on/off), so every such setting is shown as Off, then On.
 */
export function settingChoices(option: SessionConfigOption) {
  const listed = choices(option);
  const off = listed.find((choice) => choice.value === "off");
  const on = listed.find((choice) => choice.value === "on");
  return listed.length === 2 && off && on ? [off, on] : listed;
}

function currentName(option: SessionConfigOption) {
  if (option.type !== "select") return option.currentValue ? "On" : "Off";
  const current = choices(option).find((choice) => choice.value === option.currentValue);
  return current?.name ?? option.currentValue;
}

/** The icon on a setting's chip, by its ACP category. */
function chipIcon(category: SessionConfigOption["category"]): LucideIcon | undefined {
  switch (category) {
    case "model":
      return Sparkle;
    case "mode":
      return Shield;
    default:
      return undefined;
  }
}

/** The options that get their own chip, by ACP category, in display order. */
const PRIMARY_CATEGORIES = ["model", "thought_level", "mode"];

function SelectChip({ option }: { option: SessionConfigOption }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const Icon = chipIcon(option.category);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button type="button" className="chip" title={option.name} onClick={() => setOpen(!open)}>
          {Icon && <Icon size={13} />}
          <span>{currentName(option)}</span>
          <ChevronDown size={12} />
        </button>
      }
    >
      <div className="menu-title">{option.name}</div>
      <div className="menu">
        {choices(option).map((choice) => (
          <button
            type="button"
            key={choice.value}
            className="menu-item"
            onClick={() => {
              actions.setConfig(option.id, choice.value);
              setOpen(false);
            }}
          >
            <span className="menu-check">
              {option.currentValue === choice.value && <Check size={13} />}
            </span>
            <span>
              <span className="menu-name">{choice.name}</span>
              {choice.description && <span className="menu-description">{choice.description}</span>}
            </span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

function MoreSettings({ options }: { options: SessionConfigOption[] }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          className="chip icon-only"
          title="More settings"
          onClick={() => setOpen(!open)}
        >
          <SlidersHorizontal size={13} />
        </button>
      }
    >
      <div className="settings">
        {options.map((option) => (
          <div key={option.id} className="setting">
            <div className="setting-name">{option.name}</div>
            {option.type === "boolean" ? (
              <div className="segmented">
                {[false, true].map((value) => (
                  <button
                    type="button"
                    key={String(value)}
                    className={option.currentValue === value ? "active" : ""}
                    onClick={() => actions.setConfig(option.id, value)}
                  >
                    {value ? "On" : "Off"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="segmented wrap">
                {settingChoices(option).map((choice) => (
                  <button
                    type="button"
                    key={choice.value}
                    className={option.currentValue === choice.value ? "active" : ""}
                    onClick={() => actions.setConfig(option.id, choice.value)}
                  >
                    {choice.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Popover>
  );
}

export function ConfigChips({ options }: { options: SessionConfigOption[] }) {
  const primary = PRIMARY_CATEGORIES.flatMap((category) =>
    options.filter((option) => option.category === category && option.type === "select"),
  );
  const rest = options.filter((option) => !primary.includes(option));
  return (
    <>
      {primary.map((option) =>
        option.category === "thought_level" ? (
          <EffortChip key={option.id} option={option} />
        ) : (
          <SelectChip key={option.id} option={option} />
        ),
      )}
      {rest.length > 0 && <MoreSettings options={rest} />}
    </>
  );
}
