import { expect, test } from "vitest";
import {
  filesToPatch,
  reviewerRequestBody,
  subjectBelongs,
  toChecks,
  toDraftThread,
  toPullRequestActivity,
  toPullRequestDetail,
  toReactions,
  toReviewerCandidates,
  toViewerPermissions,
} from "./mapping";
import type { ActivityResponse, Conversation, DetailResponse } from "./schemas";

const avatar = (login: string) => `https://avatars.example/${login}`;

test("reactions drop empty groups and leave the viewer out of who reacted", () => {
  const reactions = toReactions(
    [
      {
        content: "THUMBS_UP",
        viewerHasReacted: true,
        reactors: { totalCount: 3, nodes: [{ login: "me" }, { login: "ann" }] },
      },
      { content: "HEART", viewerHasReacted: false, reactors: { totalCount: 0, nodes: [] } },
      { content: "SOMETHING_NEW", reactors: { totalCount: 1, nodes: [{ login: "bob" }] } },
    ],
    "ME",
  );
  expect(reactions).toEqual([
    { content: "thumbs-up", count: 3, actors: ["ann"], viewerHasReacted: true },
  ]);
});

test("checks keep the newest run of each and name same-named checks by workflow", () => {
  const checks = toChecks([
    {
      name: "build",
      status: "COMPLETED",
      conclusion: "FAILURE",
      completedAt: "2026-01-01T00:00:00Z",
      checkSuite: { workflowRun: { workflow: { name: "CI" } } },
    },
    { context: "ci/legacy", state: "PENDING", targetUrl: "https://ci.example/1" },
    {
      name: "build",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-01-02T00:00:00Z",
      checkSuite: { workflowRun: { workflow: { name: "CI" } } },
    },
    {
      name: "build",
      status: "IN_PROGRESS",
      title: "Building",
      checkSuite: { workflowRun: { workflow: { name: "Release" } } },
    },
    { name: "lint", status: "COMPLETED", conclusion: "ACTION_REQUIRED" },
    { name: "docs", status: "COMPLETED", conclusion: "SKIPPED" },
    null,
  ]);
  expect(checks).toEqual([
    { name: "CI / build", status: "success", description: null, url: null },
    { name: "ci/legacy", status: "pending", description: null, url: "https://ci.example/1" },
    { name: "Release / build", status: "pending", description: "Building", url: null },
    { name: "lint", status: "failure", description: null, url: null },
    { name: "docs", status: "skipped", description: null, url: null },
  ]);
});

test("an author may comment on their own pull request but not approve it", () => {
  expect(
    toViewerPermissions({
      canWrite: false,
      canUpdate: true,
      didAuthor: true,
      canUpdateBranch: true,
    }),
  ).toEqual({
    actions: ["ready", "draft", "close", "reopen", "update-branch"],
    comment: true,
    resolve: true,
    verdicts: ["comment"],
    requestReviewers: false,
    updateMethods: ["merge", "rebase"],
  });
  expect(
    toViewerPermissions({
      canWrite: false,
      canUpdate: false,
      didAuthor: false,
      canUpdateBranch: false,
    }),
  ).toEqual({
    actions: [],
    comment: true,
    resolve: false,
    verdicts: ["comment", "approve", "request-changes"],
    requestReviewers: false,
  });
});

