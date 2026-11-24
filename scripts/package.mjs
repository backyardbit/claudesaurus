// Builds what a release needs, in `release/`:
// - claudesaurus-VERSION.tar.gz, the built app with the lockfile and patches. The app installs
//   its own runtime dependencies from them the first time it runs.
// - claudesaurus.rb, the Homebrew formula for this version, to copy into the tap.
//
// FORMULA_URL overrides where the formula downloads the archive from, for testing it unreleased.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const name = `claudesaurus-${version}`;
const archive = path.join("release", `${name}.tar.gz`);
const contents = [
  "package.json",
  "pnpm-lock.yaml",
  "patches",
  "bin",
  "dist",
  "README.md",
  "LICENSE",
];

execFileSync("node", ["scripts/build.mjs"], { stdio: "inherit" });
fs.mkdirSync("release", { recursive: true });
// bsdtar, which macOS has, takes -s where GNU tar takes --transform.
const gnu = execFileSync("tar", ["--version"], { encoding: "utf8" }).includes("GNU");
const prefix = gnu ? ["--transform", `s,^,${name}/,`] : ["-s", `,^,${name}/,`];
execFileSync("tar", [...prefix, "-czf", archive, ...contents], { stdio: "inherit" });

const sha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const url =
  process.env.FORMULA_URL ??
  `https://github.com/backyardbit/claudesaurus/releases/download/v${version}/${name}.tar.gz`;
const formula = fs
  .readFileSync("packaging/claudesaurus.rb", "utf8")
  .replace("@URL@", url)
  .replace("@SHA256@", sha256);
fs.writeFileSync("release/claudesaurus.rb", formula);

console.log(`${archive}\nsha256 ${sha256}\nrelease/claudesaurus.rb`);
