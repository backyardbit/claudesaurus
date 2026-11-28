import type {
  PullRequestActor,
  PullRequestCapabilities,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestComment,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestDiffSide,
  PullRequestMergeability,
  PullRequestOmittedFileStat,
  PullRequestReaction,
  PullRequestReactionContent,
  PullRequestReviewCommentDraft,
  PullRequestReviewerCandidate,
  PullRequestReviewerCandidateList,
  PullRequestReviewerKind,
  PullRequestReviewPosition,
  PullRequestReviewThread,
  PullRequestReviewVerdict,
  PullRequestState,
  PullRequestViewerPermissions,
} from "../../shared/pr";
import type {
  ActivityResponse,
  ChangedFile,
  Conversation,
  DetailResponse,
  RawActor,
  RawCheck,
  RawLatestReviews,
  RawReactionGroups,
  RawReviewRequests,
  ReviewerCandidatesResponse,
  SubjectScope,
} from "./schemas";

export function trimmed(value: string | null | undefined) {
  const result = value?.trim() ?? "";
  return result.length > 0 ? result : null;
}

export function toActor(raw: RawActor): PullRequestActor | null {
  const login = trimmed(raw?.login);
  return login === null
    ? null
    : { login, name: trimmed(raw?.name), avatarUrl: trimmed(raw?.avatarUrl) };
}

export function loginAvatarUrl(login: string) {
  return /^[a-z0-9][a-z0-9-]{0,38}$/i.test(login)
    ? `https://github.com/${login}.png?size=80`
    : null;
}

const REACTION_CONTENT = new Map<string, PullRequestReactionContent>([
  ["THUMBS_UP", "thumbs-up"],
  ["THUMBS_DOWN", "thumbs-down"],
  ["LAUGH", "laugh"],
  ["HOORAY", "hooray"],
  ["CONFUSED", "confused"],
  ["HEART", "heart"],
  ["ROCKET", "rocket"],
  ["EYES", "eyes"],
]);

const GITHUB_REACTION = {
  "thumbs-up": "THUMBS_UP",
  "thumbs-down": "THUMBS_DOWN",
  laugh: "LAUGH",
  hooray: "HOORAY",
  confused: "CONFUSED",
  heart: "HEART",
  rocket: "ROCKET",
  eyes: "EYES",
} satisfies { [content in PullRequestReactionContent]: string };

export function gitHubReactionContent(content: PullRequestReactionContent) {
  return GITHUB_REACTION[content];
}

export function toReactions(groups: RawReactionGroups, viewer: string | null) {
  const me = viewer?.toLowerCase() ?? null;
  const reactions: PullRequestReaction[] = [];
  for (const group of groups ?? []) {
    const content = REACTION_CONTENT.get(trimmed(group.content)?.toUpperCase() ?? "");
    if (content === undefined) continue;
    const logins = (group.reactors?.nodes ?? []).flatMap((node) => trimmed(node?.login) ?? []);
    const total = Math.max(group.reactors?.totalCount ?? logins.length, logins.length);
    if (total <= 0) continue;
    reactions.push({
      content,
      count: total,
      actors: me === null ? logins : logins.filter((login) => login.toLowerCase() !== me),
      viewerHasReacted: group.viewerHasReacted === true,
    });
  }
  return reactions;
}

function toState(
  state: string | null | undefined,
  mergedAt: string | null | undefined,
): PullRequestState {
  const value = state?.trim().toUpperCase();
  if (trimmed(mergedAt) !== null || value === "MERGED") return "merged";
  return value === "CLOSED" ? "closed" : "open";
}

function toMergeability(value: string | null | undefined): PullRequestMergeability {
  switch (value?.trim().toUpperCase()) {
    case "MERGEABLE":
      return "mergeable";
    case "CONFLICTING":
      return "conflicting";
    default:
      return "unknown";
  }
}

export function toCheckStatus(raw: RawCheck): PullRequestCheckStatus {
  const status = raw.status?.trim().toUpperCase();
  if (status !== undefined && status !== "" && status !== "COMPLETED") return "pending";
  switch ((raw.conclusion ?? raw.state)?.trim().toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
    case "ACTION_REQUIRED":
      return "failure";
    case "CANCELLED":
      return "cancelled";
    case "SKIPPED":
      return "skipped";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "neutral";
  }
}

const UNSET_TIMESTAMP = "0001-01-01T00:00:00Z";

