import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";
import { PR_CHANNEL, PULL_REQUEST_METHODS } from "../shared/pr";
import { sendDraftToChat } from "./chatSocket";
import { startDebugCapture } from "./debug";
import { openPage } from "./page";
import { createGitHub, resolvePullRequestTarget } from "./pr/github";
import { checkOutPullRequest } from "./prCheckout";
import { createResumeReporter, ownerPid, resumeCommand, takeResumeToken } from "./resume";
import { focusPane, openChatPane } from "./rexPanes";

/**
 * `claudesaurus pr [PR]`: a pull request, read and reviewed in this pane the way T3 Code shows
 * one. PR is a number of this folder's repository, `owner/repo#N`, or a pull request's URL; with
 * none, the pull request of the branch checked out here.
 */

const run = promisify(execFile);
const cwd = process.cwd();
const resumeToken = takeResumeToken();

function writeToTerminal(sequence: string) {
  try {
    fs.writeSync(process.stdout.fd, sequence);
  } catch {
    // Resume reports are a courtesy; a terminal that cannot take one must not stop the viewer.
  }
}

/** The pull request of the branch checked out here, as `gh pr view` finds it. */
async function currentBranchPullRequest() {
  try {
    const { stdout } = await run("gh", ["pr", "view", "--json", "url", "--jq", ".url"], { cwd });
    return stdout.trim();
  } catch {
    throw new Error(
      "This branch has no pull request. Name one: claudesaurus pr 15, claudesaurus pr owner/repo#15, or its URL.",
    );
  }
}

const MethodSchema = z.enum(PULL_REQUEST_METHODS);

const RefSchema = z.object({ repository: z.string(), number: z.number().int().positive() });

const HandoffSchema = z.object({
  reference: RefSchema,
  prompt: z.string().nullable(),
  checkout: z.enum(["worktree", "local"]).nullable(),
});

/**
 * Hands a task to the chat that opened this viewer, when one did and is still there, and moves
 * the focus to it; otherwise opens a chat beside the viewer.
 */
async function handToChat(
  chat: { socket: string; block: string | null } | null,
  where: { cwd: string; prompt: string | null },
) {
  if (chat && where.prompt !== null) {
    try {
      await sendDraftToChat(chat.socket, where.prompt);
      if (chat.block) await focusPane(chat.block);
      return "opened-from" as const;
    } catch {
      // The chat has closed since; a new one takes the task.
    }
  }
  await openChatPane(where.cwd, where.prompt);
  return "new" as const;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { "chat-socket": { type: "string" }, "chat-block": { type: "string" } },
    allowPositionals: true,
    strict: false,
  });
  const arg = positionals[0] ?? "";
  const socket = z.string().optional().catch(undefined).parse(values["chat-socket"]);
  const chat = socket
    ? {
        socket,
        block: z
          .string()
          .nullable()
          .catch(null)
          .parse(values["chat-block"] ?? null),
      }
    : null;
  const reference = await resolvePullRequestTarget(
    arg === "" ? await currentBranchPullRequest() : arg,
    cwd,
  );
  const github = createGitHub({ cwd });
  const resume = createResumeReporter({
    write: writeToTerminal,
    token: resumeToken,
    pid: ownerPid(),
    command: resumeCommand(),
    cwd,
  });
  const target = `${reference.repository}#${reference.number}`;
  resume.update({ version: 1, kind: "pr", target });
  process.on("SIGCONT", () => resume.rereport());

  const { root, view } = openPage({
    name: target,
    html: path.join("pr", "index.html"),
    onQuit: () => {
      resume.clear();
      root.stop();
    },
  });
  root.setTitle(target);
  const debugDirectory = process.env.CLAUDESAURUS_DEBUG_DIR;
  const debug = debugDirectory ? startDebugCapture(debugDirectory, view.webContents) : null;
  if (debugDirectory) {
    setInterval(() => debug?.note("stats", { at: Date.now(), ...root.surfaceStats() }), 1000);
  }

  // Frames inside the page, such as an html block in a comment, must not reach GitHub.
  view.webContents.ipc.handle(PR_CHANNEL, async (event, operation: string, ...args) => {
    if (event.senderFrame !== view.webContents.mainFrame) {
      throw new Error("Only the viewer page may ask.");
    }
    switch (operation) {
      case "target":
        return { reference, openedFromChat: chat !== null };
      case "call": {
        const method = MethodSchema.parse(args[0]);
        // SAFETY: the page's preload sends each method its own input type, and the GitHub layer
        // checks every repository, number and node id in it before using them.
        return github[method](args[1] as never);
      }
      case "handoff": {
        const handoff = HandoffSchema.parse(args[0]);
        // A checkout is work of its own, so it always gets a chat on its branch; a question or a
        // fix goes to the chat that opened this viewer, the way T3 Code's thread panel does it.
        if (handoff.checkout !== null) {
          const checkout = await checkOutPullRequest(cwd, handoff.reference, handoff.checkout);
          await openChatPane(checkout.cwd, handoff.prompt);
          return { chat: "new", ...checkout };
        }
        const placed = await handToChat(chat, { cwd, prompt: handoff.prompt });
        return { chat: placed, cwd, branch: null, isOnPullRequestHead: true };
      }
      default:
        throw new Error(`No such request: ${operation}`);
    }
  });

  view.webContents.ipc.on(PR_CHANNEL, (event, operation: string, text) => {
    if (event.senderFrame !== view.webContents.mainFrame) return;
    if (operation === "copy") root.setClipboard(z.string().parse(text));
    if (operation === "quit") {
      resume.clear();
      root.stop();
    }
  });
}

main().catch((error: Error) => {
  process.stderr.write(`claudesaurus pr: ${error.message}\n`);
  process.exit(1);
});
