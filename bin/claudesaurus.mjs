#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: claudesaurus [options]

Opens a graphical Claude Code chat in this terminal pane, working in the current directory.
The terminal must draw images with the Kitty graphics protocol, as Rex, Ghostty and kitty do.

options:
  --model NAME       start with this model, such as opus, sonnet or haiku
  --effort LEVEL     start with this effort: low, medium, high, xhigh or max
  --mode MODE        start in this permission mode: default, acceptEdits, plan, auto or
                     bypassPermissions
  --continue         reopen the latest session in this directory
  --resume ID        reopen the session with this id
  --version          print the version
  --help             print this help

examples:
  claudesaurus
  claudesaurus --model opus --effort high
  claudesaurus --continue
`;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (args.includes("--version")) {
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  console.log(version);
  process.exit(0);
}

const entry = path.join(root, "dist", "main.cjs");
if (!existsSync(entry)) {
  console.error("claudesaurus: not built yet. Run `pnpm build` in the claudesaurus folder.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pixelBin = path.join(
  path.dirname(require.resolve("@zenbu-labs/pixel/package.json")),
  "dist",
  "bin.js",
);

const result = spawnSync(process.execPath, [pixelBin, entry, "--", ...args], {
  stdio: "inherit",
  env: { ...process.env, CLAUDESAURUS_NODE: process.execPath },
});
process.exit(result.status ?? 1);
