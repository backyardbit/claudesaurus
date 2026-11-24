/**
 * The pull request viewer's GitHub access, through the `gh` CLI the user is signed in to. Ported
 * from T3 Code's GitHubPullRequestCli.ts and GitHubPullRequestProvider.ts (MIT), without the
 * multi-provider and multi-host layers. Anything the user wrote travels to gh over stdin.
 */
import { z } from "zod";
import type {
  PullRequestAction,
  PullRequestApi,
  PullRequestDiffResult,
  PullRequestMergeMethod,
  PullRequestMethod,
  PullRequestUpdateMethod,
} from "../../shared/pr";
import { decodeJson, type GraphQlVariables, ghJson, graphql, graphqlWrite, runGh } from "./gh";
import {
  comparisonHeadRef,
  filesToPatch,
  gitHubReactionContent,
  REVIEW_EVENTS,
  reviewerRequestBody,
  subjectBelongs,
  toDraftThread,
  toPullRequestActivity,
  toPullRequestDetail,
  toReviewerCandidates,
} from "./mapping";
import {
  ACTIVITY_QUERY,
  ADD_REACTION,
  ADD_REVIEW,
  BASE_COMPARISON_QUERY,
  DETAIL_QUERY,
  PULL_REQUEST_ID_QUERY,
  REMOVE_REACTION,
  REPLY_TO_THREAD,
  RESOLVE_THREAD,
  REVIEWER_CANDIDATES_QUERY,
  SUBJECT_SCOPE_QUERY,
  UNRESOLVE_THREAD,
  UPDATE_ISSUE_COMMENT,
  UPDATE_PULL_REQUEST,
  UPDATE_REVIEW_COMMENT,
} from "./queries";
import {
  type ActivityResponse,
  ActivityResponseSchema,
  BaseComparisonSchema,
  ConversationSchema,
  DetailResponseSchema,
  FilesSchema,
  PullRequestIdSchema,
  ReviewerCandidatesSchema,
  SubjectScopeSchema,
} from "./schemas";
import { checkNumber, splitRepository } from "./target";

export { resolvePullRequestTarget } from "./target";

/** `PullRequestApi` as the main process serves it: every method answers with a promise. */
export type GitHubPullRequests = {
  [M in PullRequestMethod]: (
    input: Parameters<PullRequestApi[M]>[0],
  ) => Promise<ReturnType<PullRequestApi[M]>>;
};

/** A large pull request's patch runs to megabytes; past this it is read from the files API. */
const DIFF_MAX_BYTES = 8 * 1024 * 1024;
const DIFF_TIMEOUT_MS = 60_000;
/** Expanding context is for source files, not blobs large enough to stall the page. */
const FILE_MAX_BYTES = 1024 * 1024;
/** What the files API serves at most in one response, which is what one slice of a diff is. */
const FILES_PAGE_SIZE = 100;
/** Pages of a hundred review threads read before the conversation is reported truncated. */
const THREAD_PAGES = 10;

const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

/** A commit sha from the page goes into a request path, so it must be nothing but hex. */
function checkCommit(commit: string) {
  if (!COMMIT_SHA.test(commit)) throw new Error(`"${commit}" is not a commit sha.`);
  return commit;
}

/** The page a diff cursor names. Only this module hands cursors out, so anything else is refused. */
function cursorPage(cursor: string) {
  if (!/^[1-9][0-9]{0,6}$/.test(cursor))
    throw new Error("That diff cursor is not one GitHub gave.");
  return Number(cursor);
}

/** A repository path for the contents API, refusing segments that would climb out of it. */
function contentsPath(path: string) {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`"${path}" is not a file path in the repository.`);
  }
  return segments.map(encodeURIComponent).join("/");
}

function actionArgs(
  action: PullRequestAction,
  mergeMethod: PullRequestMergeMethod | undefined,
  updateMethod: PullRequestUpdateMethod | undefined,
) {
  switch (action) {
    case "merge":
      return ["merge", `--${mergeMethod ?? "merge"}`];
    // `--auto` arms the merge rather than running it; GitHub stores the method with it.
    case "enable-auto-merge":
      return ["merge", "--auto", `--${mergeMethod ?? "merge"}`];
    case "disable-auto-merge":
      return ["merge", "--disable-auto"];
    case "update-branch":
      return ["update-branch", ...(updateMethod === "rebase" ? ["--rebase"] : [])];
    case "ready":
      return ["ready"];
    case "draft":
      return ["ready", "--undo"];
    case "close":
      return ["close"];
    case "reopen":
      return ["reopen"];
  }
}