function realTimestamp(value: string | null | undefined) {
  const at = trimmed(value);
  return at === null || at === UNSET_TIMESTAMP ? null : at;
}

export function toChecks(raw: (RawCheck | null | undefined)[]) {
  type Entry = { check: PullRequestCheck; workflow: string | null; at: string | null };
  const newest = new Map<string, Entry>();
  for (const node of raw) {
    if (!node) continue;
    const name = trimmed(node.name) ?? trimmed(node.context);
    if (name === null) continue;
    const entry: Entry = {
      check: {
        name,
        status: toCheckStatus(node),
        description: trimmed(node.title) ?? trimmed(node.description),
        url: trimmed(node.detailsUrl) ?? trimmed(node.targetUrl),
      },
      workflow: trimmed(node.checkSuite?.workflowRun?.workflow?.name),
      at:
        realTimestamp(node.completedAt) ??
        realTimestamp(node.startedAt) ??
        realTimestamp(node.createdAt),
    };
    const key = `${entry.workflow ?? ""} ${name}`;
    const kept = newest.get(key);
    const newer =
      kept === undefined ||
      (entry.at === null ? kept.at === null : kept.at === null || entry.at >= kept.at);
    if (newer) newest.set(key, entry);
  }
  const survivors = [...newest.values()];
  const byName = new Map<string, number>();
  for (const entry of survivors) {
    byName.set(entry.check.name, (byName.get(entry.check.name) ?? 0) + 1);
  }
  return survivors.map((entry) =>
    entry.workflow !== null && (byName.get(entry.check.name) ?? 0) > 1
      ? { ...entry.check, name: `${entry.workflow} / ${entry.check.name}` }
      : entry.check,
  );
}

function toReviewers(requests: RawReviewRequests, latest: RawLatestReviews) {
  const reviewers = new Map<string, PullRequestActor>();
  for (const raw of [
    ...(requests?.nodes ?? []).map((node) => node?.requestedReviewer),
    ...(latest?.nodes ?? []).map((node) => node?.author),
  ]) {
    const person = toActor(raw);
    if (person !== null && !reviewers.has(person.login)) reviewers.set(person.login, person);
  }
  return [...reviewers.values()];
}

export const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  comment: true,
  actions: [
    "merge",
    "ready",
    "draft",
    "close",
    "reopen",
    "update-branch",
    "enable-auto-merge",
    "disable-auto-merge",
  ],
  mergeMethods: ["merge", "squash", "rebase"],
  updateMethods: ["merge", "rebase"],
  search: false,
  reactions: true,
  review: {
    inlineComment: true,
    reply: true,
    resolve: true,
    verdicts: ["comment", "approve", "request-changes"],
  },
  reviewers: { request: true, listCandidates: true },
  edit: { changeRequest: true, comment: true },
};

export type ViewerAccess = {
  canWrite: boolean;
  canUpdate: boolean;
  didAuthor: boolean;
  canUpdateBranch: boolean;
};

export function toViewerPermissions(access: ViewerAccess): PullRequestViewerPermissions {
  const permissions: PullRequestViewerPermissions = {
    actions: [
      ...(access.canWrite ? (["merge", "enable-auto-merge", "disable-auto-merge"] as const) : []),
      ...(access.canUpdate ? (["ready", "draft", "close", "reopen"] as const) : []),
      ...(access.canUpdateBranch ? (["update-branch"] as const) : []),
    ],
    comment: true,
    resolve: access.canWrite || access.didAuthor,
    verdicts: access.didAuthor ? ["comment"] : CAPABILITIES.review.verdicts,
    requestReviewers: access.canWrite,
  };
  if (access.canUpdateBranch) permissions.updateMethods = CAPABILITIES.updateMethods;
  return permissions;
}

function canWrite(viewerPermission: string | null | undefined) {
  const role = viewerPermission?.trim().toUpperCase();
  return role === "ADMIN" || role === "MAINTAIN" || role === "WRITE";
}

export function comparisonHeadRef(response: DetailResponse) {
  const pullRequest = response.data.repository.pullRequest;
  const owner = trimmed(pullRequest.headRepositoryOwner?.login);
  if (owner === null || toState(pullRequest.state, pullRequest.mergedAt) !== "open") return null;
  return `${owner}:${pullRequest.headRefName}`;
}

