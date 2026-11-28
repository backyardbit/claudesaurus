import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { verifySha256 } from "./install";
import { cacheHome } from "./registry";

const run = promisify(execFile);

export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/backyardbit/claudesaurus/releases/latest";

const PNPM = "pnpm@9.15.4";

const INITIAL_DELAY_MS = 3000;

const POLL_INTERVAL_MS = 60_000;

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

const CHECK_TIMEOUT_MS = 8000;

const STALE_LOCK_MS = 15 * 60 * 1000;

const KEEP_VERSIONS = 2;

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export type ReleaseInfo = {
  version: string;
  url: string;
  sha256: string | null;
};

export type ReadyUpdate = {
  version: string;
  root: string;
};

const ReleaseAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string(),
  digest: z.string().nullable().optional(),
});

const GithubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(ReleaseAssetSchema),
});

const ReleaseInfoSchema = z.object({
  version: z.string().regex(SEMVER_RE),
  url: z.string(),
  sha256: z.string().nullable(),
});

const UpdateCacheSchema = z.object({
  checkedAt: z.number(),
  etag: z.string().nullable(),
  release: ReleaseInfoSchema.nullable(),
});

type UpdateCache = z.infer<typeof UpdateCacheSchema>;

const PackageVersionSchema = z.object({
  version: z.string(),
});

export function runtimeHome() {
  const data = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(data, "claudesaurus");
}

export function updateCacheFile() {
  return path.join(cacheHome(), "update-check.json");
}

export function isSemver(value: string) {
  return SEMVER_RE.test(value);
}

export function compareVersions(a: string, b: string) {
  const left = SEMVER_RE.exec(a);
  const right = SEMVER_RE.exec(b);
  if (!left || !right) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function parseLatestRelease(json: string): ReleaseInfo | null {
  let raw: z.input<typeof GithubReleaseSchema>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = GithubReleaseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { tag_name, draft, prerelease, assets } = parsed.data;
  if (draft || prerelease) return null;
  const version = tag_name.startsWith("v") ? tag_name.slice(1) : tag_name;
  if (!SEMVER_RE.test(version)) return null;
  const expectedAsset = `claudesaurus-${version}.tar.gz`;
  const asset = assets.find((candidate) => candidate.name === expectedAsset);
  if (!asset) return null;
  const sha256 = asset.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length) : null;
  return { version, url: asset.browser_download_url, sha256 };
}

export function electronIntact(root: string) {
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

export function isRuntimeReady(root: string, checkElectron = electronIntact) {
  return (
    fs.existsSync(path.join(root, "package.json")) &&
    fs.existsSync(path.join(root, "dist", "main.cjs")) &&
    checkElectron(root)
  );
}

export function latestInstalledVersion(
  home: string,
  afterVersion: string,
  checkElectron = electronIntact,
): ReadyUpdate | null {
  if (!fs.existsSync(home)) return null;
  let best: ReadyUpdate | null = null;
  for (const name of fs.readdirSync(home)) {
    if (!SEMVER_RE.test(name)) continue;
    if (compareVersions(name, afterVersion) <= 0) continue;
    if (best && compareVersions(name, best.version) <= 0) continue;
    const root = path.join(home, name);
    if (!isRuntimeReady(root, checkElectron)) continue;
    best = { version: name, root };
  }
  return best;
}

function readCache(file: string): UpdateCache | null {
  try {
    const parsed = UpdateCacheSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(file: string, cache: UpdateCache) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch {}
}

export type CheckReleaseOptions = {
  url: string;
  currentVersion: string;
  cacheFile: string;
  checkIntervalMs?: number;
  now?: () => number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
};

export async function checkLatestRelease(
  options: CheckReleaseOptions,
): Promise<ReleaseInfo | null> {
  const now = options.now ? options.now() : Date.now();
  const interval = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
  const cached = readCache(options.cacheFile);
  if (cached && now - cached.checkedAt < interval) {
    return cached.release;
  }

  const fetchFn = options.fetchFn ?? fetch;
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": `claudesaurus/${options.currentVersion}`,
  });
  if (cached?.etag) headers.set("If-None-Match", cached.etag);

  const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  try {
    const response = await fetchFn(options.url, { headers, signal });
    if (response.status === 304 && cached) {
      writeCache(options.cacheFile, { ...cached, checkedAt: now });
      return cached.release;
    }
    if (!response.ok) return cached?.release ?? null;
    const text = await response.text();
    const release = parseLatestRelease(text);
    const etag = response.headers.get("etag");
    writeCache(options.cacheFile, { checkedAt: now, etag, release });
    return release;
  } catch {
    return cached?.release ?? null;
  }
}

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = z.object({ code: z.string() }).safeParse(error);
    return code.success && code.data.code === "EPERM";
  }
}