const RevisionsSchema = z.object({ base: z.string().nullable(), head: z.string() });
const MergeBaseSchema = z.object({ base: z.string() });

/** The pull request viewer's reads and writes for the repository checkout at `cwd`. */
export function createGitHub({ cwd }: { cwd: string }): GitHubPullRequests {
  /** Checks a reference from the page and spells it the way the GraphQL queries take it. */
  function target(input: { repository: string; number: number }) {
    const { owner, name } = splitRepository(input.repository);
    return { owner, name, number: checkNumber(input.number) };
  }
  type Target = ReturnType<typeof target>;

  async function pullRequestId(ref: Target) {
    const response = await graphql(
      cwd,
      PULL_REQUEST_ID_QUERY,
      ref,
      PullRequestIdSchema,
      "the pull request's id",
    );
    return response.data.repository.pullRequest.id;
  }

  /**
   * A node id from the page can name a remark on any pull request, and a mutation writes wherever
   * the id belongs. So it is confirmed to hang off this pull request before anything is sent.
   */
  async function requireSubject(ref: Target, subjectId: string) {
    const scope = await graphql(
      cwd,
      SUBJECT_SCOPE_QUERY,
      { ...ref, subjectId },
      SubjectScopeSchema,
      "where the comment belongs",
    );
    if (!subjectBelongs(scope))
      throw new Error("That comment does not belong to this pull request.");
  }

  /**
   * One slice of the patch from the files API, a whole number of files, for a pull request too
   * large for `gh pr diff` (GitHub refuses past 300 files) or for one commit of it.
   */
  async function filesPage(ref: Target, page: number, commit: string | undefined) {
    const paging = `per_page=${FILES_PAGE_SIZE}&page=${page}`;
    const base = `repos/${ref.owner}/${ref.name}`;
    const args =
      commit === undefined
        ? ["api", `${base}/pulls/${ref.number}/files?${paging}`]
        : // An empty commit has no `files` at all, which is a commit with nothing in it.
          ["api", `${base}/commits/${commit}?${paging}`, "--jq", ".files // []"];
    const output = await runGh(args, { cwd, maxBytes: DIFF_MAX_BYTES, timeoutMs: DIFF_TIMEOUT_MS });
    if (output.truncated)
      throw new Error(`Page ${page} of the changed files is too large to read.`);
    const files = decodeJson(FilesSchema, output.stdout.toString("utf8"), "the changed files");
    const { patch, truncated, omittedFileStats } = filesToPatch(files);
    const result: PullRequestDiffResult = {
      patch,
      truncated,
      nextCursor: files.length >= FILES_PAGE_SIZE ? String(page + 1) : null,
    };
    if (omittedFileStats.length > 0) result.omittedFileStats = omittedFileStats;
    return result;
  }

  /**
   * The two revisions a diff compares. A pull request's diff is taken from the merge base, not
   * from the base branch's tip, so the old side is read there or its lines would not line up.
   */
  async function revisions(ref: Target, commit: string | undefined) {
    const base = `repos/${ref.owner}/${ref.name}`;
    if (commit !== undefined) {
      const read = await ghJson(
        cwd,
        ["api", `${base}/commits/${commit}`, "--jq", "{base: .parents[0].sha, head: .sha}"],
        RevisionsSchema,
        "the commit's revisions",
      );
      return { old: read.base, new: checkCommit(read.head) };
    }
    const read = await ghJson(
      cwd,
      ["api", `${base}/pulls/${ref.number}`, "--jq", "{base: .base.sha, head: .head.sha}"],
      RevisionsSchema,
      "the pull request's revisions",
    );
    const head = checkCommit(read.head);
    const mergeBase = await ghJson(
      cwd,
      [
        "api",
        `${base}/compare/${checkCommit(read.base ?? "")}...${head}?per_page=1`,
        "--jq",
        "{base: .merge_base_commit.sha}",
      ],
      MergeBaseSchema,
      "the merge base",
    );
    return { old: checkCommit(mergeBase.base), new: head };
  }

  async function readFile(ref: Target, revision: string, path: string) {
    const output = await runGh(
      [
        "api",
        "-H",
        "Accept: application/vnd.github.raw+json",
        `repos/${ref.owner}/${ref.name}/contents/${contentsPath(path)}?ref=${revision}`,
      ],
      { cwd, maxBytes: FILE_MAX_BYTES, timeoutMs: DIFF_TIMEOUT_MS },
    );
    if (output.truncated) throw new Error(`${path} is over 1 MB, too large to expand.`);
    const binary = new Error(`${path} is a binary file, which cannot be expanded.`);
    if (output.stdout.includes(0)) throw binary;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(output.stdout);
    } catch {
      throw binary;
    }
  }

  async function activityPages(ref: Target) {
    const pages: ActivityResponse[] = [];
    let cursor: string | null = null;
    do {
      const page: ActivityResponse = await graphql(
        cwd,
        ACTIVITY_QUERY,
        { ...ref, cursor },
        ActivityResponseSchema,
        "the review threads",
      );
      pages.push(page);
      const info = page.data.repository.pullRequest.reviewThreads.pageInfo;
      cursor = info?.hasNextPage === true ? (info.endCursor ?? null) : null;
    } while (cursor !== null && pages.length < THREAD_PAGES);
    return { pages, cut: cursor !== null };
  }

  return {
    async detail(input) {
      const ref = target(input);
      const response = await graphql(
        cwd,
        DETAIL_QUERY,
        ref,
        DetailResponseSchema,
        "the pull request",
      );
      const headRef = comparisonHeadRef(response);
      // Only an open pull request can be behind its base. A failed comparison leaves it unknown:
      // the banner it feeds is an offer, never a reason to fail the page.
      const behindBy =
        headRef === null
          ? null
          : await graphql(
              cwd,
              BASE_COMPARISON_QUERY,
              { ...ref, headRef },
              BaseComparisonSchema,
              "the base comparison",
            ).then(
              (read) => read.data.repository?.pullRequest?.baseRef?.compare?.behindBy ?? null,
              () => null,
            );
      return toPullRequestDetail(
        response,
        cwd,
        behindBy !== null && behindBy >= 0 ? behindBy : null,
      );
    },

    async activity(input) {
      const ref = target(input);
      // `gh pr view` follows the comment and review cursors itself; line comments live on review
      // threads, which only the GraphQL read reaches.
      const [conversation, threads] = await Promise.all([
        ghJson(
          cwd,
          [
            "pr",
            "view",
            String(ref.number),
            "--repo",
            input.repository,
            "--json",
            "comments,reviews",
          ],
          ConversationSchema,
          "the conversation",
        ),
        activityPages(ref),
      ]);
      return toPullRequestActivity(conversation, threads.pages, threads.cut);
    },

    async diff(input) {
      const ref = target(input);
      const commit = input.commit === undefined ? undefined : checkCommit(input.commit);
      // A cursor only ever comes from the files walk, and `gh pr diff` cannot name one commit.
      if (input.cursor !== undefined) return filesPage(ref, cursorPage(input.cursor), commit);
      if (commit !== undefined) return filesPage(ref, 1, commit);
      const args = [
        "pr",
        "diff",
        String(ref.number),
        "--repo",
        input.repository,
        "--color",
        "never",
      ];
      let output: Awaited<ReturnType<typeof runGh>>;
      try {
        output = await runGh(args, { cwd, maxBytes: DIFF_MAX_BYTES, timeoutMs: DIFF_TIMEOUT_MS });
      } catch (error) {
        // GitHub answers 406 rather than a diff past 300 files or 20,000 lines, and still serves
        // those files' hunks one page at a time. Should that fail too, the first refusal is the
        // one that explains the page.
        return filesPage(ref, 1, undefined).catch(() => Promise.reject(error));
      }
      // A patch cut mid-file is no patch at all, so an oversized one is read in slices instead.
      if (output.truncated) return filesPage(ref, 1, undefined);
      return { patch: output.stdout.toString("utf8"), truncated: false, nextCursor: null };
    },

    async diffFileContents(input) {
      const ref = target(input);
      const commit = input.commit === undefined ? undefined : checkCommit(input.commit);
      const sides = await revisions(ref, commit);
      const oldRevision = sides.old;
      if (oldRevision === null && input.changeType !== "new") {
        throw new Error("This commit has no parent to compare the file against.");
      }
      const [oldContents, newContents] = await Promise.all([
        input.changeType === "new" || oldRevision === null
          ? ""
          : readFile(ref, checkCommit(oldRevision), input.oldPath),
        input.changeType === "deleted" ? "" : readFile(ref, sides.new, input.newPath),
      ]);
      return { oldContents, newContents };
    },

    async runAction(input) {
      const ref = target(input);
      const [subcommand = "", ...flags] = actionArgs(
        input.action,
        input.mergeMethod,
        input.updateMethod,
      );
      await runGh(["pr", subcommand, String(ref.number), "--repo", input.repository, ...flags], {
        cwd,
      });
      return null;
    },

    async comment(input) {
      const ref = target(input);
      await runGh(
        ["pr", "comment", String(ref.number), "--repo", input.repository, "--body-file", "-"],
        { cwd, stdin: input.body },
      );
      return null;
    },

    async update(input) {
      const ref = target(input);
      // A field not sent is left as it was, so only what the user changed is in the request.
      const variables: GraphQlVariables = { pullRequestId: await pullRequestId(ref) };
      if (input.title !== undefined) variables.title = input.title;
      if (input.body !== undefined) variables.body = input.body;
      await graphqlWrite(cwd, UPDATE_PULL_REQUEST, variables);
      return null;
    },

    async updateComment(input) {
      const ref = target(input);
      await requireSubject(ref, input.commentId);
      const mutation =
        input.kind === "issue-comment" ? UPDATE_ISSUE_COMMENT : UPDATE_REVIEW_COMMENT;
      await graphqlWrite(cwd, mutation, { commentId: input.commentId, body: input.body });
      return null;
    },

    async submitReview(input) {
      const ref = target(input);
      const variables: GraphQlVariables = {
        pullRequestId: await pullRequestId(ref),
        event: REVIEW_EVENTS[input.verdict],
        threads: input.comments.map(toDraftThread),
      };
      if (input.body.trim().length > 0) variables.body = input.body;
      await graphqlWrite(cwd, ADD_REVIEW, variables);
      return null;
    },

    async replyToThread(input) {
      target(input);
      await graphqlWrite(cwd, REPLY_TO_THREAD, { threadId: input.threadId, body: input.body });
      return null;
    },

    async setThreadResolution(input) {
      target(input);
      const mutation = input.resolved ? RESOLVE_THREAD : UNRESOLVE_THREAD;
      await graphqlWrite(cwd, mutation, { threadId: input.threadId });
      return null;
    },

    async setReaction(input) {
      const ref = target(input);
      let subjectId: string;
      if (input.subjectId === undefined) {
        // The pull request's own reactions sit on its description, which nothing on the page names.
        subjectId = await pullRequestId(ref);
      } else {
        await requireSubject(ref, input.subjectId);
        subjectId = input.subjectId;
      }
      await graphqlWrite(cwd, input.reacted ? ADD_REACTION : REMOVE_REACTION, {
        subjectId,
        content: gitHubReactionContent(input.content),
      });
      return null;
    },

    async reviewerCandidates(input) {
      const response = await graphql(
        cwd,
        REVIEWER_CANDIDATES_QUERY,
        target(input),
        ReviewerCandidatesSchema,
        "the reviewers",
      );
      return toReviewerCandidates(response);
    },

    async requestReviewers(input) {
      const ref = target(input);
      // POST adds to whoever is already asked; DELETE takes back exactly the ones named.
      await runGh(
        [
          "api",
          "--method",
          input.requested ? "POST" : "DELETE",
          `repos/${ref.owner}/${ref.name}/pulls/${ref.number}/requested_reviewers`,
          "--input",
          "-",
        ],
        { cwd, stdin: reviewerRequestBody(input.reviewers) },
      );
      return null;
    },
  };
}