export function toPullRequestDetail(
  response: DetailResponse,
  workspaceRoot: string,
  behindBy: number | null,
): PullRequestDetail {
  const repository = response.data.repository;
  const pullRequest = repository.pullRequest;
  const checks = (pullRequest.commits?.nodes ?? []).flatMap(
    (node) => node?.commit.statusCheckRollup?.contexts.nodes ?? [],
  );
  const detail: PullRequestDetail = {
    provider: "github",
    capabilities: CAPABILITIES,
    viewerPermissions: toViewerPermissions({
      canWrite: canWrite(repository.viewerPermission),
      canUpdate: pullRequest.viewerCanUpdate !== false,
      didAuthor: pullRequest.viewerDidAuthor === true,
      canUpdateBranch: pullRequest.viewerCanUpdateBranch === true,
    }),
    workspaceRoot,
    repository: repository.nameWithOwner,
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body ?? "",
    url: pullRequest.url,
    author: toActor(pullRequest.author),
    state: toState(pullRequest.state, pullRequest.mergedAt),
    isDraft: pullRequest.isDraft === true,
    mergeability: toMergeability(pullRequest.mergeable),
    additions: pullRequest.additions ?? 0,
    deletions: pullRequest.deletions ?? 0,
    changedFiles: pullRequest.changedFiles ?? 0,
    headBranch: pullRequest.headRefName,
    baseBranch: pullRequest.baseRefName,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
    mergedAt: trimmed(pullRequest.mergedAt),
    closedAt: trimmed(pullRequest.closedAt),
    reviewers: toReviewers(pullRequest.reviewRequests, pullRequest.latestReviews),
    labels: (pullRequest.labels?.nodes ?? []).flatMap((label) => {
      const name = trimmed(label?.name);
      return name === null ? [] : [{ name, color: trimmed(label?.color) }];
    }),
    checks: toChecks(checks),
    mergeCapabilities: {
      merge: repository.mergeCommitAllowed,
      squash: repository.squashMergeAllowed,
      rebase: repository.rebaseMergeAllowed,
    },
    baseComparison: behindBy === null ? "unknown" : behindBy > 0 ? "behind" : "up-to-date",
    autoMergeEnabled: pullRequest.autoMergeRequest != null,
  };
  const viewer = trimmed(response.data.viewer?.login);
  if (viewer !== null) detail.viewer = viewer;
  if (behindBy !== null) detail.behindBy = behindBy;
  return detail;
}

function isVerdict(state: string | null) {
  const value = state?.toUpperCase();
  return value === "APPROVED" || value === "CHANGES_REQUESTED" || value === "DISMISSED";
}

function rendersEmpty(body: string) {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim().length === 0;
}

function commitAuthor(raw: {
  name?: string | null;
  avatarUrl?: string | null;
  user?: { login?: string | null } | null;
}): PullRequestActor | null {
  const login = trimmed(raw.user?.login) ?? trimmed(raw.name);
  return login === null
    ? null
    : { login, name: trimmed(raw.name), avatarUrl: trimmed(raw.avatarUrl) };
}

