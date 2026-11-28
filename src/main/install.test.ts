import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  archiveKind,
  commandPath,
  extractArchive,
  installBinary,
  sha256Of,
  verifySha256,
} from "./install";

let scratch = "";

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "claudesaurus-install-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function makeRelease() {
  const release = path.join(scratch, "release");
  fs.mkdirSync(path.join(release, "bin"), { recursive: true });
  fs.writeFileSync(path.join(release, "bin", "agent"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
  fs.symlinkSync("bin/agent", path.join(release, "agent"));
  return release;
}

function expectRelease(folder: string) {
  expect(fs.lstatSync(path.join(folder, "agent")).isSymbolicLink()).toBe(true);
  expect(fs.readlinkSync(path.join(folder, "agent"))).toBe("bin/agent");
  expect(fs.statSync(path.join(folder, "bin", "agent")).mode & 0o111).not.toBe(0);
}

test("checks a file's SHA-256 in either case", async () => {
  const file = path.join(scratch, "file");
  fs.writeFileSync(file, "hello");
  const digest = createHash("sha256").update("hello").digest("hex");
  expect(await sha256Of(file)).toBe(digest);
  await expect(verifySha256(file, digest.toUpperCase())).resolves.toBeUndefined();
  await expect(verifySha256(file, "0".repeat(64))).rejects.toThrow(/SHA-256/);
});

test("knows an archive by its address", () => {
  expect(archiveKind("https://x.test/a/agent-1.0-darwin.zip")).toBe("zip");
  expect(archiveKind("https://x.test/agent.tar.gz")).toBe("tar.gz");
  expect(archiveKind("https://x.test/agent.tgz")).toBe("tar.gz");
  expect(archiveKind("https://x.test/agent.tar.bz2")).toBe("tar.bz2");
  expect(archiveKind("https://x.test/agent.tbz2?sig=1")).toBe("tar.bz2");
  expect(archiveKind("https://x.test/agent")).toBe("raw");
});

test("an agent's command must stay inside its folder", () => {
  expect(commandPath("/cache/agent", "./bin/agent")).toBe("/cache/agent/bin/agent");
  expect(() => commandPath("/cache/agent", "../../bin/sh")).toThrow(/outside/);
  expect(() => commandPath("/cache/agent", "/bin/sh")).toThrow(/outside/);
});

test("unpacks a zip and keeps its symlinks", async () => {
  const release = makeRelease();
  const archive = path.join(scratch, "release.zip");
  execFileSync("zip", ["-q", "-r", "-y", archive, "."], { cwd: release });
  const out = path.join(scratch, "out");
  await extractArchive(archive, "zip", out);
  expectRelease(out);
});

test("unpacks a tarball and keeps its symlinks", async () => {
  const release = makeRelease();
  for (const [kind, flag] of [
    ["tar.gz", "-czf"],
    ["tar.bz2", "-cjf"],
  ]) {
    const archive = path.join(scratch, `release.${kind}`);
    execFileSync("tar", [flag ?? "", archive, "-C", release, "."]);
    const out = path.join(scratch, `out-${kind}`);
    await extractArchive(archive, kind ?? "", out);
    expectRelease(out);
  }
});

test("downloads, checks and unpacks a release once", async () => {
  const release = makeRelease();
  const archive = path.join(scratch, "release.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", release, "."]);
  const bytes = fs.readFileSync(archive);
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.setHeader("content-length", bytes.length);
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: a server listening on a TCP port has an AddressInfo for its address.
  const { port } = server.address() as AddressInfo;
  const home = path.join(scratch, "home");
  const agent = { id: "test-agent", name: "Test", version: "1.0.0" };
  const target = {
    archive: `http://127.0.0.1:${port}/release.tar.gz`,
    cmd: "./agent",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const reports: string[] = [];
  try {
    const folder = await installBinary(home, agent, target, (status) => reports.push(status));
    expect(folder).toBe(path.join(home, "agents", "test-agent", "1.0.0"));
    expectRelease(folder);
    expect(reports.at(-1)).toBe("Unpacking Test…");
    expect(await installBinary(home, agent, target, () => {})).toBe(folder);
    expect(requests).toBe(1);

    const tampered = { ...target, sha256: "0".repeat(64) };
    const other = { ...agent, version: "2.0.0" };
    await expect(installBinary(home, other, tampered, () => {})).rejects.toThrow(/SHA-256/);
    expect(fs.readdirSync(path.join(home, "agents", "test-agent"))).toEqual(["1.0.0"]);
  } finally {
    server.close();
  }
});
