import { expect, test } from "vitest";
import { normalizeMath } from "./math";

test("leaves inline dollar math alone", () => {
  expect(normalizeMath("so $a^2 + b^2 = c^2$ holds")).toBe("so $a^2 + b^2 = c^2$ holds");
});

test("turns a one-line $$…$$ into a display block", () => {
  expect(normalizeMath("before\n$$x = 1$$\nafter")).toBe("before\n$$\nx = 1\n$$\nafter");
});

test("converts LaTeX bracket delimiters", () => {
  expect(normalizeMath("inline \\(x^2\\) here")).toBe("inline $x^2$ here");
  expect(normalizeMath("\\[ x = 1 \\]")).toBe("\n$$\nx = 1\n$$\n");
});

test("keeps amounts of money out of math", () => {
  expect(normalizeMath("it costs $5 and $10 a month")).toBe("it costs \\$5 and \\$10 a month");
  expect(normalizeMath("that was $0.04.")).toBe("that was \\$0.04.");
});

test("keeps math that starts with a number", () => {
  expect(normalizeMath("so $2 + 2 = 4$ then")).toBe("so $2 + 2 = 4$ then");
  expect(normalizeMath("exactly $5$ items")).toBe("exactly $5$ items");
});

test("does not touch code", () => {
  const fenced = "```sh\necho $5 \\(x\\)\n```";
  expect(normalizeMath(fenced)).toBe(fenced);
  expect(normalizeMath("run `echo $5 and $6` now")).toBe("run `echo $5 and $6` now");
});
