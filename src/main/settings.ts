import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Drawing } from "../shared/protocol";

export type Settings = { drawing: Drawing };

const DEFAULTS: Settings = { drawing: "tiles" };

function settingsFile() {
  const config = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(config, "claudesaurus", "settings.json");
}

/** Reads the user's saved choices, falling back to the defaults for any that are missing. */
export function loadSettings(file = settingsFile()): Settings {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Settings>;
    return { drawing: saved.drawing === "patches" ? "patches" : DEFAULTS.drawing };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings, file = settingsFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
