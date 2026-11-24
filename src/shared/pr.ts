/**
 * The pull request viewer's data, as the main process reads it from GitHub and the PR page draws
 * it. The shapes follow T3 Code's pull request contract (packages/contracts/src/pullRequest.ts,
 * MIT), whose components the page is ported from, minus its multi-project fields.
 */

export type PullRequestState = "open" | "closed" | "merged";
export type PullRequestMergeability = "mergeable" | "conflicting" | "unknown";
export type PullRequestMergeMethod = "merge" | "squash" | "rebase";
export type PullRequestUpdateMethod = "merge" | "rebase";
export type PullRequestBaseComparison = "up-to-date" | "behind" | "unknown";
export type PullRequestChecksState = "passing" | "failing" | "pending";
export type PullRequestAction =
  | "merge"
  | "ready"
  | "draft"
  | "close"
  | "reopen"
  | "update-branch"
  | "enable-auto-merge"
  | "disable-auto-merge";

/** Which pull request: `owner/name` on github.com, and its number. */
export type PullRequestRef = { repository: string; number: number };

export type PullRequestActor = { login: string; name: string | null; avatarUrl: string | null };
export type PullRequestLabel = { name: string; color: string | null };

export type PullRequestCheckStatus =
  | "pending"
  | "success"
  | "failure"
  | "skipped"
  | "neutral"
  | "cancelled";

export type PullRequestCheck = {
  name: string;
  status: PullRequestCheckStatus;
  description: string | null;
  url: string | null;
};

export type PullRequestReactionContent =
  | "thumbs-up"
  | "thumbs-down"
  | "laugh"
  | "hooray"
  | "confused"
  | "heart"
  | "rocket"
  | "eyes";

export type PullRequestReaction = {
  content: PullRequestReactionContent;
  count: number;
  /** Logins of who reacted, as many as GitHub lists. */
  actors: string[];
  viewerHasReacted: boolean;
};

export type PullRequestCommentKind = "issue-comment" | "review-comment" | "review";

/** One remark in the conversation: a comment, a review's summary, or a line comment. */
export type PullRequestComment = {
  /** The GraphQL node id. */
  id: string;
  kind: PullRequestCommentKind;
  author: PullRequestActor | null;
  body: string;
  createdAt: string;
  url: string | null;
  /** The file a line comment is on. */
  path: string | null;
  /** A review's state as GitHub names it: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  reviewState: string | null;
  reactions?: PullRequestReaction[];
};

export type PullRequestDiffSide = "left" | "right";
export type PullRequestReviewVerdict = "comment" | "approve" | "request-changes";

export type PullRequestThreadComment = {
  id: string;
  author: PullRequestActor | null;
  body: string;
  createdAt: string;
  url: string | null;
  reactions?: PullRequestReaction[];
};

export type PullRequestReviewThread = {
  id: string;
  path: string;
  /** The line it is on, counted in the side's file; null for an outdated thread with no line. */
  line: number | null;
  side: PullRequestDiffSide;
  isResolved: boolean;
  isOutdated: boolean;
  comments: PullRequestThreadComment[];
};

export type PullRequestReviewerKind = "user" | "team";

export type PullRequestReviewerCandidate = PullRequestActor & {
  /** The login, or the team slug, that a review request names. */
  id: string;
  kind: PullRequestReviewerKind;
  isRequested: boolean;
};

export type PullRequestReviewerCandidateList = {
  candidates: PullRequestReviewerCandidate[];
  truncated: boolean;
};

export type PullRequestCommit = {
  oid: string;
  messageHeadline: string;
  committedDate: string;
  additions?: number;
  deletions?: number;
  authors?: PullRequestActor[];
};

