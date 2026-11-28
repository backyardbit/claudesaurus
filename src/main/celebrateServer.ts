import readline from "node:readline";
import { z } from "zod";
import { sendToChat } from "./chatSocket";

const TOOL = {
  name: "celebrate",
  title: "Celebrate",
  description:
    "Plays a short party animation in the Claudesaurus chat. Call it once, right after a pull request from this conversation is merged (for example when `gh pr merge` succeeds), and for nothing else.",
  inputSchema: {
    type: "object",
    properties: {
      pr: { type: "integer", description: "The number of the pull request that was merged." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

const Id = z.union([z.string(), z.number()]);

const RequestSchema = z.discriminatedUnion("method", [
  z.object({
    id: Id,
    method: z.literal("initialize"),
    params: z.object({ protocolVersion: z.string().optional() }).optional(),
  }),
  z.object({ id: Id, method: z.literal("ping") }),
  z.object({ id: Id, method: z.literal("tools/list") }),
  z.object({
    id: Id,
    method: z.literal("tools/call"),
    params: z.object({
      name: z.string(),
      arguments: z.object({ pr: z.number().int().optional() }).optional(),
    }),
  }),
]);

const OtherRequestSchema = z.object({ id: Id, method: z.string() });

type Request = z.infer<typeof RequestSchema>;
type Call = Extract<Request, { method: "tools/call" }>["params"];
type Reply =
  | { id: string | number; result: Awaited<ReturnType<typeof answer>> }
  | { id: string | number; error: { code: number; message: string } };

const DEFAULT_PROTOCOL = "2025-06-18";

function write(reply: Reply) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...reply })}\n`);
}

function text(value: string, isError = false) {
  return { content: [{ type: "text", text: value }], isError };
}

async function call({ name, arguments: input }: Call) {
  if (name !== TOOL.name) return text(`No tool named ${name}.`, true);
  const socket = process.env.CLAUDESAURUS_CHAT_SOCKET;
  if (!socket) return text("No chat is listening.", true);
  try {
    await sendToChat(socket, { type: "celebrate", pr: input?.pr ?? null });
    return text("The chat is celebrating.");
  } catch {
    return text("The chat has closed.", true);
  }
}

async function answer(request: Request) {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: request.params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "claudesaurus", version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: [TOOL] };
    case "tools/call":
      return call(request.params);
  }
}

async function handle(line: string) {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return;
  }
  const request = RequestSchema.safeParse(json);
  if (request.success) {
    write({ id: request.data.id, result: await answer(request.data) });
    return;
  }
  const other = OtherRequestSchema.safeParse(json);
  if (!other.success) return;
  write({ id: other.data.id, error: { code: -32601, message: `No method ${other.data.method}.` } });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => void handle(line));
