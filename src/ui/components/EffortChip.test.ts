import { expect, test } from "vitest";
import { effortColor } from "./EffortChip";

const VALUES = ["default", "low", "medium", "high", "xhigh", "max"];

function hue(index: number) {
  const color = effortColor(VALUES, index);
  return color === null ? null : Number(/ (\d+)\)$/.exec(color)?.[1]);
}

test("the default stop has no color", () => {
  expect(effortColor(VALUES, 0)).toBeNull();
});

test("runs from blue at the lowest effort to red at the highest", () => {
  expect(hue(1)).toBe(235);
  expect(hue(5)).toBe(25);
});

test("every step up is a warmer color", () => {
  const hues = [1, 2, 3, 4, 5].map(hue);
  expect(hues).toEqual([...hues].sort((a, b) => Number(b) - Number(a)));
  expect(new Set(hues).size).toBe(5);
});

test("a setting without a default stop uses the whole range", () => {
  expect(effortColor(["low", "high"], 0)).toBe("oklch(0.66 0.17 235)");
  expect(effortColor(["low", "high"], 1)).toBe("oklch(0.66 0.17 25)");
});