export function toPullRequestActivity(
  conversation: Conversation,
  pages: ActivityResponse[],
  threadsCut: boolean,
) {
  const [first] = pages;
  if (first === undefined) throw new Error("No activity was read.");
  const viewer = trimmed(first.data.viewer?.login);
  const pullRequest = first.data.repository.pullRequest;

  const avatars = new Map<string, string>();
  for (const raw of [
    pullRequest.author,
    ...(pullRequest.comments?.nodes ?? []).map((node) => node?.author),
    ...(pullRequest.reviewRequests?.nodes ?? []).map((node) => node?.requestedReviewer),
    ...(pullRequest.latestReviews?.nodes ?? []).map((node) => node?.author),
    ...pages.flatMap((page) =>
      page.data.repository.pullRequest.reviewThreads.nodes.flatMap((thread) =>
        thread.comments.nodes.map((comment) => comment.author),
      ),
    ),
  ]) {
    const login = trimmed(raw?.login);
    const avatarUrl = trimmed(raw?.avatarUrl);
    if (login !== null && avatarUrl !== null) avatars.set(login, avatarUrl);
  }
  const withAvatar = (raw: RawActor) => {
    const person = toActor(raw);
    if (person === null || person.avatarUrl !== null) return person;
    return { ...person, avatarUrl: avatars.get(person.login) ?? loginAvatarUrl(person.login) };
  };

  const reactionsById = new Map<string, PullRequestReaction[]>();
  const reviewUrls = new Map<string, string>();
  for (const node of [
    ...(pullRequest.comments?.nodes ?? []),
    ...(pullRequest.reviews?.nodes ?? []),
  ]) {
    const id = trimmed(node?.id);
    if (id === null) continue;
    reactionsById.set(id, toReactions(node?.reactionGroups, viewer));
    const url = trimmed(node?.url);
    if (url !== null) reviewUrls.set(id, url);
  }
  const dismissals = new Map<string, string>();
  for (const node of pullRequest.reviewDismissals?.nodes ?? []) {
    const id = trimmed(node?.review?.id);
    const message = trimmed(node?.dismissalMessage);
    if (id !== null && message !== null) dismissals.set(id, message);
  }

  const reviewThreads: PullRequestReviewThread[] = [];
  let threadCommentCount = 0;
  let truncated = threadsCut;
  for (const page of pages) {
    for (const thread of page.data.repository.pullRequest.reviewThreads.nodes) {
      const id = trimmed(thread.id);
      const path = trimmed(thread.path);
      if (id === null || path === null || thread.comments.nodes.length === 0) continue;
      threadCommentCount += thread.comments.totalCount ?? thread.comments.nodes.length;
      if (thread.comments.pageInfo?.hasNextPage === true) truncated = true;
      const side: PullRequestDiffSide =
        thread.diffSide?.toUpperCase() === "LEFT" ? "left" : "right";
      reviewThreads.push({
        id,
        path,
        line: thread.line != null && thread.line > 0 ? thread.line : null,
        side,
        isResolved: thread.isResolved === true,
        isOutdated: thread.isOutdated === true,
        comments: thread.comments.nodes.map((comment) => ({
          id: comment.id,
          author: withAvatar(comment.author),
          body: comment.body ?? "",
          createdAt: comment.createdAt,
          url: trimmed(comment.url),
          reactions: toReactions(comment.reactionGroups, viewer),
        })),
      });
    }
  }

  const issueComments = (conversation.comments ?? []).map(
    (comment): PullRequestComment => ({
      id: comment.id,
      kind: "issue-comment",
      author: withAvatar(comment.author),
      body: comment.body ?? "",
      createdAt: comment.createdAt,
      url: trimmed(comment.url),
      path: null,
      reviewState: null,
      reactions: reactionsById.get(comment.id) ?? [],
    }),
  );
  const reviews = (conversation.reviews ?? []).flatMap((review): PullRequestComment[] => {
    const submittedAt = trimmed(review.submittedAt);
    const reviewState = trimmed(review.state);
    const body = review.body ?? "";
    if (submittedAt === null || (body.trim().length === 0 && !isVerdict(reviewState))) return [];
    const dismissed = reviewState?.toUpperCase() === "DISMISSED" && rendersEmpty(body);
    return [
      {
        id: review.id,
        kind: "review",
        author: withAvatar(review.author),
        body: dismissed ? (dismissals.get(review.id) ?? body) : body,
        createdAt: submittedAt,
        url: reviewUrls.get(review.id) ?? null,
        path: null,
        reviewState,
        reactions: reactionsById.get(review.id) ?? [],
      },
    ];
  });
  const lineComments = reviewThreads.flatMap((thread) =>
    thread.comments.map(
      (comment): PullRequestComment => ({
        ...comment,
        kind: "review-comment",
        path: thread.path,
        reviewState: null,
      }),
    ),
  );

  const commits = (pullRequest.commits?.nodes ?? []).flatMap((node): PullRequestCommit[] => {
    const commit = node?.commit;
    const committedDate = trimmed(commit?.committedDate);
    if (commit === undefined || committedDate === null) return [];
    const entry: PullRequestCommit = {
      oid: commit.oid,
      messageHeadline: commit.messageHeadline ?? "",
      committedDate,
      authors: (commit.authors?.nodes ?? []).flatMap((author) => {
        const person = author ? commitAuthor(author) : null;
        return person === null ? [] : [person];
      }),
    };
    if (commit.additions != null) entry.additions = commit.additions;
    if (commit.deletions != null) entry.deletions = commit.deletions;
    return [entry];
  });

  return {
    author: withAvatar(pullRequest.author),
    reviewers: toReviewers(pullRequest.reviewRequests, pullRequest.latestReviews),
    comments: [...issueComments, ...reviews, ...lineComments].toSorted((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
    commentCount: issueComments.length + reviews.length + threadCommentCount,
    commentsTruncated: truncated,
    reviewThreads,
    commits,
    reactions: toReactions(pullRequest.reactionGroups, viewer),
  };
}

export function filesToPatch(files: ChangedFile[]) {
  const sections: string[] = [];
  const omittedFileStats: PullRequestOmittedFileStat[] = [];
  for (const file of files) {
    const hunks = file.patch ?? "";
    const status = file.status?.trim().toLowerCase();
    if (hunks.length === 0) {
      const additions = file.additions ?? 0;
      const deletions = file.deletions ?? 0;
      if (additions + deletions > 0) {
        omittedFileStats.push({ path: file.filename, additions, deletions });
      }
    }
    const oldPath =
      status === "renamed" ? (trimmed(file.previous_filename) ?? file.filename) : file.filename;
    const header = [
      `diff --git a/${oldPath} b/${file.filename}`,
      ...(status === "added" ? ["new file mode 100644"] : []),
      ...(status === "removed" ? ["deleted file mode 100644"] : []),
      ...(status === "renamed" ? [`rename from ${oldPath}`, `rename to ${file.filename}`] : []),
      `--- ${status === "added" ? "/dev/null" : `a/${oldPath}`}`,
      `+++ ${status === "removed" ? "/dev/null" : `b/${file.filename}`}`,
    ].join("\n");
    sections.push(hunks.length === 0 ? `${header}\n` : `${header}\n${hunks.replace(/\n?$/, "\n")}`);
  }
  return {
    patch: sections.join(""),
    truncated: omittedFileStats.length > 0,
    omittedFileStats,
  };
}

export const REVIEW_EVENTS = {
  comment: "COMMENT",
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
} satisfies { [verdict in PullRequestReviewVerdict]: string };

export function toDraftThread(draft: PullRequestReviewCommentDraft) {
  return { path: draft.path, ...reviewAnchor(draft.position), body: draft.body };
}

type ReviewAnchor = { line: number; side: "LEFT" | "RIGHT" };

function reviewAnchor(position: PullRequestReviewPosition): ReviewAnchor {
  switch (position.kind) {
    case "added":
      return { line: position.newLine, side: "RIGHT" };
    case "deleted":
      return { line: position.oldLine, side: "LEFT" };
    case "context":
      return position.side === "left"
        ? { line: position.oldLine, side: "LEFT" }
        : { line: position.newLine, side: "RIGHT" };
  }
}

export function toReviewerCandidates(
  response: ReviewerCandidatesResponse,
): PullRequestReviewerCandidateList {
  const repository = response.data.repository;
  const author = trimmed(repository.pullRequest?.author?.login);
  const candidates = new Map<string, PullRequestReviewerCandidate>();
  for (const node of repository.pullRequest?.reviewRequests?.nodes ?? []) {
    const raw = node?.requestedReviewer;
    const slug = trimmed(raw?.slug);
    const id = slug ?? trimmed(raw?.login);
    if (id === null) continue;
    const kind: PullRequestReviewerKind = slug === null ? "user" : "team";
    candidates.set(`${kind} ${id}`, {
      id,
      kind,
      login: id,
      name: trimmed(raw?.name),
      avatarUrl: trimmed(raw?.avatarUrl),
      isRequested: true,
    });
  }
  for (const node of repository.assignableUsers.nodes) {
    const login = trimmed(node?.login);
    if (login === null || login === author || candidates.has(`user ${login}`)) continue;
    candidates.set(`user ${login}`, {
      id: login,
      kind: "user",
      login,
      name: trimmed(node?.name),
      avatarUrl: trimmed(node?.avatarUrl),
      isRequested: false,
    });
  }
  return {
    candidates: [...candidates.values()],
    truncated: repository.assignableUsers.pageInfo?.hasNextPage === true,
  };
}

export function reviewerRequestBody(reviewers: { id: string; kind: PullRequestReviewerKind }[]) {
  return JSON.stringify({
    reviewers: reviewers.filter((reviewer) => reviewer.kind === "user").map(({ id }) => id),
    team_reviewers: reviewers.filter((reviewer) => reviewer.kind === "team").map(({ id }) => id),
  });
}

export function subjectBelongs(response: SubjectScope) {
  const expected = response.data.repository?.pullRequest?.id ?? null;
  const node = response.data.node;
  const actual = node == null ? null : (node.pullRequest?.id ?? node.id);
  return expected !== null && expected === actual;
}