const detailResponse: DetailResponse = {
  data: {
    viewer: { login: "me" },
    repository: {
      nameWithOwner: "owner/repo",
      mergeCommitAllowed: false,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      viewerPermission: "WRITE",
      pullRequest: {
        number: 7,
        title: "Fix it",
        body: null,
        url: "https://github.com/owner/repo/pull/7",
        state: "OPEN",
        isDraft: true,
        mergeable: "CONFLICTING",
        additions: 3,
        deletions: 1,
        changedFiles: 2,
        headRefName: "fix",
        baseRefName: "main",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        mergedAt: null,
        closedAt: null,
        headRepositoryOwner: { login: "fork" },
        author: { login: "ann", name: "Ann", avatarUrl: avatar("ann") },
        viewerCanUpdate: true,
        viewerDidAuthor: false,
        viewerCanUpdateBranch: false,
        autoMergeRequest: { enabledAt: "2026-01-02T00:00:00Z" },
        labels: { nodes: [{ name: "bug", color: "d73a4a" }, { name: " " }] },
        reviewRequests: {
          nodes: [{ requestedReviewer: { login: "bob" } }, { requestedReviewer: {} }],
        },
        latestReviews: { nodes: [{ author: { login: "bob" } }, { author: { login: "cat" } }] },
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" }],
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
};

test("a pull request's detail is read off one GraphQL answer", () => {
  const detail = toPullRequestDetail(detailResponse, "/work", 4);
  expect(detail).toMatchObject({
    provider: "github",
    workspaceRoot: "/work",
    repository: "owner/repo",
    number: 7,
    body: "",
    author: { login: "ann", name: "Ann", avatarUrl: avatar("ann") },
    state: "open",
    isDraft: true,
    mergeability: "conflicting",
    reviewers: [
      { login: "bob", name: null, avatarUrl: null },
      { login: "cat", name: null, avatarUrl: null },
    ],
    labels: [{ name: "bug", color: "d73a4a" }],
    checks: [{ name: "test", status: "success", description: null, url: null }],
    mergeCapabilities: { merge: false, squash: true, rebase: true },
    viewer: "me",
    baseComparison: "behind",
    behindBy: 4,
    autoMergeEnabled: true,
  });
  expect(detail.viewerPermissions.actions).toEqual([
    "merge",
    "enable-auto-merge",
    "disable-auto-merge",
    "ready",
    "draft",
    "close",
    "reopen",
  ]);
  const unknown = toPullRequestDetail(detailResponse, "/work", null);
  expect(unknown.baseComparison).toBe("unknown");
  expect("behindBy" in unknown).toBe(false);
});

const conversation: Conversation = {
  comments: [
    {
      id: "IC_1",
      author: { login: "ann" },
      body: "Looks close",
      createdAt: "2026-01-01T02:00:00Z",
      url: "https://github.com/owner/repo/pull/7#issuecomment-1",
    },
  ],
  reviews: [
    {
      id: "PRR_1",
      author: { login: "bob" },
      body: "",
      state: "APPROVED",
      submittedAt: "2026-01-01T04:00:00Z",
    },
    // The container GitHub opens for line comments, which carries nothing of its own.
    {
      id: "PRR_2",
      author: { login: "bob" },
      body: "",
      state: "COMMENTED",
      submittedAt: "2026-01-01T03:00:00Z",
    },
    {
      id: "PRR_3",
      author: { login: "bot[bot]" },
      body: "<!-- marker -->",
      state: "DISMISSED",
      submittedAt: "2026-01-01T01:00:00Z",
    },
    { id: "PRR_4", author: { login: "cat" }, body: "Pending", state: "PENDING", submittedAt: null },
  ],
};

function activityPage(threadIds: string[], hasNextPage: boolean): ActivityResponse {
  return {
    data: {
      viewer: { login: "me" },
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage, endCursor: hasNextPage ? "next" : null },
            nodes: threadIds.map((id) => ({
              id,
              isResolved: id === "T2",
              isOutdated: false,
              path: `src/${id}.ts`,
              line: id === "T2" ? null : 12,
              diffSide: id === "T2" ? "LEFT" : "RIGHT",
              comments: {
                totalCount: 1,
                pageInfo: { hasNextPage: false },
                nodes: [
                  {
                    id: `C_${id}`,
                    author: { login: "cat", avatarUrl: avatar("cat") },
                    body: `On ${id}`,
                    createdAt: "2026-01-01T03:00:00Z",
                    url: null,
                  },
                ],
              },
            })),
          },
          author: { login: "ann", avatarUrl: avatar("ann") },
          reactionGroups: [
            {
              content: "ROCKET",
              viewerHasReacted: false,
              reactors: { totalCount: 1, nodes: [{ login: "bob" }] },
            },
          ],
          comments: {
            nodes: [
              {
                id: "IC_1",
                author: { login: "ann", avatarUrl: avatar("ann") },
                reactionGroups: [
                  { content: "EYES", viewerHasReacted: true, reactors: { totalCount: 1 } },
                ],
              },
            ],
          },
          reviews: {
            nodes: [
              { id: "PRR_1", url: "https://github.com/owner/repo/pull/7#pullrequestreview-1" },
            ],
          },
          reviewRequests: { nodes: [] },
          latestReviews: { nodes: [{ author: { login: "bob" } }] },
          reviewDismissals: { nodes: [{ dismissalMessage: "Stale", review: { id: "PRR_3" } }] },
          commits: {
            nodes: [
              {
                commit: {
                  oid: "abc1234",
                  messageHeadline: "Fix it",
                  committedDate: "2026-01-01T00:00:00Z",
                  additions: 3,
                  deletions: 1,
                  authors: {
                    nodes: [
                      { name: "Ann", avatarUrl: avatar("ann"), user: { login: "ann" } },
                      { name: "Unlinked" },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

test("activity joins comments, review summaries and line comments into one conversation", () => {
  const activity = toPullRequestActivity(
    conversation,
    [activityPage(["T1"], true), activityPage(["T2"], false)],
    false,
  );
  expect(activity.comments.map((comment) => [comment.id, comment.kind, comment.body])).toEqual([
    ["PRR_3", "review", "Stale"],
    ["IC_1", "issue-comment", "Looks close"],
    ["C_T1", "review-comment", "On T1"],
    ["C_T2", "review-comment", "On T2"],
    ["PRR_1", "review", ""],
  ]);
  const byId = new Map(activity.comments.map((comment) => [comment.id, comment]));
  expect(byId.get("IC_1")?.author?.avatarUrl).toBe(avatar("ann"));
  expect(byId.get("IC_1")?.reactions).toEqual([
    { content: "eyes", count: 1, actors: [], viewerHasReacted: true },
  ]);
  // Nobody in the GraphQL read named bob's picture, so GitHub's own URL for it stands in.
  expect(byId.get("PRR_1")?.author?.avatarUrl).toBe("https://github.com/bob.png?size=80");
  expect(byId.get("PRR_1")?.url).toBe("https://github.com/owner/repo/pull/7#pullrequestreview-1");
  expect(byId.get("PRR_3")?.author?.avatarUrl).toBeNull();
  expect(byId.get("C_T1")?.path).toBe("src/T1.ts");
  expect(
    activity.reviewThreads.map(({ id, line, side, isResolved }) => [id, line, side, isResolved]),
  ).toEqual([
    ["T1", 12, "right", false],
    ["T2", null, "left", true],
  ]);
  expect(activity.commentCount).toBe(5);
  expect(activity.commentsTruncated).toBe(false);
  expect(activity.reviewers.map((reviewer) => reviewer.login)).toEqual(["bob"]);
  expect(activity.reactions).toEqual([
    { content: "rocket", count: 1, actors: ["bob"], viewerHasReacted: false },
  ]);
  expect(activity.commits).toEqual([
    {
      oid: "abc1234",
      messageHeadline: "Fix it",
      committedDate: "2026-01-01T00:00:00Z",
      additions: 3,
      deletions: 1,
      authors: [
        { login: "ann", name: "Ann", avatarUrl: avatar("ann") },
        { login: "Unlinked", name: "Unlinked", avatarUrl: null },
      ],
    },
  ]);
  expect(
    toPullRequestActivity(conversation, [activityPage([], false)], true).commentsTruncated,
  ).toBe(true);
});

test("the files API's hunks are assembled into a git patch", () => {
  const result = filesToPatch([
    { filename: "new.ts", status: "added", patch: "@@ -0,0 +1 @@\n+a", additions: 1, deletions: 0 },
    {
      filename: "gone.ts",
      status: "removed",
      patch: "@@ -1 +0,0 @@\n-a\n",
      additions: 0,
      deletions: 1,
    },
    {
      filename: "to.ts",
      status: "renamed",
      previous_filename: "from.ts",
      additions: 0,
      deletions: 0,
    },
    { filename: "logo.png", status: "modified", additions: 10, deletions: 2 },
  ]);
  expect(result.patch).toBe(
    [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+a",
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-a",
      "diff --git a/from.ts b/to.ts",
      "rename from from.ts",
      "rename to to.ts",
      "--- a/from.ts",
      "+++ b/to.ts",
      "diff --git a/logo.png b/logo.png",
      "--- a/logo.png",
      "+++ b/logo.png",
      "",
    ].join("\n"),
  );
  expect(result.truncated).toBe(true);
  expect(result.omittedFileStats).toEqual([{ path: "logo.png", additions: 10, deletions: 2 }]);
});

test("a drafted line comment is pinned to the side its line is counted in", () => {
  const body = "Why?";
  expect(toDraftThread({ path: "a.ts", position: { kind: "added", newLine: 5 }, body })).toEqual({
    path: "a.ts",
    line: 5,
    side: "RIGHT",
    body,
  });
  expect(toDraftThread({ path: "a.ts", position: { kind: "deleted", oldLine: 4 }, body })).toEqual({
    path: "a.ts",
    line: 4,
    side: "LEFT",
    body,
  });
  const context = (side: "left" | "right") =>
    toDraftThread({
      path: "a.ts",
      position: { kind: "context", oldLine: 8, newLine: 9, side },
      body,
    });
  expect(context("left")).toMatchObject({ line: 8, side: "LEFT" });
  expect(context("right")).toMatchObject({ line: 9, side: "RIGHT" });
});

test("reviewer candidates list who is asked first, and never the author", () => {
  const list = toReviewerCandidates({
    data: {
      repository: {
        assignableUsers: {
          pageInfo: { hasNextPage: true },
          nodes: [{ login: "ann" }, { login: "bob", name: "Bob" }, { login: "cat" }],
        },
        pullRequest: {
          author: { login: "ann" },
          reviewRequests: {
            nodes: [
              { requestedReviewer: { login: "cat", avatarUrl: avatar("cat") } },
              { requestedReviewer: { slug: "core", name: "Core team" } },
            ],
          },
        },
      },
    },
  });
  expect(list).toEqual({
    truncated: true,
    candidates: [
      {
        id: "cat",
        kind: "user",
        login: "cat",
        name: null,
        avatarUrl: avatar("cat"),
        isRequested: true,
      },
      {
        id: "core",
        kind: "team",
        login: "core",
        name: "Core team",
        avatarUrl: null,
        isRequested: true,
      },
      { id: "bob", kind: "user", login: "bob", name: "Bob", avatarUrl: null, isRequested: false },
    ],
  });
  expect(
    JSON.parse(
      reviewerRequestBody([
        { id: "bob", kind: "user" },
        { id: "core", kind: "team" },
      ]),
    ),
  ).toEqual({ reviewers: ["bob"], team_reviewers: ["core"] });
});

test("a node only counts as this pull request's when it hangs off it", () => {
  const scope = (node: { id: string; pullRequest?: { id: string } } | null) =>
    subjectBelongs({ data: { repository: { pullRequest: { id: "PR_1" } }, node } });
  expect(scope({ id: "IC_1", pullRequest: { id: "PR_1" } })).toBe(true);
  expect(scope({ id: "PR_1" })).toBe(true);
  expect(scope({ id: "IC_2", pullRequest: { id: "PR_2" } })).toBe(false);
  expect(scope(null)).toBe(false);
});