export type PullRequestCapabilities = {
  diff: boolean;
  comment: boolean;
  actions: PullRequestAction[];
  mergeMethods: PullRequestMergeMethod[];
  updateMethods?: PullRequestUpdateMethod[];
  search: boolean;
  reactions?: boolean;
  review: {
    inlineComment: boolean;
    reply: boolean;
    resolve: boolean;
    verdicts: PullRequestReviewVerdict[];
  };
  reviewers: { request: boolean; listCandidates: boolean };
  edit?: { changeRequest: boolean; comment: boolean };
};

/** What this account may do here, beside what GitHub can do at all. */
export type PullRequestViewerPermissions = {
  actions: PullRequestAction[];
  comment: boolean;
  resolve: boolean;
  verdicts: PullRequestReviewVerdict[];
  requestReviewers: boolean;
  updateMethods?: PullRequestUpdateMethod[];
};

export type PullRequestMergeCapabilities = { merge: boolean; squash: boolean; rebase: boolean };

export type PullRequestDetail = {
  provider: "github";
  capabilities: PullRequestCapabilities;
  viewerPermissions: PullRequestViewerPermissions;
  /** The folder the viewer was opened in, which relative links in Markdown resolve against. */
  workspaceRoot: string;
  repository: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: PullRequestActor | null;
  state: PullRequestState;
  isDraft: boolean;
  mergeability: PullRequestMergeability;
  additions: number;
  deletions: number;
  changedFiles: number;
  headBranch: string;
  baseBranch: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  reviewers: PullRequestActor[];
  labels: PullRequestLabel[];
  checks: PullRequestCheck[];
  mergeCapabilities: PullRequestMergeCapabilities;
  /** The viewer's login. */
  viewer?: string;
  baseComparison?: PullRequestBaseComparison;
  behindBy?: number;
  autoMergeEnabled?: boolean;
};

export type PullRequestActivity = {
  author?: PullRequestActor | null;
  reviewers?: PullRequestActor[];
  comments: PullRequestComment[];
  commentCount: number;
  commentsTruncated: boolean;
  reviewThreads: PullRequestReviewThread[];
  commits: PullRequestCommit[];
  reactions?: PullRequestReaction[];
};

export type PullRequestDetailView = PullRequestDetail &
  PullRequestActivity & { author: PullRequestActor | null; reviewers: PullRequestActor[] };

export type PullRequestDiffInput = PullRequestRef & { cursor?: string; commit?: string };

export type PullRequestOmittedFileStat = { path: string; additions: number; deletions: number };

export type PullRequestDiffResult = {
  /** A unified git patch of whole files. */
  patch: string;
  /** True when GitHub withheld part of the change, such as a file too large to show. */
  truncated: boolean;
  /** Where the next slice of files starts, when the change is read in slices. */
  nextCursor: string | null;
  omittedFileStats?: PullRequestOmittedFileStat[];
};

export type PullRequestDiffFileContentsInput = PullRequestRef & {
  commit?: string;
  changeType: "change" | "rename-pure" | "rename-changed" | "new" | "deleted";
  oldPath: string;
  newPath: string;
};

export type PullRequestDiffFileContentsResult = { oldContents: string; newContents: string };

export type PullRequestActionInput = PullRequestRef & {
  action: PullRequestAction;
  mergeMethod?: PullRequestMergeMethod;
  updateMethod?: PullRequestUpdateMethod;
};

export type PullRequestCommentInput = PullRequestRef & { body: string };

export type PullRequestUpdateInput = PullRequestRef & { title?: string; body?: string };

export type PullRequestCommentUpdateInput = PullRequestRef & {
  commentId: string;
  kind: "issue-comment" | "review-comment";
  body: string;
};

export type PullRequestReviewPosition =
  | { kind: "added"; newLine: number }
  | { kind: "deleted"; oldLine: number }
  | { kind: "context"; oldLine: number; newLine: number; side: PullRequestDiffSide };

export type PullRequestReviewCommentDraft = {
  path: string;
  oldPath?: string;
  position: PullRequestReviewPosition;
  body: string;
};

