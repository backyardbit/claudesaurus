import type { InitializeResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import { z } from "zod";
import type { AgentFeatures } from "../shared/protocol";

/** `_meta.steering.supported` in an initialize response: the agent takes `_session/steering`. */
const SteeringMetaSchema = z
  .object({ steering: z.object({ supported: z.boolean() }) })
  .transform(({ steering }) => steering.supported)
  .catch(false);

/** What the page and the main process may use, from the agent's answer to `initialize`. */
export function agentFeatures(initialized: InitializeResponse): AgentFeatures {
  const capabilities = initialized.agentCapabilities ?? {};
  const sessions = capabilities.sessionCapabilities ?? {};
  return {
    // `/resume` lists past sessions and then loads one, so it needs both.
    resume: Boolean(capabilities.loadSession && sessions.list),
    steer: SteeringMetaSchema.parse(initialized._meta),
    // Only the standard capability counts. Antigravity 1.5.2 also advertises
    // `_meta.antigravity.systemPrompt.append`, but ignores an appended prompt, so it gets the
    // note in its first prompt like any agent without the capability.
    systemPrompt: Boolean(sessions.systemPrompt),
    embeddedContext: Boolean(capabilities.promptCapabilities?.embeddedContext),
  };
}

/** The ACP category each command line setting stands for, when an agent names it otherwise. */
const STARTUP_CATEGORIES = new Map([
  ["model", "model"],
  ["effort", "thought_level"],
  ["mode", "mode"],
]);

function selectChoices(option: SessionConfigOption) {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

/**
 * Resolves a requested value against a select option's listed choices (by value or display name,
 * case-insensitively). Returns null when the option lists choices and none match, so a setting
 * meant for another agent (such as `--model haiku` on Antigravity) is not sent to fail.
 */
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

/**
 * Matches the settings given on the command line (`--model`, `--effort`, `--mode`) to the
 * session's config options: the option with the same id, or else the one in the same
 * category. A setting the session has no option for is skipped; a value not offered by the
 * agent's choices is left at the agent's default without error.
 */
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
