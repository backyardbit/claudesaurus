import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const SettingsSchema = z.object({
  drawing: z.enum(["tiles", "patches"]).catch("tiles"),
  zen: z.boolean().catch(false),
  agent: z.string().catch("claude"),
});

export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULTS: Settings = { drawing: "tiles", zen: false, agent: "claude" };

function settingsFile() {
  const config = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(config, "claudesaurus", "settings.json");
}

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
