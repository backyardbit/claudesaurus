import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export const PNPM = "pnpm@9.15.4";

const APP_FILES = ["package.json", "pnpm-lock.yaml", "patches", "bin", "dist", "rex"];

const STALE_SETUP_MS = 60 * 60 * 1000;

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

const KEEP_VERSIONS = 2;

export function runtimeHome() {
  const data = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(data, "claudesaurus");
}

export function compareVersions(a, b) {
  const left = SEMVER_RE.exec(a);
  const right = SEMVER_RE.exec(b);
  if (!left || !right) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isInsideDir(target, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function electronIntact(root) {
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

export function isRuntimeReady(root) {
  return (
    fs.existsSync(path.join(root, "package.json")) &&
    fs.existsSync(path.join(root, "dist", "main.cjs")) &&
    electronIntact(root)
  );
}

export function latestInstalledVersion(home, afterVersion) {
  if (!fs.existsSync(home)) return null;
  let best = null;
  for (const name of fs.readdirSync(home)) {
    if (!SEMVER_RE.test(name)) continue;
    if (afterVersion && compareVersions(name, afterVersion) <= 0) continue;
    if (best && compareVersions(name, best.version) <= 0) continue;
    const root = path.join(home, name);
    if (!isRuntimeReady(root)) continue;
    best = { version: name, root };
  }
  return best;
}

function removeOtherVersions(home, version) {
  const entries = fs.readdirSync(home);
  const installed = entries
    .filter((name) => SEMVER_RE.test(name))
    .sort((left, right) => compareVersions(right, left));
  const keep = new Set([version, ...installed.slice(0, KEEP_VERSIONS)]);
  for (const name of entries) {
    if (keep.has(name)) continue;
    const entry = path.join(home, name);
    const unfinished = name.includes(".setup-") || name.endsWith(".lock");
    if (unfinished && Date.now() - fs.statSync(entry).mtimeMs < STALE_SETUP_MS) continue;
    fs.rmSync(entry, { recursive: true, force: true });
  }
}

export function restartArgs(previousArgs, request) {
  const stripWithValue = new Set(["--resume", "--agent"]);
  const stripFlags = new Set(["--continue"]);
  if (request.sessionId) {
    stripWithValue.add("--model");
    stripWithValue.add("--effort");
    stripWithValue.add("--mode");
  }
  const kept = [];
  for (let index = 0; index < previousArgs.length; index += 1) {
    const arg = previousArgs[index];
    if (stripFlags.has(arg)) continue;
    if (stripWithValue.has(arg)) {
      index += 1;
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1 && stripWithValue.has(arg.slice(0, equals))) continue;
    kept.push(arg);
  }
  if (request.agentId) kept.push("--agent", request.agentId);
  if (request.sessionId) kept.push("--resume", request.sessionId);
  return kept;
}

export function envWithoutResumeToken(env = process.env) {
  const { OSC7577_TOKEN: _unused, ...clean } = env;
  return clean;
}

function nonEmptyString(value) {
  return String(value ?? "").length > 0 && value === String(value);
}

export function resolveResumeFileArgs(args) {
  let file = null;
  const remaining = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--resume-file") {
      file = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--resume-file=")) {
      file = arg.slice("--resume-file=".length);
      continue;
    }
    remaining.push(arg);
  }
  if (!file) return args;

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch {
    return remaining;
  }
  if (parsed?.version !== 1) return remaining;
  if (parsed.kind === "pr" && nonEmptyString(parsed.target)) {
    return ["pr", parsed.target, ...remaining];
  }
  if (parsed.kind === "chat" && nonEmptyString(parsed.agentId)) {
    const resolved = ["--agent", parsed.agentId];
    if (nonEmptyString(parsed.sessionId)) {
      resolved.push("--resume", parsed.sessionId);
    } else {
      if (nonEmptyString(parsed.model)) resolved.push("--model", parsed.model);
      if (nonEmptyString(parsed.effort)) resolved.push("--effort", parsed.effort);
      if (nonEmptyString(parsed.mode)) resolved.push("--mode", parsed.mode);
    }
    return [...resolved, ...remaining];
  }
  return remaining;
}

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
  const staging = `${ready}.setup-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of APP_FILES) {
    const source = path.join(appRoot, name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(staging, name), { recursive: true });
  }

  const temporary = path.join(staging, ".tmp");
  fs.mkdirSync(temporary);
  const nodeFolder = path.dirname(process.execPath);
  const npx = path.join(nodeFolder, "npx");
  const installed = spawnSync(
    fs.existsSync(npx) ? npx : "npx",
    ["--yes", PNPM, "install", "--prod", "--frozen-lockfile", "--config.side-effects-cache=false"],
    {
      cwd: staging,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...envWithoutResumeToken(process.env),
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

  if (existing) {
    try {
      fs.renameSync(ready, `${ready}.damaged-${process.pid}`);
    } catch {}
  }
  try {
    fs.renameSync(staging, ready);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!fs.existsSync(ready)) throw error;
  }
  removeOtherVersions(home, version);
  return ready;
}
