import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** The saved choices; one that is missing or unknown falls back to its default. */
const SettingsSchema = z.object({
  drawing: z.enum(["tiles", "patches"]).catch("tiles"),
});

export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULTS: Settings = { drawing: "tiles" };

function settingsFile() {
  const config = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(config, "claudesaurus", "settings.json");
}

/** Reads the user's saved choices, falling back to the defaults for any that are missing. */
export function loadSettings(file = settingsFile()): Settings {
  try {
    return SettingsSchema.catch(DEFAULTS).parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings, file = settingsFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
