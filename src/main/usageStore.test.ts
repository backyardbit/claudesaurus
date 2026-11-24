import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createUsageStore } from "./usageStore";

function temporaryFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "claudesaurus-")), "state", "usage.json");
}

test("a session's usage survives a restart", () => {
  const file = temporaryFile();
  const first = createUsageStore(file);
  first.set("a", { used: 10, size: 100 });
  expect(first.get("a")).toEqual({ used: 10, size: 100 });
  first.flush();
  expect(createUsageStore(file).get("a")).toEqual({ used: 10, size: 100 });
  expect(createUsageStore(file).get("unknown")).toBeNull();
});

test("two running copies keep each other's sessions", () => {
  const file = temporaryFile();
  const one = createUsageStore(file);
  const two = createUsageStore(file);
  one.set("a", { used: 1, size: 100 });
  two.set("b", { used: 2, size: 100 });
  one.flush();
  two.flush();
  const later = createUsageStore(file);
  expect(later.get("a")).toEqual({ used: 1, size: 100 });
  expect(later.get("b")).toEqual({ used: 2, size: 100 });
});
