import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

export const rexBlock = process.env.REX_BLOCK ?? null;

function claudesaurusCommand() {
  const parsed = z
    .array(z.string())
    .safeParse(JSON.parse(process.env.CLAUDESAURUS_COMMAND ?? "[]"));
  if (!parsed.success || parsed.data.length === 0) {
    throw new Error("Claudesaurus does not know how to start itself here.");
  }
  return parsed.data;
}

const SplitResultSchema = z.object({ block_ids: z.array(z.string()) });

async function splitWithClaudesaurus(options: { cwd: string; label: string; args: string[] }) {
  if (!rexBlock) throw new Error("Opening a pane needs Rex.");
  const { stdout } = await run("rex", [
    "split",
    "-b",
    rexBlock,
    "--cwd",
    options.cwd,
    "--label",
    options.label,
    "--json",
    "--",
    ...claudesaurusCommand(),
    ...options.args,
  ]);
  const parsed = SplitResultSchema.safeParse(JSON.parse(stdout));
  return parsed.success ? (parsed.data.block_ids[0] ?? null) : null;
}

let viewerBlock: string | null = null;

export async function openPullRequestPane(url: string, cwd: string, chatSocket: string) {
  if (viewerBlock) {
    await run("rex", ["block", "close", viewerBlock]).catch(() => {});
  }
  const args = ["pr", url, "--chat-socket", chatSocket];
  if (rexBlock) args.push("--chat-block", rexBlock);
  viewerBlock = await splitWithClaudesaurus({ cwd, label: "Pull request", args });
}

export async function focusPane(block: string) {
  await run("rex", ["focus", block]).catch(() => {});
}

export async function openChatPane(cwd: string, draft: string | null) {
  const args: string[] = [];
  if (draft !== null) {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "claudesaurus-draft-")),
      "draft.md",
    );
    fs.writeFileSync(file, draft);
    args.push("--draft-file", file);
  }
  await splitWithClaudesaurus({ cwd, label: "Claudesaurus", args });
}

export function takeDraftFile(file: string | undefined) {
  if (!file) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return text;
  } catch {
    return null;
  }
}
