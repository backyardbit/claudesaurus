import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { restartArgs } from "../../bin/runtime.mjs";
import {
  checkLatestRelease,
  compareVersions,
  installUpdate,
  isSemver,
  latestInstalledVersion,
  parseLatestRelease,
  type ReadyUpdate,
  startAutoUpdater,
} from "./updater";

const temps: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claudesaurus-updater-test-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Builds a release-shaped `.tar.gz` archive containing `claudesaurus-<version>/...`. */
function makeReleaseArchive(dir: string, version: string, pkgVersion = version) {
  const name = `claudesaurus-${version}`;
  const src = path.join(dir, name);
  fs.mkdirSync(path.join(src, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(src, "package.json"),
    JSON.stringify({ name: "claudesaurus", version: pkgVersion }),
  );
  fs.writeFileSync(path.join(src, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.writeFileSync(path.join(src, "dist", "main.cjs"), "// built\n");
  const archive = path.join(dir, `${name}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", dir, name]);
  const bytes = fs.readFileSync(archive);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { archive, bytes, sha256 };
}

function makeInstalledVersion(home: string, version: string) {
  const root = path.join(home, version);
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
  fs.writeFileSync(path.join(root, "dist", "main.cjs"), "// built\n");
  return root;
}

test("compares plain semver strings and rejects unsafe folder names", () => {
  expect(isSemver("0.3.1")).toBe(true);
  expect(isSemver("v0.3.1")).toBe(false);
  expect(isSemver("../0.3.1")).toBe(false);
  expect(compareVersions("0.3.1", "0.3.0")).toBeGreaterThan(0);
  expect(compareVersions("0.10.0", "0.3.9")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
  expect(compareVersions("0.2.9", "0.3.0")).toBeLessThan(0);
});

test("parses GitHub latest release metadata and ignores drafts, prereleases or missing assets", () => {
  const valid = JSON.stringify({
    tag_name: "v0.4.0",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "claudesaurus-0.4.0.tar.gz",
        browser_download_url: "https://example.test/claudesaurus-0.4.0.tar.gz",
        digest: "sha256:abcdef0123456789",
      },
    ],
  });
  expect(parseLatestRelease(valid)).toEqual({
    version: "0.4.0",
    url: "https://example.test/claudesaurus-0.4.0.tar.gz",
    sha256: "abcdef0123456789",
  });

  expect(
    parseLatestRelease(
      JSON.stringify({
        tag_name: "v0.4.0",
        prerelease: true,
        assets: [
          {
            name: "claudesaurus-0.4.0.tar.gz",
            browser_download_url: "https://example.test/claudesaurus-0.4.0.tar.gz",
          },
        ],
      }),
    ),
  ).toBeNull();

  expect(
    parseLatestRelease(
      JSON.stringify({
        tag_name: "v0.4.0",
        assets: [
          { name: "other.tar.gz", browser_download_url: "https://example.test/other.tar.gz" },
        ],
      }),
    ),
  ).toBeNull();

  expect(parseLatestRelease("not json")).toBeNull();
});

test("shares update checks via disk cache and ETag 304 without burning rate limit", async () => {
  const dir = makeTempDir();
  const cacheFile = path.join(dir, "update-check.json");
  let calls = 0;
  let lastIfNoneMatch: string | null = null;
  let currentTime = 1_000_000;

  const fetchFn: typeof fetch = async (_input, init) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    lastIfNoneMatch = headers.get("if-none-match");
    if (lastIfNoneMatch === '"etag-1"') {
      return new Response(null, { status: 304 });
    }
    return new Response(
      JSON.stringify({
        tag_name: "v0.3.1",
        assets: [
          {
            name: "claudesaurus-0.3.1.tar.gz",
            browser_download_url: "https://example.test/claudesaurus-0.3.1.tar.gz",
            digest: "sha256:1234",
          },
        ],
      }),
      { status: 200, headers: { etag: '"etag-1"' } },
    );
  };

  const first = await checkLatestRelease({
    url: "https://example.test/latest",
    currentVersion: "0.3.0",
    cacheFile,
    checkIntervalMs: 60_000,
    now: () => currentTime,
    fetchFn,
  });
  expect(first?.version).toBe("0.3.1");
  expect(calls).toBe(1);

  // Within the interval, a second instance reads the disk cache and makes no network request.
  currentTime += 10_000;
  const cached = await checkLatestRelease({
    url: "https://example.test/latest",
    currentVersion: "0.3.0",
    cacheFile,
    checkIntervalMs: 60_000,
    now: () => currentTime,
    fetchFn,
  });
  expect(cached?.version).toBe("0.3.1");
  expect(calls).toBe(1);

  // After the interval expires, sends If-None-Match and keeps the cached release on 304.
  currentTime += 60_000;
  const revalidated = await checkLatestRelease({
    url: "https://example.test/latest",
    currentVersion: "0.3.0",
    cacheFile,
    checkIntervalMs: 60_000,
    now: () => currentTime,
    fetchFn,
  });
  expect(revalidated?.version).toBe("0.3.1");
  expect(calls).toBe(2);
  expect(lastIfNoneMatch).toBe('"etag-1"');
});

test("downloads, verifies SHA-256, extracts, installs, and keeps the running version", async () => {
  const dir = makeTempDir();
  const home = path.join(dir, "runtime");
  makeInstalledVersion(home, "0.2.0");
  makeInstalledVersion(home, "0.3.0");
  const { bytes, sha256 } = makeReleaseArchive(dir, "0.3.1");

  let installedIn: string | null = null;
  const fetchFn: typeof fetch = async () => new Response(bytes, { status: 200 });

  const result = await installUpdate(
    { version: "0.3.1", url: "https://example.test/claudesaurus-0.3.1.tar.gz", sha256 },
    {
      home,
      currentVersion: "0.3.0",
      nodePath: process.execPath,
      fetchFn,
      checkElectron: () => true,
      installDependencies: async (staging) => {
        installedIn = staging;
      },
    },
  );

  expect(result).toEqual({ version: "0.3.1", root: path.join(home, "0.3.1") });
  expect(installedIn).not.toBeNull();
  expect(fs.existsSync(path.join(home, "0.3.1", "dist", "main.cjs"))).toBe(true);
  // Running version 0.3.0 stays untouched; older 0.2.0 is pruned.
  expect(fs.existsSync(path.join(home, "0.3.0"))).toBe(true);
  expect(fs.existsSync(path.join(home, "0.2.0"))).toBe(false);
  expect(latestInstalledVersion(home, "0.3.0", () => true)).toEqual(result);
});

test("rejects archives whose SHA-256 or package.json version does not match", async () => {
  const dir = makeTempDir();
  const home = path.join(dir, "runtime");
  const { bytes, sha256 } = makeReleaseArchive(dir, "0.3.1", "0.3.0");
  const fetchFn: typeof fetch = async () => new Response(bytes, { status: 200 });

  await expect(
    installUpdate(
      { version: "0.3.1", url: "https://example.test/bad.tar.gz", sha256: "0".repeat(64) },
      {
        home,
        currentVersion: "0.3.0",
        nodePath: process.execPath,
        fetchFn,
        checkElectron: () => true,
        installDependencies: async () => {},
      },
    ),
  ).rejects.toThrow("SHA-256");

  await expect(
    installUpdate(
      { version: "0.3.1", url: "https://example.test/mismatch.tar.gz", sha256 },
      {
        home,
        currentVersion: "0.3.0",
        nodePath: process.execPath,
        fetchFn,
        checkElectron: () => true,
        installDependencies: async () => {},
      },
    ),
  ).rejects.toThrow("package.json version");
  expect(fs.existsSync(path.join(home, "0.3.1"))).toBe(false);
});

test("skips install when a live lock exists and recovers stale locks from dead processes", async () => {
  const dir = makeTempDir();
  const home = path.join(dir, "runtime");
  fs.mkdirSync(home, { recursive: true });
  const { bytes, sha256 } = makeReleaseArchive(dir, "0.3.2");
  const fetchFn: typeof fetch = async () => new Response(bytes, { status: 200 });

  // Active lock owned by this live process causes another instance to skip.
  const lockFile = path.join(home, "0.3.2.lock");
  fs.writeFileSync(lockFile, `${process.pid}\n`);
  const skipped = await installUpdate(
    { version: "0.3.2", url: "https://example.test/claudesaurus-0.3.2.tar.gz", sha256 },
    {
      home,
      currentVersion: "0.3.0",
      nodePath: process.execPath,
      fetchFn,
      checkElectron: () => true,
      installDependencies: async () => {},
    },
  );
  expect(skipped).toBeNull();

  // Lock owned by a non-existent PID is recovered and installation completes.
  fs.writeFileSync(lockFile, "99999999\n");
  const recovered = await installUpdate(
    { version: "0.3.2", url: "https://example.test/claudesaurus-0.3.2.tar.gz", sha256 },
    {
      home,
      currentVersion: "0.3.0",
      nodePath: process.execPath,
      fetchFn,
      checkElectron: () => true,
      installDependencies: async () => {},
    },
  );
  expect(recovered?.version).toBe("0.3.2");
  expect(fs.existsSync(lockFile)).toBe(false);
});

test("startAutoUpdater notifies when a release is downloaded or already installed by another pane", async () => {
  const dir = makeTempDir();
  const home = path.join(dir, "runtime");
  const cacheFile = path.join(dir, "update-check.json");
  const { bytes, sha256 } = makeReleaseArchive(dir, "0.3.1");

  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/latest")) {
      return new Response(
        JSON.stringify({
          tag_name: "v0.3.1",
          assets: [
            {
              name: "claudesaurus-0.3.1.tar.gz",
              browser_download_url: "https://example.test/claudesaurus-0.3.1.tar.gz",
              digest: `sha256:${sha256}`,
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(bytes, { status: 200 });
  };

  const ready = await new Promise<ReadyUpdate>((resolve) => {
    const updater = startAutoUpdater({
      currentVersion: "0.3.0",
      nodePath: process.execPath,
      releaseUrl: "https://example.test/latest",
      home,
      cacheFile,
      initialDelayMs: 5,
      pollIntervalMs: 50,
      checkIntervalMs: 0,
      fetchFn,
      checkElectron: () => true,
      installDependencies: async () => {},
      onUpdateReady(update) {
        updater.stop();
        resolve(update);
      },
    });
  });

  expect(ready).toEqual({ version: "0.3.1", root: path.join(home, "0.3.1") });
});

test("restartArgs replaces session flags when resuming and keeps startup flags when blank", () => {
  expect(
    restartArgs(["--model", "haiku", "--effort=low", "--continue"], {
      agentId: "claude-acp",
      sessionId: "sess-1",
    }),
  ).toEqual(["--agent", "claude-acp", "--resume", "sess-1"]);

  expect(
    restartArgs(["--model", "haiku", "--resume", "old", "--agent", "codex"], {
      agentId: "claude-acp",
      sessionId: null,
    }),
  ).toEqual(["--model", "haiku", "--agent", "claude-acp"]);
});
