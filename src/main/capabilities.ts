import type { InitializeResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import { z } from "zod";
import type { AgentFeatures } from "../shared/protocol";

const SteeringMetaSchema = z
  .object({ steering: z.object({ supported: z.boolean() }) })
  .transform(({ steering }) => steering.supported)
  .catch(false);

export function agentFeatures(initialized: InitializeResponse): AgentFeatures {
  const capabilities = initialized.agentCapabilities ?? {};
  const sessions = capabilities.sessionCapabilities ?? {};
  return {
    resume: Boolean(capabilities.loadSession && sessions.list),
    steer: SteeringMetaSchema.parse(initialized._meta),
    systemPrompt: Boolean(sessions.systemPrompt),
    embeddedContext: Boolean(capabilities.promptCapabilities?.embeddedContext),
  };
}

const STARTUP_CATEGORIES = new Map([
  ["model", "model"],
  ["effort", "thought_level"],
  ["mode", "mode"],
]);

function selectChoices(option: SessionConfigOption) {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

function matchOptionValue(option: SessionConfigOption, value: string): string | null {
  const choices = selectChoices(option);
  if (choices.length === 0) return value;
  const exact = choices.find((choice) => choice.value === value);
  if (exact) return exact.value;
  const lower = value.toLowerCase();
  const matched =
    choices.find((choice) => choice.value.toLowerCase() === lower) ??
    choices.find((choice) => choice.name.toLowerCase() === lower);
  return matched ? matched.value : null;
}

export function pickStartupConfig(
  requested: ReadonlyMap<string, string>,
  options: SessionConfigOption[],
) {
  const applied: { configId: string; value: string }[] = [];
  const skipped: string[] = [];
  for (const [name, value] of requested) {
    const category = STARTUP_CATEGORIES.get(name);
    const option =
      options.find((candidate) => candidate.id === name) ??
      options.find((candidate) => candidate.category === category);
    if (!option) {
      skipped.push(name);
      continue;
    }
    const resolved = matchOptionValue(option, value);
    if (resolved !== null) applied.push({ configId: option.id, value: resolved });
  }
  return { applied, skipped };
}
