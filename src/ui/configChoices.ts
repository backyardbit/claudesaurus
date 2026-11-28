import type { SessionConfigOption } from "@agentclientprotocol/sdk";

export type Choice = { value: string; name: string; description: string | null };

export function choices(option: SessionConfigOption): Choice[] {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) => {
    const flat = "options" in entry ? entry.options : [entry];
    return flat.map((choice) => ({
      value: choice.value,
      name: choice.name,
      description: choice.description ?? null,
    }));
  });
}
