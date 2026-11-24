import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { expect, test } from "vitest";
import { settingChoices } from "./ConfigChips";

function select(id: string, values: string[]): SessionConfigOption {
  return {
    id,
    name: id,
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
