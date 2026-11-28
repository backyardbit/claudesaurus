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
  "rex",
  "dist",
  "README.md",
  "LICENSE",
];

execFileSync("node", ["scripts/build.mjs"], { stdio: "inherit" });
fs.mkdirSync("release", { recursive: true });
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
