// Sets up the packaged app's runtime dependencies on first use.
//
// A package manager such as Homebrew installs only the built app. PixelGUI's Electron runtime and
// Claude Code's binary are signed programs that must stay exactly as published, and Homebrew
// rewrites and re-signs every program it installs. So they are downloaded here instead, into the
// user's data folder, the first time the app runs.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/** The pnpm that wrote the lockfile. Newer ones skip the install scripts of dependencies. */
const PNPM = "pnpm@9.15.4";

/** What `pnpm install` needs, and what then runs from the runtime folder. */
const APP_FILES = ["package.json", "pnpm-lock.yaml", "patches", "bin", "dist"];

/** How long an unfinished setup folder is left alone, in case another pane is still using it. */
const STALE_SETUP_MS = 60 * 60 * 1000;

export function runtimeHome() {
  const data = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(data, "claudesaurus");
}

/**
 * Whether the runtime's Electron is whole. On macOS the Electron framework is a bundle of
 * symlinks, and a copy that has them as plain files fails its signature check, so macOS refuses
 * to open it and calls it damaged. PixelGUI checks the same file to decide whether to install
 * Electron again.
 */
function electronIntact(root) {
  if (process.platform !== "darwin") return true;
  try {
    const pixel = path.dirname(
      createRequire(path.join(root, "package.json")).resolve("@zenbu-labs/pixel/package.json"),
    );
    const framework = path.join(
      pixel,
      "electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework",
    );
    return fs.lstatSync(path.join(framework, "Electron Framework")).isSymbolicLink();
  } catch {
    return false;
  }
}

function removeOtherVersions(home, version) {
  for (const name of fs.readdirSync(home)) {
    if (name === version) continue;
    const entry = path.join(home, name);
    const unfinished = name.includes(".setup-");
    if (unfinished && Date.now() - fs.statSync(entry).mtimeMs < STALE_SETUP_MS) continue;
    fs.rmSync(entry, { recursive: true, force: true });
  }
}

/**
 * Returns the folder to run the app from: a copy of the app with its dependencies installed.
 * Creates it if this version has not been set up yet, which needs the network.
 */
export function prepareRuntime(appRoot, version) {
  const home = runtimeHome();
  const ready = path.join(home, version);
  const existing = fs.existsSync(ready);
  if (existing && electronIntact(ready)) return ready;

  console.error(
    existing
      ? `The Claudesaurus ${version} runtime in ${home} has a damaged copy of Electron. Setting it up again, which takes about a minute.`
      : `Setting up Claudesaurus ${version} for first use. This downloads its runtime into ${home} and takes about a minute.`,
  );
  // Set up beside the final folder and rename at the end, so a setup that is interrupted, or two
  // panes that start at once, never leave a half-installed folder in its place.
  const staging = `${ready}.setup-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of APP_FILES) {
    fs.cpSync(path.join(appRoot, name), path.join(staging, name), { recursive: true });
  }

  // PixelGUI's install script moves Electron into place with a rename, which only works within
  // one volume, so its temporary files go inside the folder they end up in.
  const temporary = path.join(staging, ".tmp");
  fs.mkdirSync(temporary);
  const nodeFolder = path.dirname(process.execPath);
  const npx = path.join(nodeFolder, "npx");
  const installed = spawnSync(
    fs.existsSync(npx) ? npx : "npx",
    // pnpm's side-effects cache would put back PixelGUI as its install script last left it, from
    // a store that keeps no symlinks, and skip the script, which leaves Electron broken on macOS.
    ["--yes", PNPM, "install", "--prod", "--frozen-lockfile", "--config.side-effects-cache=false"],
    {
      cwd: staging,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        TMPDIR: temporary,
        PATH: `${nodeFolder}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  if (installed.status !== 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    const reason = installed.error?.message ?? `pnpm exited with status ${installed.status}`;
    console.error(`claudesaurus: setup failed (${reason}). Check the network and run it again.`);
    process.exit(1);
  }
  if (!electronIntact(staging)) {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error("claudesaurus: setup failed: Electron was installed without its symlinks.");
    process.exit(1);
  }
  fs.rmSync(temporary, { recursive: true, force: true });

  // A damaged runtime is moved aside rather than deleted first, so a failed setup never leaves
  // the folder missing; removeOtherVersions deletes it.
  if (existing) {
    try {
      fs.renameSync(ready, `${ready}.damaged-${process.pid}`);
    } catch {
      // Another pane moved it first.
    }
  }
  try {
    fs.renameSync(staging, ready);
  } catch (error) {
    // Another pane finished the same setup first.
    fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(ready)) throw error;
  }
  removeOtherVersions(home, version);
  return ready;
}
