import { z } from "zod";

/** A field that is left out when it has another type, instead of failing the whole object. */
const optionalString = z.string().optional().catch(undefined);
const optionalNumber = z.number().optional().catch(undefined);

const PatchHunkSchema = z.object({
  oldStart: z.number(),
  newStart: z.number(),
  lines: z.array(z.string()),
});

export type PatchHunk = z.infer<typeof PatchHunkSchema>;

/** The parts of Claude Code's result for a tool call that the page shows. */
const ToolResponseSchema = z.object({
  stdout: optionalString,
  stderr: optionalString,
  numFiles: optionalNumber,
  numLines: optionalNumber,
  /** Unified hunks of a finished edit, which carry real line numbers. */
  structuredPatch: z.array(PatchHunkSchema).optional().catch(undefined),
});

export type ToolResponse = z.infer<typeof ToolResponseSchema>;

/** The fields of a tool call's input that the page shows. Each tool has a few of them. */
export const ToolInputSchema = z
  .object({
    file_path: optionalString,
    notebook_path: optionalString,
    content: optionalString,
    command: optionalString,
    description: optionalString,
    pattern: optionalString,
    url: optionalString,
    query: optionalString,
    subagent_type: optionalString,
    skill: optionalString,
    todos: z
      .array(z.object({ status: optionalString }))
      .optional()
      .catch(undefined),
  })
  .catch({});

export type ToolInput = z.infer<typeof ToolInputSchema>;

/** A tool's text output, when it reports one. */
export const ToolOutputSchema = z.string().nullable().catch(null);

/** The Claude adapter's extension fields in an ACP `_meta` object. */
export const ClaudeCodeMetaSchema = z
  .object({
    claudeCode: z
      .object({
        toolName: optionalString,
        parentToolUseId: optionalString,
        toolResponse: ToolResponseSchema.optional().catch(undefined),
      })
      .catch({}),
  })
  .transform(({ claudeCode }) => claudeCode)
  .catch({});
