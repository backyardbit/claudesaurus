import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BEGIN = "-- >>> claudesaurus >>>";
const END = "-- <<< claudesaurus <<<";

/** Rex's config file, where Rex itself looks for it. */
function rexConfigFile() {
  if (process.env.REX_CONFIG) return process.env.REX_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "rex", "init.lua");
}

function readOrEmpty(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** The Claudesaurus block in Rex's config, or null when it has none. */
function blockIn(config) {
  const start = config.indexOf(BEGIN);
  const end = config.indexOf(END, start);
  return start === -1 || end === -1 ? null : config.slice(start, end + END.length);
}

function withBlock(config, block) {
  const current = blockIn(config);
  if (current !== null) return config.replace(current, block);
  return config.trim() === "" ? `${block}\n` : `${config.replace(/\n*$/, "\n")}\n${block}\n`;
}

/** Makes Rex load the changed config; a Rex that is not running reads it when it starts. */
function reloadRex() {
  execFile("rex", ["--autostart=false", "config", "reload"], () => {});
}

/**
 * Puts the Claudesaurus actions in Rex's command palette, or brings them up to date, when Rex is
 * set up on this machine. Leaves them out once `--remove-rex-actions` has taken them out.
 * `command` is how a new pane starts this install of Claudesaurus.
 */
export function installRexActions(appRoot, command) {
  const configFile = rexConfigFile();
  const configDir = path.dirname(configFile);
  if (!fs.existsSync(configDir)) return;
  const config = readOrEmpty(configFile);
  const current = blockIn(config);
  if (current !== null && !current.includes("dofile(")) return;

  const pluginFile = path.join(configDir, "plugins", "claudesaurus", "init.lua");
  const plugin = fs.readFileSync(path.join(appRoot, "rex", "claudesaurus.lua"), "utf8");
  // JSON's string escapes are valid in Lua for the characters a path can hold.
  const setup = `dofile(${JSON.stringify(pluginFile)}).setup({ command = { ${command.map((part) => JSON.stringify(part)).join(", ")} } })`;
  const block = [
    BEGIN,
    "-- Added by Claudesaurus, which keeps it up to date; `claudesaurus --remove-rex-actions` removes it.",
    setup,
    END,
  ].join("\n");

  let changed = false;
  if (readOrEmpty(pluginFile) !== plugin) {
    fs.mkdirSync(path.dirname(pluginFile), { recursive: true });
    fs.writeFileSync(pluginFile, plugin);
    changed = true;
  }
  const next = withBlock(config, block);
  if (next !== config) {
    fs.writeFileSync(configFile, next);
    changed = true;
  }
  if (changed) reloadRex();
}

/** Takes the actions out of Rex, leaving a note in its config so later runs keep them out. */
export function removeRexActions() {
  const configFile = rexConfigFile();
  const configDir = path.dirname(configFile);
  fs.rmSync(path.join(configDir, "plugins", "claudesaurus"), { recursive: true, force: true });
  if (!fs.existsSync(configDir)) return;
  const block = [
    BEGIN,
    "-- Removed by `claudesaurus --remove-rex-actions`. Delete these lines to have Claudesaurus add",
    "-- its command palette actions again.",
    END,
  ].join("\n");
  fs.writeFileSync(configFile, withBlock(readOrEmpty(configFile), block));
  reloadRex();
}
