import { z } from "zod";
import type { PullRequestRef } from "../../shared/pr";
import { ghJson } from "./gh";

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const NAME = "[A-Za-z0-9._-]+";
const REPOSITORY = new RegExp(`^${OWNER}/${NAME}$`);
const BARE_NUMBER = /^#?(\d+)$/;
const SHORT_REF = new RegExp(`^(${OWNER}/${NAME})#(\\d+)$`);
const URL_REF = new RegExp(
  `^(?:https?://)?(?:www\\.)?github\\.com/(${OWNER}/${NAME})/pull/(\\d+)(?:[/?#].*)?$`,
  "i",
);

const USAGE = "Name a pull request as 15, #15, owner/repo#15, or a github.com pull request URL.";

export function splitRepository(repository: string) {
  if (!REPOSITORY.test(repository)) {
    throw new Error(`"${repository}" is not a GitHub repository name (owner/name).`);
  }
  const [owner = "", name = ""] = repository.split("/");
  return { owner, name };
}

export function checkNumber(number: number) {
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${number} is not a pull request number.`);
  }
  return number;
}

export function parsePullRequestTarget(arg: string) {
  const input = arg.trim();
  const bare = BARE_NUMBER.exec(input);
  const named = bare ? null : (SHORT_REF.exec(input) ?? URL_REF.exec(input));
  const repository = named?.[1] ?? null;
  const number = Number(bare?.[1] ?? named?.[2]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { repository, number };
}

const RepoViewSchema = z.object({ nameWithOwner: z.string() });

export async function resolvePullRequestTarget(arg: string, cwd: string): Promise<PullRequestRef> {
  const target = parsePullRequestTarget(arg);
  if (target === null) throw new Error(`"${arg.trim()}" is not a pull request. ${USAGE}`);
  if (target.repository !== null) return { repository: target.repository, number: target.number };
  let repository: string;
  try {
    const view = await ghJson(
      cwd,
      ["repo", "view", "--json", "nameWithOwner"],
      RepoViewSchema,
      "the repository",
    );
    repository = view.nameWithOwner;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not tell which GitHub repository ${cwd} is (${reason}). Name it as owner/repo#${target.number}, or paste the pull request's URL.`,
    );
  }
  return { repository, number: target.number };
}