function acquireLock(lockFile: string, now: number) {
  const tryCreate = () => {
    const fd = fs.openSync(lockFile, "wx");
    try {
      fs.writeFileSync(fd, `${process.pid}\n`);
    } finally {
      fs.closeSync(fd);
    }
  };
  try {
    tryCreate();
    return true;
  } catch (error) {
    const code = z.object({ code: z.string() }).safeParse(error);
    if (!code.success || code.data.code !== "EEXIST") return false;
  }

  try {
    const stat = fs.statSync(lockFile);
    const owner = Number.parseInt(fs.readFileSync(lockFile, "utf8").trim(), 10);
    const stale = now - stat.mtimeMs >= STALE_LOCK_MS || !isProcessAlive(owner);
    if (!stale) return false;
    fs.rmSync(lockFile, { force: true });
    tryCreate();
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(
  url: string,
  file: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
) {
  const response = await fetchFn(url, { signal });
  const { body } = response;
  if (!response.ok || !body) throw new Error(`HTTP ${response.status} from ${url}`);
  await pipeline(body, fs.createWriteStream(file), { signal });
}

function besideNode(nodePath: string, program: string) {
  const beside = path.join(path.dirname(nodePath), program);
  return path.isAbsolute(nodePath) && fs.existsSync(beside) ? beside : program;
}

function installRuntimeDependencies(staging: string, nodePath: string, signal?: AbortSignal) {
  const temporary = path.join(staging, ".tmp");
  fs.mkdirSync(temporary, { recursive: true });
  const nodeFolder = path.dirname(nodePath);
  const npx = besideNode(nodePath, "npx");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      npx,
      [
        "--yes",
        PNPM,
        "install",
        "--prod",
        "--frozen-lockfile",
        "--config.side-effects-cache=false",
      ],
      {
        cwd: staging,
        stdio: "ignore",
        env: {
          ...process.env,
          TMPDIR: temporary,
          PATH: `${nodeFolder}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (signal?.aborted) {
      child.kill("SIGTERM");
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("exit", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new Error(`pnpm exited with status ${code}`));
    });
  }).finally(() => {
    fs.rmSync(temporary, { recursive: true, force: true });
  });
}

function pruneOldVersions(home: string, currentVersion: string, now: number) {
  try {
    const entries = fs.readdirSync(home);
    const installed = entries
      .filter((name) => SEMVER_RE.test(name))
      .toSorted((left, right) => compareVersions(right, left));
    const keep = new Set([currentVersion, ...installed.slice(0, KEEP_VERSIONS)]);
    for (const name of entries) {
      if (keep.has(name)) continue;
      const entry = path.join(home, name);
      const unfinished = name.includes(".setup-") || name.endsWith(".lock");
      if (unfinished && now - fs.statSync(entry).mtimeMs < STALE_LOCK_MS) continue;
      fs.rmSync(entry, { recursive: true, force: true });
    }
  } catch {}
}

export type InstallUpdateOptions = {
  home: string;
  currentVersion: string;
  nodePath: string;
  signal?: AbortSignal;
  now?: () => number;
  fetchFn?: typeof fetch;
  installDependencies?: (staging: string, nodePath: string, signal?: AbortSignal) => Promise<void>;
  checkElectron?: (root: string) => boolean;
};

export async function installUpdate(
  release: ReleaseInfo,
  options: InstallUpdateOptions,
): Promise<ReadyUpdate | null> {
  const checkElectron = options.checkElectron ?? electronIntact;
  const ready = path.join(options.home, release.version);
  if (isRuntimeReady(ready, checkElectron)) {
    return { version: release.version, root: ready };
  }

  fs.mkdirSync(options.home, { recursive: true });
  const now = options.now ? options.now() : Date.now();
  const lockFile = path.join(options.home, `${release.version}.lock`);
  if (!acquireLock(lockFile, now)) return null;

  const staging = `${ready}.setup-${process.pid}`;
  const archive = `${staging}.tar.gz`;
  const fetchFn = options.fetchFn ?? fetch;
  const installDeps = options.installDependencies ?? installRuntimeDependencies;

  try {
    if (isRuntimeReady(ready, checkElectron)) {
      return { version: release.version, root: ready };
    }
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });

    await downloadFile(release.url, archive, fetchFn, options.signal);
    if (release.sha256) {
      await verifySha256(archive, release.sha256);
    }

    fs.mkdirSync(staging, { recursive: true });
    await run("tar", ["-xzf", archive, "--strip-components=1", "-C", staging]);

    const pkg = PackageVersionSchema.safeParse(
      JSON.parse(fs.readFileSync(path.join(staging, "package.json"), "utf8")),
    );
    if (!pkg.success || pkg.data.version !== release.version) {
      throw new Error(`Archive package.json version does not match ${release.version}.`);
    }
    if (!fs.existsSync(path.join(staging, "dist", "main.cjs"))) {
      throw new Error(`Archive for ${release.version} is missing dist/main.cjs.`);
    }

    await installDeps(staging, options.nodePath, options.signal);
    if (!isRuntimeReady(staging, checkElectron)) {
      throw new Error(`Installed runtime for ${release.version} failed verification.`);
    }

    try {
      fs.renameSync(staging, ready);
    } catch (error) {
      if (!isRuntimeReady(ready, checkElectron)) throw error;
    }

    pruneOldVersions(options.home, options.currentVersion, now);
    return { version: release.version, root: ready };
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(lockFile, { force: true });
  }
}

export type AutoUpdaterOptions = {
  currentVersion: string;
  nodePath: string;
  onUpdateReady(update: ReadyUpdate): void;
  releaseUrl?: string;
  home?: string;
  cacheFile?: string;
  initialDelayMs?: number;
  pollIntervalMs?: number;
  checkIntervalMs?: number;
  now?: () => number;
  fetchFn?: typeof fetch;
  installDependencies?: (staging: string, nodePath: string, signal?: AbortSignal) => Promise<void>;
  checkElectron?: (root: string) => boolean;
};

export function startAutoUpdater(options: AutoUpdaterOptions) {
  const home = options.home ?? runtimeHome();
  const cacheFile = options.cacheFile ?? updateCacheFile();
  const releaseUrl = options.releaseUrl ?? LATEST_RELEASE_URL;
  const initialDelayMs = options.initialDelayMs ?? INITIAL_DELAY_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const checkElectron = options.checkElectron ?? electronIntact;

  const controller = new AbortController();
  let stopped = false;
  let checking = false;
  let notifiedVersion = options.currentVersion;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function notify(update: ReadyUpdate) {
    if (stopped) return;
    if (compareVersions(update.version, notifiedVersion) <= 0) return;
    notifiedVersion = update.version;
    options.onUpdateReady(update);
  }

  async function tick() {
    if (stopped || checking) return;
    checking = true;
    try {
      const existing = latestInstalledVersion(home, notifiedVersion, checkElectron);
      if (existing) notify(existing);

      const release = await checkLatestRelease({
        url: releaseUrl,
        currentVersion: options.currentVersion,
        cacheFile,
        checkIntervalMs: options.checkIntervalMs,
        now: options.now,
        signal: controller.signal,
        fetchFn: options.fetchFn,
      });
      if (stopped || !release) return;
      if (compareVersions(release.version, notifiedVersion) <= 0) return;

      const installed = await installUpdate(release, {
        home,
        currentVersion: options.currentVersion,
        nodePath: options.nodePath,
        signal: controller.signal,
        now: options.now,
        fetchFn: options.fetchFn,
        installDependencies: options.installDependencies,
        checkElectron,
      });
      if (installed) notify(installed);
    } catch {
    } finally {
      checking = false;
      schedule(pollIntervalMs);
    }
  }

  function schedule(delayMs: number) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
    timer.unref();
  }

  if (isSemver(options.currentVersion)) {
    schedule(initialDelayMs);
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      controller.abort();
    },
  };
}
