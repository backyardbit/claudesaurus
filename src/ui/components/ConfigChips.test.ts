import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { expect, test } from "vitest";
import { barConfigOptions, modelOptions, settingChoices } from "./ConfigChips";

function select(
  id: string,
  values: string[],
  category?: SessionConfigOption["category"],
): SessionConfigOption {
  return {
    id,
    name: id,
    category,
    type: "select",
    currentValue: values[0] ?? "",
    options: values.map((value) => ({ value, name: value })),
  };
}

function values(option: SessionConfigOption) {
  return settingChoices(option).map((choice) => choice.value);
}

test("shows on/off settings as off then on, however the adapter lists them", () => {
  expect(values(select("fast", ["off", "on"]))).toEqual(["off", "on"]);
  expect(values(select("ultracode", ["on", "off"]))).toEqual(["off", "on"]);
});

test("keeps the adapter's order for other settings", () => {
  expect(values(select("agent", ["default", "on", "off"]))).toEqual(["default", "on", "off"]);
});

test("places model options on the shelf and keeps effort, mode and other settings in the bar", () => {
  const model = select("model", ["sonnet", "opus"], "model");
  const mode = select("mode", ["default", "auto"], "mode");
  const effort = select("effort", ["low", "high"], "thought_level");
  const fast = select("fast", ["off", "on"]);

  expect(modelOptions([mode, model, effort, fast])).toEqual([model]);
  expect(barConfigOptions([mode, model, effort, fast])).toEqual({
    primary: [effort, mode],
    rest: [fast],
  });
});
