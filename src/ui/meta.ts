type ClaudeCodeMeta = {
  toolName?: string;
  parentToolUseId?: string;
  toolResponse?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads the Claude adapter's extension fields from an ACP `_meta` object. */
export function claudeCodeMeta(meta: unknown): ClaudeCodeMeta {
  if (!isRecord(meta) || !isRecord(meta.claudeCode)) return {};
  const { toolName, parentToolUseId, toolResponse } = meta.claudeCode;
  return {
    toolName: typeof toolName === "string" ? toolName : undefined,
    parentToolUseId: typeof parentToolUseId === "string" ? parentToolUseId : undefined,
    toolResponse,
  };
}

export function stringField(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

export function numberField(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}
