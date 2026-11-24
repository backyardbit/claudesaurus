#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installRexActions, removeRexActions } from "./rex-actions.mjs";
import { prepareRuntime } from "./runtime.mjs";

const USAGE = `usage: claudesaurus [options]

Opens a graphical Claude Code chat in this terminal pane, working in the current directory.
The terminal must draw images with the Kitty graphics protocol, as Rex, Ghostty and kitty do.

options:
  --agent NAME       chat with another agent from the ACP registry for this run: codex, grok,
                     antigravity, or a registry id. /agent in the chat switches for good
  --model NAME       start with this model, such as opus, sonnet or haiku
  --effort LEVEL     start with this effort: low, medium, high, xhigh or max
  --mode MODE        start in this permission mode: default, acceptEdits, plan, auto or
                     bypassPermissions
  --continue         reopen the latest session in this directory
  --resume ID        reopen the session with this id
  --setup            download what the app needs now, without opening a chat
  --remove-rex-actions
                     take the Claudesaurus split actions out of Rex's command palette
  --version          print the version
  --help             print this help

examples:
  claudesaurus
  claudesaurus --model opus --effort high
  claudesaurus --continue
  claudesaurus --agent codex
`;

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8"));
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (args.includes("--version")) {
  console.log(version);
  process.exit(0);
}

if (args.includes("--remove-rex-actions")) {
  removeRexActions();
  console.log("Removed the Claudesaurus actions from Rex's command palette.");
  process.exit(0);
}

// Every run keeps the Rex palette actions in step with this install. The Homebrew wrapper names
// itself, which outlasts upgrades; a source checkout is started with node.
try {
  const launcher = process.env.CLAUDESAURUS_LAUNCHER;
  installRexActions(
    appRoot,
    launcher ? [launcher] : [process.execPath, fileURLToPath(import.meta.url)],
  );
} catch (error) {
  console.error(`claudesaurus: could not add the Rex palette actions: ${error.message}`);
}

// A source checkout has its dependencies beside it. A packaged install fetches them on first use.
const fromSource = existsSync(path.join(appRoot, "node_modules"));
const root = fromSource ? appRoot : prepareRuntime(appRoot, version);

if (args.includes("--setup")) {
  console.log(`Claudesaurus ${version} is ready in ${root}`);
  process.exit(0);
}

const entry = path.join(root, "dist", "main.cjs");
if (!existsSync(entry)) {
  console.error("claudesaurus: not built yet. Run `pnpm build` in the claudesaurus folder.");
  process.exit(1);
}

const require = createRequire(path.join(root, "bin", "claudesaurus.mjs"));
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
