import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { BinaryTarget } from "./registry";

const run = promisify(execFile);

const INSTALLED_MARKER = ".claudesaurus-installed";

const PROGRESS_STEP = 0.05;

export type InstallProgress = (status: string) => void;

export async function sha256Of(file: string) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

export async function verifySha256(file: string, expected: string) {
  const actual = await sha256Of(file);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`The download's SHA-256 is ${actual}, but the registry says ${expected}.`);
  }
}

export function archiveKind(url: string) {
  const name = new URL(url).pathname.toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "tar.gz";
  if (name.endsWith(".tar.bz2") || name.endsWith(".tbz2")) return "tar.bz2";
  return "raw";
}

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
    if (fs.existsSync(path.join(folder, INSTALLED_MARKER))) return folder;
    fs.rmSync(folder, { recursive: true, force: true });
    fs.renameSync(staging, folder);
    return folder;
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
