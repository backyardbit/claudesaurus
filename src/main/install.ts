import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { BinaryTarget } from "./registry";

const run = promisify(execFile);

/** Written into an agent's folder once it is fully in place. */
const INSTALLED_MARKER = ".claudesaurus-installed";

/** The least change in download progress worth reporting, as a fraction. */
const PROGRESS_STEP = 0.05;

export type InstallProgress = (status: string) => void;

export async function sha256Of(file: string) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

/** Throws unless the file's SHA-256 is the expected one. Case does not matter. */
export async function verifySha256(file: string, expected: string) {
  const actual = await sha256Of(file);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`The download's SHA-256 is ${actual}, but the registry says ${expected}.`);
  }
}

/** How an archive is unpacked, by the end of its address: zip, tar, or a bare program. */
export function archiveKind(url: string) {
  const name = new URL(url).pathname.toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "tar.gz";
  if (name.endsWith(".tar.bz2") || name.endsWith(".tbz2")) return "tar.bz2";
  return "raw";
}

/**
 * Unpacks an archive into a folder with the system's own tools, which keep symlinks and file
 * modes: a signed macOS bundle whose symlinks became copies fails its signature check.
 */
export async function extractArchive(archive: string, kind: string, destination: string) {
  fs.mkdirSync(destination, { recursive: true });
  if (kind === "zip") {
    await run("unzip", ["-q", "-o", archive, "-d", destination]);
  } else if (kind === "tar.gz") {
    await run("tar", ["-xzf", archive, "-C", destination]);
  } else if (kind === "tar.bz2") {
    await run("tar", ["-xjf", archive, "-C", destination]);
  } else {
    throw new Error(`Unknown archive kind: ${kind}`);
  }
}

/** The path of the program an entry names, which must stay inside the agent's folder. */
export function commandPath(folder: string, cmd: string) {
  const resolved = path.resolve(folder, cmd);
  const relative = path.relative(folder, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`The agent's command ${cmd} is outside its folder.`);
  }
  return resolved;
}

async function download(url: string, file: string, progress: (fraction: number) => void) {
  const response = await fetch(url);
  const { body } = response;
  if (!response.ok || !body) throw new Error(`HTTP ${response.status} from ${url}`);
  const total = Number(response.headers.get("content-length")) || 0;
  async function* counted() {
    let received = 0;
    for await (const chunk of body ?? []) {
      received += chunk.length;
      if (total) progress(received / total);
      yield chunk;
    }
  }
  await pipeline(counted(), fs.createWriteStream(file));
}

/**
 * Puts an agent's binary release in `home/agents/ID/VERSION` and returns that folder. A version
 * already there is used as it is. The archive is checked against the registry's SHA-256, and
 * everything happens beside the final folder, which appears only once it is complete.
 */
export async function installBinary(
  home: string,
  agent: { id: string; name: string; version: string },
  target: BinaryTarget,
  report: InstallProgress,
) {
  const parent = path.join(home, "agents", agent.id);
  const folder = path.join(parent, agent.version);
  if (fs.existsSync(path.join(folder, INSTALLED_MARKER))) return folder;

  fs.mkdirSync(parent, { recursive: true });
  const staging = `${folder}.setup-${process.pid}`;
  const archive = `${staging}.download`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    const label = `Downloading ${agent.name} ${agent.version}`;
    report(`${label}…`);
    let shown = 0;
    await download(target.archive, archive, (fraction) => {
      if (fraction - shown < PROGRESS_STEP && (fraction < 1 || shown === 1)) return;
      shown = fraction;
      report(`${label}… ${Math.round(fraction * 100)}%`);
    });
    if (target.sha256) {
      report(`Checking ${agent.name}…`);
      await verifySha256(archive, target.sha256);
    }
    report(`Unpacking ${agent.name}…`);
    const kind = archiveKind(target.archive);
    if (kind === "raw") {
      fs.mkdirSync(staging, { recursive: true });
      const program = commandPath(staging, target.cmd);
      fs.mkdirSync(path.dirname(program), { recursive: true });
      fs.renameSync(archive, program);
      fs.chmodSync(program, 0o755);
    } else {
      await extractArchive(archive, kind, staging);
    }
    fs.writeFileSync(path.join(staging, INSTALLED_MARKER), `${target.archive}\n`);
    // Another pane may have finished the same install meanwhile; its copy is as good.
    if (fs.existsSync(path.join(folder, INSTALLED_MARKER))) return folder;
    fs.rmSync(folder, { recursive: true, force: true });
    fs.renameSync(staging, folder);
    return folder;
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
