// Builds the release archive that the Homebrew formula installs: the built app and what
// `pnpm install --prod` needs to fetch its runtime dependencies on the target machine.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const name = `claudesaurus-${version}`;
const archive = path.join("release", `${name}.tar.gz`);
const contents = ["package.json", "pnpm-lock.yaml", "patches", "bin", "dist", "README.md"];

execFileSync("node", ["scripts/build.mjs"], { stdio: "inherit" });
fs.mkdirSync("release", { recursive: true });
execFileSync(
  "tar",
  [
    "--sort=name",
    "--owner=0",
    "--group=0",
    "--mtime=2026-01-01",
    "--transform",
    `s,^,${name}/,`,
    "-czf",
    archive,
    ...contents,
  ],
  { stdio: "inherit" },
);

const sha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
console.log(`${archive}\nsha256 ${sha256}`);
