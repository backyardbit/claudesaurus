import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** The ACP registry's index of agents: https://github.com/agentclientprotocol/registry */
export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** Claude's registry id. Claude is launched from the adapter bundled with the app instead. */
export const CLAUDE_ID = "claude-acp";

/** Short names `--agent` takes for the agents we know best, by registry id. */
const ALIASES = new Map([
  ["claude", CLAUDE_ID],
  ["codex", "codex-acp"],
  ["grok", "grok-build"],
  ["antigravity", "antigravity-acp"],
]);

/** The agents listed first in the picker, in this order. */
const FEATURED = [...ALIASES.values()];

/** Short names for the featured agents, which fit the composer's chips. */
const FEATURED_NAMES = new Map([
  [CLAUDE_ID, "Claude"],
  ["codex-acp", "Codex"],
  ["grok-build", "Grok"],
  ["antigravity-acp", "Antigravity"],
]);

/** The name to show for an agent: a featured agent's short one, else the registry's. */
export function agentName(agentId: string, entry: RegistryAgent | null) {
  return FEATURED_NAMES.get(agentId) ?? entry?.name ?? agentId;
}

/** How long a fetch of the index may take before the cached copy is used instead. */
const FETCH_TIMEOUT_MS = 8000;

const BinaryTargetSchema = z.object({
  archive: z.string(),
  cmd: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  sha256: z.string().optional(),
});

export type BinaryTarget = z.infer<typeof BinaryTargetSchema>;

const PackageSchema = z.object({ package: z.string(), args: z.array(z.string()).optional() });

const RegistryAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  distribution: z.object({
    binary: z.record(z.string(), BinaryTargetSchema).optional(),
    npx: PackageSchema.optional(),
    uvx: PackageSchema.optional(),
  }),
});

export type RegistryAgent = z.infer<typeof RegistryAgentSchema>;

/** How to run an agent on this computer, picked from its registry entry. */
export type Distribution =
  | { kind: "binary"; target: BinaryTarget }
  | { kind: "npx" | "uvx"; package: string; args: string[] };

/**
 * The agents in a registry index, given as its JSON text. An entry this client cannot read is
 * left out rather than failing the whole list, so a new field or distribution type elsewhere
 * does not break it.
 */
export function parseRegistry(json: string): RegistryAgent[] {
  let index: unknown;
  try {
    index = JSON.parse(json);
  } catch {
    return [];
  }
  const parsed = z.object({ agents: z.array(z.unknown()) }).safeParse(index);
  if (!parsed.success) return [];
  return parsed.data.agents.flatMap((entry) => {
    const agent = RegistryAgentSchema.safeParse(entry);
    return agent.success ? [agent.data] : [];
  });
}

/** The registry's names for Node's `process.platform` and `process.arch`. */
const SYSTEMS = new Map([
  ["darwin", "darwin"],
  ["linux", "linux"],
  ["win32", "windows"],
]);
const CPUS = new Map([
  ["arm64", "aarch64"],
  ["x64", "x86_64"],
]);

/**
 * The registry's name for a platform, such as `darwin-aarch64`, or null for one it has no
 * name for. A Linux that uses musl gets the `-musl` target.
 */
export function platformTarget(platform: string, arch: string, musl: boolean) {
  const system = SYSTEMS.get(platform);
  const cpu = CPUS.get(arch);
  if (!system || !cpu) return null;
  return `${system}-${cpu}${system === "linux" && musl ? "-musl" : ""}`;
}

/** Whether this Linux runs on musl, which Node reports as having no glibc. */
function usesMusl() {
  if (process.platform !== "linux") return false;
  const header = z
    .object({ header: z.object({ glibcVersionRuntime: z.string().optional() }) })
    .safeParse(process.report?.getReport());
  return header.success && !header.data.header.glibcVersionRuntime;
}

export function currentTarget() {
  return platformTarget(process.platform, process.arch, usesMusl());
}

/**
 * How to run an agent on the given platform: its own binary when it publishes one for the
 * platform, otherwise its npm or PyPI package. Null when it has nothing for the platform.
 */
export function pickDistribution(agent: RegistryAgent, target: string | null): Distribution | null {
  const { binary, npx, uvx } = agent.distribution;
  const build = target ? binary?.[target] : undefined;
  if (build) return { kind: "binary", target: build };
  if (npx) return { kind: "npx", package: npx.package, args: npx.args ?? [] };
  if (uvx) return { kind: "uvx", package: uvx.package, args: uvx.args ?? [] };
  return null;
}

/** The registry id for what `--agent` was given: a short name such as `codex`, or an id. */
export function resolveAgentId(name: string) {
  const key = name.trim().toLowerCase();
  return ALIASES.get(key) ?? key;
}

/** The agents worth offering here, the featured ones first and the rest by name. */
export function pickerOrder(agents: RegistryAgent[], target: string | null) {
  const usable = agents.filter((agent) => pickDistribution(agent, target) !== null);
  const rank = (agent: RegistryAgent) => {
    const featured = FEATURED.indexOf(agent.id);
    return featured === -1 ? FEATURED.length : featured;
  };
  return usable.toSorted((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The folder for what Claudesaurus downloads and can download again: agents and the index. */
export function cacheHome() {
  const cache = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(cache, "claudesaurus");
}

/**
 * The registry's agents, fetched afresh and kept in the cache, or as last cached when the
 * network fails, so an agent installed before can still start offline.
 */
export async function loadRegistry(home = cacheHome()) {
  const file = path.join(home, "registry.json");
  try {
    const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const agents = parseRegistry(text);
    if (agents.length === 0) throw new Error("the index lists no agents");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(file, text);
    return agents;
  } catch (error) {
    try {
      const cached = parseRegistry(fs.readFileSync(file, "utf8"));
      if (cached.length > 0) return cached;
    } catch {
      // Nothing cached either.
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not fetch the ACP registry (${reason}), and none is cached.`);
  }
}
