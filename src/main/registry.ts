import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

export const CLAUDE_ID = "claude-acp";

const ALIASES = new Map([
  ["claude", CLAUDE_ID],
  ["codex", "codex-acp"],
  ["grok", "grok-build"],
  ["antigravity", "antigravity-acp"],
]);

const FEATURED = [...ALIASES.values()];

const FEATURED_NAMES = new Map([
  [CLAUDE_ID, "Claude"],
  ["codex-acp", "Codex"],
  ["grok-build", "Grok"],
  ["antigravity-acp", "Antigravity"],
]);

export function agentName(agentId: string, entry: RegistryAgent | null) {
  return FEATURED_NAMES.get(agentId) ?? entry?.name ?? agentId;
}

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

const PathSegmentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/);

const RegistryAgentSchema = z.object({
  id: PathSegmentSchema,
  name: z.string(),
  version: PathSegmentSchema,
  description: z.string().optional(),
  distribution: z.object({
    binary: z.record(z.string(), BinaryTargetSchema).optional(),
    npx: PackageSchema.optional(),
    uvx: PackageSchema.optional(),
  }),
});

export type RegistryAgent = z.infer<typeof RegistryAgentSchema>;

export type Distribution =
  | { kind: "binary"; target: BinaryTarget }
  | { kind: "npx" | "uvx"; package: string; args: string[] };

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

const SYSTEMS = new Map([
  ["darwin", "darwin"],
  ["linux", "linux"],
  ["win32", "windows"],
]);
const CPUS = new Map([
  ["arm64", "aarch64"],
  ["x64", "x86_64"],
]);

export function platformTarget(platform: string, arch: string, musl: boolean) {
  const system = SYSTEMS.get(platform);
  const cpu = CPUS.get(arch);
  if (!system || !cpu) return null;
  return `${system}-${cpu}${system === "linux" && musl ? "-musl" : ""}`;
}

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

export function pickDistribution(agent: RegistryAgent, target: string | null): Distribution | null {
  const { binary, npx, uvx } = agent.distribution;
  const build = target ? binary?.[target] : undefined;
  if (build) return { kind: "binary", target: build };
  if (npx) return { kind: "npx", package: npx.package, args: npx.args ?? [] };
  if (uvx) return { kind: "uvx", package: uvx.package, args: uvx.args ?? [] };
  return null;
}

export function resolveAgentId(name: string) {
  const key = name.trim().toLowerCase();
  return ALIASES.get(key) ?? key;
}

export function pickerOrder(agents: RegistryAgent[], target: string | null) {
  const usable = agents.filter((agent) => pickDistribution(agent, target) !== null);
  const rank = (agent: RegistryAgent) => {
    const featured = FEATURED.indexOf(agent.id);
    return featured === -1 ? FEATURED.length : featured;
  };
  return usable.toSorted((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function cacheHome() {
  const cache = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(cache, "claudesaurus");
}

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
    } catch {}
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not fetch the ACP registry (${reason}), and none is cached.`);
  }
}
