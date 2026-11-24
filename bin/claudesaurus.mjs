#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installRexActions, removeRexActions } from "./rex-actions.mjs";
import {
  isInsideDir,
  isRuntimeReady,
  latestInstalledVersion,
  prepareRuntime,
  restartArgs,
  runtimeHome,
} from "./runtime.mjs";

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

const home = runtimeHome();
const inRuntimeHome = isInsideDir(appRoot, home);
// A source checkout has its dependencies beside it outside the user's runtime folder.
const fromSource = !inRuntimeHome && existsSync(path.join(appRoot, "node_modules"));
const packaged = !fromSource || process.env.CLAUDESAURUS_PACKAGED === "1";

// Packaged installs hand off to a newer version that auto-update already installed in the
// background, unless this run is setting up this install or removing Rex actions.
if (
  packaged &&
  !process.env.CLAUDESAURUS_DELEGATED &&
  !args.includes("--setup") &&
  !args.includes("--remove-rex-actions")
) {
  const newer = latestInstalledVersion(home, version);
  const newerBin = newer ? path.join(newer.root, "bin", "claudesaurus.mjs") : null;
  if (newerBin && existsSync(newerBin)) {
    const delegated = spawnSync(process.execPath, [newerBin, ...args], {
      stdio: "inherit",
      env: { ...process.env, CLAUDESAURUS_PACKAGED: "1", CLAUDESAURUS_DELEGATED: "1" },
    });
    process.exit(delegated.status ?? 1);
  }
}

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

function updateRexActions(sourceRoot) {
  if (!existsSync(path.join(sourceRoot, "rex", "claudesaurus.lua"))) return;
  // Every run keeps the Rex palette actions in step with this install. The Homebrew wrapper names
  // itself, which outlasts upgrades; a source checkout is started with node.
  try {
    const launcher = process.env.CLAUDESAURUS_LAUNCHER;
    installRexActions(
      sourceRoot,
      launcher ? [launcher] : [process.execPath, fileURLToPath(import.meta.url)],
    );
  } catch (error) {
    console.error(`claudesaurus: could not add the Rex palette actions: ${error.message}`);
  }
}

updateRexActions(appRoot);

// A packaged install fetches its runtime on first use; a delegated runtime folder already has it.
const initialRoot =
  fromSource || (inRuntimeHome && isRuntimeReady(appRoot))
    ? appRoot
    : prepareRuntime(appRoot, version);

if (args.includes("--setup")) {
  console.log(`Claudesaurus ${version} is ready in ${initialRoot}`);
  process.exit(0);
}

let currentRoot = initialRoot;
let currentVersion = version;
let currentArgs = args;

while (true) {
  const entry = path.join(currentRoot, "dist", "main.cjs");
  if (!existsSync(entry)) {
    console.error("claudesaurus: not built yet. Run `pnpm build` in the claudesaurus folder.");
    process.exit(1);
  }

  const require = createRequire(path.join(currentRoot, "bin", "claudesaurus.mjs"));
  const pixelBin = path.join(
    path.dirname(require.resolve("@zenbu-labs/pixel/package.json")),
    "dist",
    "bin.js",
  );
  const restartFile = path.join(os.tmpdir(), `claudesaurus-restart-${process.pid}.json`);
  rmSync(restartFile, { force: true });

  const result = spawnSync(process.execPath, [pixelBin, entry, "--", ...currentArgs], {
    stdio: "inherit",
    env: {
      ...process.env,
      CLAUDESAURUS_NODE: process.execPath,
      CLAUDESAURUS_VERSION: currentVersion,
      CLAUDESAURUS_PACKAGED: packaged ? "1" : "0",
      CLAUDESAURUS_RESTART_FILE: restartFile,
    },
  });

  if (!existsSync(restartFile)) {
    process.exit(result.status ?? 1);
  }

  let request = {};
  try {
    request = JSON.parse(readFileSync(restartFile, "utf8"));
  } catch {
    process.exit(result.status ?? 1);
  } finally {
    rmSync(restartFile, { force: true });
  }

  if (request.root && request.version && isRuntimeReady(request.root)) {
    currentRoot = request.root;
    currentVersion = request.version;
    updateRexActions(currentRoot);
  } else if (packaged) {
    const newer = latestInstalledVersion(runtimeHome(), currentVersion);
    if (newer) {
      currentRoot = newer.root;
      currentVersion = newer.version;
      updateRexActions(currentRoot);
    }
  }
  currentArgs = restartArgs(currentArgs, request);
}