export type PullRequestSubmitReviewInput = PullRequestRef & {
  verdict: PullRequestReviewVerdict;
  body: string;
  comments: PullRequestReviewCommentDraft[];
};

export type PullRequestThreadReplyInput = PullRequestRef & { threadId: string; body: string };

export type PullRequestThreadResolutionInput = PullRequestRef & {
  threadId: string;
  resolved: boolean;
};

export type PullRequestReactionInput = PullRequestRef & {
  /** The comment reacted to; absent for the pull request itself. */
  subjectId?: string;
  content: PullRequestReactionContent;
  reacted: boolean;
};

export type PullRequestReviewerRequestInput = PullRequestRef & {
  reviewers: { id: string; kind: PullRequestReviewerKind }[];
  requested: boolean;
};

/** Everything the PR page can ask the main process, by name, with what each takes and returns. */
export type PullRequestApi = {
  detail(input: PullRequestRef): PullRequestDetail;
  activity(input: PullRequestRef): PullRequestActivity;
  diff(input: PullRequestDiffInput): PullRequestDiffResult;
  diffFileContents(input: PullRequestDiffFileContentsInput): PullRequestDiffFileContentsResult;
  runAction(input: PullRequestActionInput): null;
  comment(input: PullRequestCommentInput): null;
  update(input: PullRequestUpdateInput): null;
  updateComment(input: PullRequestCommentUpdateInput): null;
  submitReview(input: PullRequestSubmitReviewInput): null;
  replyToThread(input: PullRequestThreadReplyInput): null;
  setThreadResolution(input: PullRequestThreadResolutionInput): null;
  setReaction(input: PullRequestReactionInput): null;
  reviewerCandidates(input: PullRequestRef): PullRequestReviewerCandidateList;
  requestReviewers(input: PullRequestReviewerRequestInput): null;
};

export type PullRequestMethod = keyof PullRequestApi;

/** Every method of `PullRequestApi`, for checking a name that arrives over IPC. */
export const PULL_REQUEST_METHODS = [
  "detail",
  "activity",
  "diff",
  "diffFileContents",
  "runAction",
  "comment",
  "update",
  "updateComment",
  "submitReview",
  "replyToThread",
  "setThreadResolution",
  "setReaction",
  "reviewerCandidates",
  "requestReviewers",
] as const satisfies readonly PullRequestMethod[];

export const PR_CHANNEL = "claudesaurus:pr";

/** What the main process gives the PR page, through the preload. */
export type PrBridge = {
  /** The pull request this viewer was opened on, and where it was opened from. */
  target(): Promise<PrContext>;
  call<M extends PullRequestMethod>(
    method: M,
    input: Parameters<PullRequestApi[M]>[0],
  ): Promise<ReturnType<PullRequestApi[M]>>;
  /** Opens a Claudesaurus chat beside the viewer, with a task waiting in its composer. */
  handoff(input: PrHandoff): Promise<PrHandoffResult>;
  /** Puts text on the clipboard of the computer the terminal runs on. */
  copy(text: string): void;
  quit(): void;
};

export type PrContext = {
  reference: PullRequestRef;
  /**
   * Whether a chat opened this viewer from a link. Its tasks then go to that chat's composer, as
   * T3 Code's go to the thread its pull request panel sits beside.
   */
  openedFromChat: boolean;
};

/** A task handed from the viewer to a new Claudesaurus chat, as T3 Code hands one to a thread. */
export type PrHandoff = {
  reference: PullRequestRef;
  /** What to leave in the chat's composer; null opens the chat empty. */
  prompt: string | null;
  /** Where the chat works: on the branch in a new worktree, here after checking it out, or here. */
  checkout: "worktree" | "local" | null;
};

export type PrHandoffResult = {
  /** The chat that holds the task: the one that opened the viewer, or a new one beside it. */
  chat: "opened-from" | "new";
  cwd: string;
  branch: string | null;
  /** False when the checkout could not be moved onto the pull request's newest commit. */
  isOnPullRequestHead: boolean;
};
