import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PrHandoffResult, PullRequestRef } from "../shared/pr";

const run = promisify(execFile);

async function output(command: string, args: string[], cwd: string) {
  const { stdout } = await run(command, args, { cwd });
  return stdout.trim();
}

/** The checkout the viewer was opened in, refused when it is not of the pull request's repository. */
async function repositoryRoot(cwd: string, reference: PullRequestRef) {
  const root = await output("git", ["rev-parse", "--show-toplevel"], cwd).catch(() => null);
  if (!root)
    throw new Error("This folder is not a git checkout, so there is nowhere to check out.");
  const repository = await output(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    root,
  ).catch(() => null);
  if (repository?.toLowerCase() !== reference.repository.toLowerCase()) {
    throw new Error(`This folder is not a checkout of ${reference.repository}.`);
  }
  return root;
}

/** Whether `cwd` is at the pull request's newest commit, after a checkout. */
async function onPullRequestHead(cwd: string, reference: PullRequestRef) {
  const [head, prHead] = await Promise.all([
    output("git", ["rev-parse", "HEAD"], cwd),
    output(
      "gh",
      [
        "pr",
        "view",
        String(reference.number),
        "-R",
        reference.repository,
        "--json",
        "headRefOid",
        "--jq",
        ".headRefOid",
      ],
      cwd,
    ),
  ]);
  return head === prHead;
}

async function currentBranch(cwd: string) {
  return output("git", ["branch", "--show-current"], cwd).catch(() => null);
}

/**
 * Puts the pull request's branch where a chat can work on it: in this checkout, as
 * `gh pr checkout` does, or in a worktree of its own beside it, named for the pull request, as
 * this repository keeps its worktrees (`<repo>-worktrees/<name>`). A worktree made before is
 * reused and moved onto the newest commit.
 */
export async function checkOutPullRequest(
  cwd: string,
  reference: PullRequestRef,
  mode: "worktree" | "local",
): Promise<Omit<PrHandoffResult, "chat">> {
  const root = await repositoryRoot(cwd, reference);
  let where = root;
  if (mode === "worktree") {
    where = path.join(
      path.dirname(root),
      `${path.basename(root)}-worktrees`,
      `pr-${reference.number}`,
    );
    if (!fs.existsSync(where)) {
      await output("git", ["worktree", "add", "--detach", where], root);
    }
  }
  const checkout = await run(
    "gh",
    ["pr", "checkout", String(reference.number), "-R", reference.repository],
    { cwd: where },
  ).then(
    () => null,
    (error: Error & { stderr?: string }) => error.stderr?.trim() || error.message,
  );
  const branch = await currentBranch(where);
  // `gh pr checkout` refuses to move a branch with work of its own on it. The checkout is still
  // usable, only older; the reader is told so rather than left without a chat.
  if (checkout !== null && branch === null) throw new Error(checkout);
  return {
    cwd: where,
    branch,
    isOnPullRequestHead: await onPullRequestHead(where, reference).catch(() => false),
  };
}
