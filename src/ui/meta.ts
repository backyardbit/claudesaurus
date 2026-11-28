import { z } from "zod";

const optionalString = z.string().optional().catch(undefined);
const optionalNumber = z.number().optional().catch(undefined);

const PatchHunkSchema = z.object({
  oldStart: z.number(),
  newStart: z.number(),
  lines: z.array(z.string()),
});

export type PatchHunk = z.infer<typeof PatchHunkSchema>;

const ToolResponseSchema = z.object({
  stdout: optionalString,
  stderr: optionalString,
  numFiles: optionalNumber,
  numLines: optionalNumber,
  structuredPatch: z.array(PatchHunkSchema).optional().catch(undefined),
});

export type ToolResponse = z.infer<typeof ToolResponseSchema>;

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

export const ToolOutputSchema = z.string().nullable().catch(null);

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
