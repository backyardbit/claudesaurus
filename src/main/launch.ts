import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgentChoice } from "../shared/protocol";
import type { LaunchCommand } from "./agent";
import { commandPath, installBinary } from "./install";
import {
  agentName,
  CLAUDE_ID,
  cacheHome,
  currentTarget,
  loadRegistry,
  pickDistribution,
  pickerOrder,
  type RegistryAgent,
} from "./registry";

export type BundledClaude = { nodePath: string; adapterEntry: string };

function besideNode(nodePath: string, program: string) {
  const beside = path.join(path.dirname(nodePath), program);
  return path.isAbsolute(nodePath) && fs.existsSync(beside) ? beside : program;
}

export async function prepareLaunch(
  agentId: string,
  claude: BundledClaude,
  report: (detail: string) => void,
): Promise<{ name: string; launch: LaunchCommand }> {
  if (agentId === CLAUDE_ID) {
    return {
      name: agentName(agentId, null),
      launch: { command: claude.nodePath, args: [claude.adapterEntry], env: new Map() },
    };
  }
  report("Reading the ACP registry…");
  const entry = (await loadRegistry()).find((candidate) => candidate.id === agentId);
  if (!entry) {
    throw new Error(
      `The ACP registry has no agent ${agentId}. Use claude, codex, grok, antigravity, or an id from https://agentclientprotocol.com/registry.`,
    );
  }
  const name = agentName(agentId, entry);
  const distribution = pickDistribution(entry, currentTarget());
  if (!distribution) throw new Error(`${name} publishes no build for this computer.`);
  if (distribution.kind === "binary") {
    const { target } = distribution;
    const folder = await installBinary(cacheHome(), { ...entry, name }, target, report);
    const env = new Map(Object.entries(target.env ?? {}));
    return {
      name,
      launch: { command: commandPath(folder, target.cmd), args: target.args ?? [], env },
    };
  }
  report(`Starting ${name}, which ${distribution.kind} may first download…`);
  const launch: LaunchCommand =
    distribution.kind === "npx"
      ? {
          command: besideNode(claude.nodePath, "npx"),
          args: ["--yes", distribution.package, ...distribution.args],
          env: new Map(),
        }
      : { command: "uvx", args: [distribution.package, ...distribution.args], env: new Map() };
  return { name, launch };
}

export async function agentChoices(claudeVersion: string): Promise<AgentChoice[]> {
  let entries: RegistryAgent[] = [];
  try {
    entries = pickerOrder(await loadRegistry(), currentTarget());
  } catch {}
  const claude: AgentChoice = {
    id: CLAUDE_ID,
    name: agentName(CLAUDE_ID, null),
    version: claudeVersion,
    description: "Anthropic's Claude Code, built in",
  };
  return [
    claude,
    ...entries
      .filter((entry) => entry.id !== CLAUDE_ID)
      .map((entry) => ({
        id: entry.id,
        name: agentName(entry.id, entry),
        version: entry.version,
        description: entry.description ?? null,
      })),
  ];
}

export function openRexPane(command: LaunchCommand, cwd: string, label: string) {
  const block = process.env.REX_BLOCK;
  if (!block) return null;
  return new Promise<boolean>((resolve) => {
    const rex = spawn("rex", rexPaneArgs(block, command, cwd, label), { stdio: "ignore" });
    rex.on("error", () => resolve(false));
    rex.on("exit", (code) => resolve(code === 0));
  });
}

export function rexPaneArgs(block: string, command: LaunchCommand, cwd: string, label: string) {
  const variables = [...command.env].map(([key, value]) => `${key}=${value}`);
  return [
    "split",
    "-b",
    block,
    "--split=below",
    "--ratio=40",
    `--label=${label}`,
    `--cwd=${cwd}`,
    "--wait",
    "--",
    "env",
    ...variables,
    command.command,
    ...command.args,
  ];
}
