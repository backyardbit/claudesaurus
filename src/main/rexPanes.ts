import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** The pane this process draws in, when it runs in Rex. */
export const rexBlock = process.env.REX_BLOCK ?? null;

/**
 * How to start Claudesaurus again, as the launcher set it for this run: the Homebrew wrapper, or
 * node with a checkout's bin script.
 */
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

/** Splits this pane and runs Claudesaurus with `args` in the new one; answers its block. */
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

/** The PR viewer this chat last opened, which the next pull request link replaces. */
let viewerBlock: string | null = null;

/**
 * Opens a pull request in a viewer pane beside this one. A viewer this chat opened before is
 * closed first, so following links does not stack up panes. The viewer is told this chat's socket
 * and pane, so the tasks it hands off come back to this chat.
 */
export async function openPullRequestPane(url: string, cwd: string, chatSocket: string) {
  if (viewerBlock) {
    await run("rex", ["block", "close", viewerBlock]).catch(() => {
      // Already closed by the reader.
    });
  }
  const args = ["pr", url, "--chat-socket", chatSocket];
  if (rexBlock) args.push("--chat-block", rexBlock);
  viewerBlock = await splitWithClaudesaurus({ cwd, label: "Pull request", args });
}

/** Moves the focus to `block`, such as the chat a task was just handed to. */
export async function focusPane(block: string) {
  await run("rex", ["focus", block]).catch(() => {
    // Focus is a courtesy; the task is in the composer either way.
  });
}

/** Opens a chat beside this pane, in `cwd`, with `draft` waiting in its composer. */
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

/**
 * Reads and deletes the draft a viewer left for this chat: the file is a one-time hand-over, and
 * a reopened session must not offer it again.
 */
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
