import {
  ArrowDownUpIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
  CircleDotIcon,
  FileDiffIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  HammerIcon,
  LinkIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PullRequestAction,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestUpdateMethod,
} from "~/contracts";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { openLink } from "~/lib/links";
import {
  prBridge,
  prQuery,
  refreshAllQueries,
  usePrCommand,
  usePrQuery,
  useRefreshOnFocus,
} from "~/lib/prApi";
import { cn } from "~/lib/utils";
import { formatReviewCommentFence, type ReviewCommentContext } from "~/reviewCommentContext";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { DiffPanelLoadingState } from "../DiffPanelShell";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { PullRequestActivityUnavailableState } from "./PullRequestActivityUnavailableState";
import { PullRequestChecksPopover } from "./PullRequestChecksPopover";
import type { PullRequestAskSelectionInput } from "./PullRequestCodeTab";
import { PullRequestDetailGhost, PullRequestTimelineGhost } from "./PullRequestGhosts";
import { PullRequestSummaryTab } from "./PullRequestSummaryTab";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";
import { PullRequestTimelineTab } from "./PullRequestTimelineTab";
import {
  buildAskAboutLinesHandoff,
  buildAskAboutPullRequestHandoff,
  buildExplainPullRequestHandoff,
  buildFixFindingHandoff,
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  type PullRequestFinding,
  pullRequestActionMenuHasGroup,
  pullRequestActionNeedsHostRefresh,
  pullRequestFindingKey,
  pullRequestHandoffLabels,
  readableFailure,
  resolveBaseFreshness,
} from "./pullRequestDetail.logic";
import { canEditPullRequestChangeRequest } from "./pullRequestEditing.logic";
import {
  PullRequestActorLabel,
  PullRequestDiffStat,
  PullRequestMetaLine,
  pullRequestChecksState,
  resolvePullRequestState,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";

type DetailTab = "summary" | "timeline" | "code";

const ACTION_SUCCESS_LABELS: Record<PullRequestAction, string> = {
  merge: "Pull request merged",
  ready: "Marked ready for review",
  draft: "Converted to draft",
  close: "Pull request closed",
  reopen: "Pull request reopened",
  "update-branch": "Branch updated with the base branch",
  "enable-auto-merge":
    "Auto-merge turned on — merges as soon as this is ready, sooner if it already is",
  "disable-auto-merge": "Auto-merge turned off",
};

const ACTION_FAILURE_LABELS: Record<PullRequestAction, string> = {
  merge: "Could not merge this pull request",
  ready: "Could not mark this ready for review",
  draft: "Could not convert this to a draft",
  close: "Could not close this pull request",
  reopen: "Could not reopen this pull request",
  "update-branch": "Could not update this branch",
  "enable-auto-merge": "Could not turn on auto-merge",
  "disable-auto-merge": "Could not turn off auto-merge",
};

const ACTION_FAILURE_HINTS: Record<PullRequestAction, string> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  draft: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen:
    "The host refused it. Check that you have write access, and that the branch still exists.",
  "update-branch":
    "The host refused it. Check that you have write access to the branch — one from a fork also needs its author to allow edits from maintainers — and that it does not conflict with the base.",
  "enable-auto-merge":
    "The host refused it. Check that this repository allows auto-merge, that you have write access, and that there is something left for it to wait on.",
  "disable-auto-merge":
    "The host refused it. Check that you have write access, and that the merge has not already happened.",
};

const UPDATE_BRANCH_REBASE_FAILURE_HINT =
  "The host refused it. A rebase stops at the first commit that does not apply cleanly; updating with a merge commit may still work.";

const TABS: ReadonlyArray<{ value: DetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

const loadCodeTab = () => import("./PullRequestCodeTab");
const PullRequestCodeTab = lazy(loadCodeTab);

function PullRequestBaseFreshnessWarning({
  baseBranch,
  freshness,
  pending,
  onUpdate,
  iconClassName,
}: {
  readonly baseBranch: string;
  readonly freshness: {
    readonly behindBy: number | null;
    readonly methods: ReadonlyArray<PullRequestUpdateMethod>;
  };
  readonly pending: boolean;
  readonly onUpdate: (method: PullRequestUpdateMethod) => void;
  readonly iconClassName?: string;
}) {
  const behind =
    freshness.behindBy === null
      ? ""
      : ` by ${freshness.behindBy.toLocaleString()} ${
          freshness.behindBy === 1 ? "commit" : "commits"
        }`;
  const summary = `This branch is out-of-date with ${baseBranch}${behind}.`;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={120}
        render={
          <button
            type="button"
            aria-label={summary}
            className="inline-flex shrink-0 cursor-help items-center rounded-sm text-amber-600 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <TriangleAlertIcon aria-hidden className={cn("size-3.5", iconClassName)} />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="bottom"
        className="max-w-80"
        viewportClassName="py-2.5 [--viewport-inline-padding:--spacing(3)]"
      >
        <p className="text-xs text-foreground">{summary}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Changes can be cleanly merged.</p>
        {freshness.methods.length > 0 ? (
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {freshness.methods.map((method) => (
              <Button
                key={method}
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => onUpdate(method)}
              >
                <GitMergeIcon aria-hidden className="size-3" />
                {method === "rebase" ? "Update with rebase" : "Update branch"}
              </Button>
            ))}
          </span>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

export function PullRequestDetailPanel({
  reference,
  openedFromChat,
  chromeVariant = "collapse",
}: {
  reference: PullRequestRef;
  openedFromChat: boolean;
  chromeVariant?: "full" | "collapse";
}) {
  const pullRequestKey = `${reference.repository}#${reference.number}`;
  const [tab, setTab] = useState<DetailTab>("summary");
  const [timelineOrder, setTimelineOrder] = useState<"newest" | "oldest">("newest");
  const [codeCommitScope, setCodeCommitScope] = useState<{
    readonly pullRequestKey: string;
    readonly oid: string | null;
  }>(() => ({ pullRequestKey, oid: null }));
  const selectedCodeCommitOid =
    codeCommitScope.pullRequestKey === pullRequestKey ? codeCommitScope.oid : null;
  const selectCodeCommit = (oid: string | null) => {
    setCodeCommitScope({ pullRequestKey, oid });
  };
  const openCommit = (oid: string) => {
    selectCodeCommit(oid);
    setTab("code");
  };
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<DetailTab>>(
    () => new Set<DetailTab>(["summary"]),
  );
  useEffect(() => {
    setMountedTabs((previous) =>
      previous.has(tab) ? previous : new Set<DetailTab>(previous).add(tab),
    );
  }, [tab]);
  const [chromeCondensed, setChromeCondensed] = useState(false);
  const chromeStateByTab = useRef<Partial<Record<DetailTab, boolean>>>({});
  useEffect(() => {
    setChromeCondensed(chromeStateByTab.current[tab] ?? false);
  }, [tab]);
  const condensed = chromeVariant === "collapse" && chromeCondensed;
  const scrollerRef = useRef<HTMLElement | null>(null);
  const foldRef = useRef<HTMLDivElement | null>(null);
  const condensedRowRef = useRef<HTMLDivElement | null>(null);
  const compensationRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (compensationRef.current === null) return;
    const scroller = scrollerRef.current;
    const delta = compensationRef.current;
    compensationRef.current = null;
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
  }, [condensed]);
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>("merge");
  const [confirmAction, setConfirmAction] = useState<
    "merge" | "close" | "enable-auto-merge" | null
  >(null);
  const [handoff, setHandoff] = useState<string | null>(null);
  const { copyToClipboard: copyBranchToClipboard, isCopied: isBranchCopied } = useCopyToClipboard({
    target: "branch name",
    timeout: 1600,
  });

  useEffect(() => {
    void loadCodeTab();
  }, []);

  const detailQuery = usePrQuery(prQuery("detail", { input: reference }));
  const activityQuery = usePrQuery(prQuery("activity", { input: reference }));
  const _diffWarmUpQuery = usePrQuery(prQuery("diff", { input: { ...reference } }));
  const coreDetail = detailQuery.data;
  const activity = activityQuery.data;
  const detail = useMemo(
    () =>
      coreDetail === null
        ? null
        : {
            ...coreDetail,
            author: activity?.author ?? coreDetail.author,
            reviewers: activity?.reviewers ?? coreDetail.reviewers,
            comments: activity?.comments ?? [],
            commentCount: activity?.commentCount ?? 0,
            commentsTruncated: activity?.commentsTruncated ?? false,
            reviewThreads: activity?.reviewThreads ?? [],
            commits: activity?.commits ?? [],
            reactions: activity?.reactions ?? [],
          },
    [activity, coreDetail],
  );
  const activityPending = activityQuery.isPending && activity === null;
  const activityError = activity === null ? activityQuery.error : null;
  const refreshDetail = useCallback(() => {
    detailQuery.refresh();
    activityQuery.refresh();
  }, [activityQuery.refresh, detailQuery.refresh]);
  useRefreshOnFocus(refreshDetail);
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshFromHost = useCallback(() => {
    refreshAllQueries();
    setRefreshToken((token) => token + 1);
  }, []);
  const runAction = usePrCommand("runAction");
  const [pendingAction, setPendingAction] = useState<PullRequestAction | null>(null);
  const actionPending = pendingAction !== null;
  const update = usePrCommand("update");
  const [titleScope, setTitleScope] = useState<{
    readonly pullRequestKey: string;
    readonly text: string;
  } | null>(null);
  const titleDraft = titleScope?.pullRequestKey === pullRequestKey ? titleScope.text : null;
  const [titleSaving, setTitleSaving] = useState(false);
  const perform = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    if (pendingAction !== null) return;
    setPendingAction(action);
    const result = await runAction({
      input: {
        ...reference,
        action,
        ...(method ? { mergeMethod: method } : {}),
        ...(updateMethod ? { updateMethod } : {}),
      },
    });
    setPendingAction(null);
    if (result._tag === "Failure") {
      const failure = result.error;
      const hint =
        updateMethod === "rebase"
          ? UPDATE_BRANCH_REBASE_FAILURE_HINT
          : ACTION_FAILURE_HINTS[action];
      toastManager.add({
        type: "error",
        title: ACTION_FAILURE_LABELS[action],
        description: readableFailure(failure, hint),
      });
      return;
    }
    toastManager.add({ type: "success", title: ACTION_SUCCESS_LABELS[action] });
    if (pullRequestActionNeedsHostRefresh(action)) {
      refreshFromHost();
    } else {
      refreshDetail();
    }
  };

  const saveTitle = async (next: string) => {
    const title = next.trim();
    if (detail === null || titleSaving) return;
    if (title.length === 0 || title === detail.title) {
      setTitleScope(null);
      return;
    }
    setTitleSaving(true);
    const result = await update({ input: { ...reference, title } });
    setTitleSaving(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "The title could not be saved",
        description: readableFailure(result.error, "The host refused the new title."),
      });
      return;
    }
    setTitleScope(null);
    refreshDetail();
  };

  type ThreadTask = {
    prompt: string;
    reviewComments?: ReadonlyArray<ReviewCommentContext>;
  };

  const handoffLabels = pullRequestHandoffLabels(openedFromChat);

  const composerDraft = (task: ThreadTask) => {
    const context = (task.reviewComments ?? []).map((comment) =>
      comment.diff.trim().length === 0
        ? comment.text.trim()
        : `${comment.text.trim()}\n\n${formatReviewCommentFence(comment.fenceLanguage ?? "diff", comment.diff)}`,
    );
    const prompt = task.prompt.trim();
    const text = [prompt, ...context].filter((part) => part.length > 0).join("\n\n");
    return prompt.length > 0 ? text : `${text}\n\n`;
  };

  const startHandoff = async (
    kind: string,
    task: ThreadTask | null,
    requestedCheckout: "worktree" | "local" | null = "worktree",
  ) => {
    if (!detail || handoff !== null) return;
    const checkout = openedFromChat && task !== null ? null : requestedCheckout;
    setHandoff(kind);
    const toastId = toastManager.add({
      type: "loading",
      title: checkout === null ? "Opening a chat..." : "Preparing the pull request checkout...",
    });
    const prompt = task === null ? null : composerDraft(task);
    try {
      const opened = await prBridge().handoff({ reference, prompt, checkout });
      if (opened.chat === "opened-from") {
        toastManager.update(toastId, {
          type: "success",
          title: "Added to the composer",
          description: "The task is in the chat's composer — read it over, then send.",
        });
        return;
      }
      toastManager.update(toastId, {
        type: opened.isOnPullRequestHead ? "success" : "warning",
        title: opened.isOnPullRequestHead
          ? task === null
            ? "Checked out"
            : "Opened a chat"
          : "Checked out, but not on the latest commits",
        description: opened.isOnPullRequestHead
          ? task === null
            ? `On \`${opened.branch}\`, with a chat open in ${opened.cwd}.`
            : "The task is in the composer — read it over, then send."
          : "The checkout could not be moved onto the pull request's latest commits, so the code there is older than the pull request. Uncommitted work or local commits keep it where it is.",
      });
    } catch (error) {
      toastManager.update(toastId, {
        type: "error",
        title: checkout === null ? "Could not open a chat" : "Could not check out the pull request",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setHandoff(null);
    }
  };

  const startAsk = (kind: string, task: ThreadTask) => void startHandoff(kind, task, null);

  const askAboutPullRequest = () => {
    if (!detail) return;
    void startAsk("ask", {
      ...buildAskAboutPullRequestHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
      }),
    });
  };

  const explainPullRequest = () => {
    if (!detail) return;
    void startAsk("explain", {
      ...buildExplainPullRequestHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
      }),
    });
  };

  const askAboutSelection = (selection: PullRequestAskSelectionInput) => {
    if (!detail) return;
    void startAsk(`ask:${selection.comment.id}`, {
      ...buildAskAboutLinesHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        comment: selection.comment,
        question: selection.question,
      }),
    });
  };

  const startCheckout = (mode: "worktree" | "local") => {
    if (!detail) return;
    void startHandoff(`checkout:${mode}`, null, mode);
  };

  const startFixFinding = (finding: PullRequestFinding) => {
    if (!detail) return;
    void startHandoff(
      pullRequestFindingKey(finding),
      buildFixFindingHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        finding,
      }),
    );
  };

  const startFixFindings = () => {
    if (!detail) return;
    void startHandoff(
      "findings",
      buildFixFindingsHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        reviewThreads: detail.reviewThreads,
        comments: detail.comments,
        checks: detail.checks,
        commentsTruncated: detail.commentsTruncated,
      }),
    );
  };

  const startResolveConflicts = () => {
    if (!detail) return;
    void startHandoff("conflicts", {
      prompt: buildResolveConflictsPrompt({
        number: detail.number,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
      }),
    });
  };

  const allowedMergeMethods = detail
    ? detail.capabilities.mergeMethods.filter((method) => detail.mergeCapabilities[method])
    : [];
  const selectedMergeMethod = allowedMergeMethods.includes(mergeMethod)
    ? mergeMethod
    : (allowedMergeMethods[0] ?? "merge");
  const conflicting = detail?.state === "open" && detail.mergeability === "conflicting";
  const autoMergeArmed = detail?.state === "open" && detail.autoMergeEnabled === true;
  const freshness = detail === null ? null : resolveBaseFreshness(detail);
  const visibleTabs = TABS.filter(
    (item) => item.value !== "code" || detail === null || detail.capabilities.diff,
  );
  useEffect(() => {
    if (!visibleTabs.some((item) => item.value === tab)) setTab("summary");
  }, [tab, visibleTabs]);
  const can = (action: PullRequestAction) =>
    detail?.capabilities.actions.includes(action) === true &&
    detail.viewerPermissions.actions.includes(action);
  const primaryAction =
    detail === null || detail.state !== "open"
      ? null
      : detail.isDraft && can("ready")
        ? "ready"
        : !can("merge")
          ? null
          : conflicting
            ? "resolve"
            : allowedMergeMethods.length > 0
              ? "merge"
              : null;
  const showsDraftToggle =
    detail?.state === "open" &&
    can(detail.isDraft ? "ready" : "draft") &&
    !(detail.isDraft && primaryAction === "ready");
  const showsAutoMerge =
    detail?.state === "open" &&
    ((autoMergeArmed && can("disable-auto-merge")) ||
      (!autoMergeArmed &&
        !detail.isDraft &&
        !conflicting &&
        can("enable-auto-merge") &&
        allowedMergeMethods.length > 0));
  const showsMergeMethods =
    detail?.state === "open" &&
    can("merge") &&
    !detail.isDraft &&
    !conflicting &&
    allowedMergeMethods.length > 1;
  const statePresentation = detail
    ? resolvePullRequestState({ state: detail.state, isDraft: detail.isDraft })
    : null;
  const checksSummary = detail ? summarizePullRequestChecks(detail.checks) : null;
  const checksState = detail ? pullRequestChecksState(detail.checks) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b border-border/60">
        <div className="ml-4 grid h-11 min-w-0 items-center">
          <div
            aria-hidden={condensed}
            inert={condensed ? "" : undefined}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-opacity sm:text-xs motion-reduce:transition-none",
              condensed
                ? "pointer-events-none opacity-0 duration-100"
                : "opacity-100 delay-75 duration-150",
            )}
          >
            {detail && statePresentation ? (
              <>
                <span className="min-w-0 truncate" title={detail.repository}>
                  {detail.repository}
                </span>
                <button
                  type="button"
                  onClick={() => openLink(detail.url)}
                  className={cn(
                    "shrink-0 font-medium underline-offset-2 hover:underline",
                    statePresentation.toneClassName,
                  )}
                  title="Copy link"
                  aria-label={`Copy the link to pull request #${detail.number}`}
                >
                  #{detail.number}
                </button>
              </>
            ) : null}
          </div>
          <div
            aria-hidden={!condensed}
            inert={condensed ? undefined : ""}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-sm transition-opacity sm:text-xs motion-reduce:transition-none",
              condensed
                ? "opacity-100 delay-75 duration-150"
                : "pointer-events-none opacity-0 duration-100",
            )}
          >
            {detail && statePresentation ? (
              <>
                <button
                  type="button"
                  tabIndex={condensed ? 0 : -1}
                  onClick={() => openLink(detail.url)}
                  className={cn(
                    "shrink-0 font-medium underline-offset-2 hover:underline",
                    statePresentation.toneClassName,
                  )}
                  title="Copy link"
                  aria-label={`Copy the link to pull request #${detail.number}`}
                >
                  #{detail.number}
                </button>
                <span className="min-w-0 truncate font-medium text-foreground" title={detail.title}>
                  {detail.title}
                </span>
                {conflicting ? (
                  <Badge
                    variant="error"
                    className="h-5 shrink-0 gap-1 rounded px-1.5 text-[10px] text-destructive"
                  >
                    <TriangleAlertIcon className="size-3" />
                    Conflicts
                  </Badge>
                ) : checksSummary ? (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    {detail && checksState !== null ? (
                      <PullRequestChecksPopover checks={detail.checks} checksState={checksState} />
                    ) : null}
                    {checksSummary}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="mr-4 flex h-11 min-w-0 flex-nowrap items-center justify-end gap-1">
          {detail ? (
            <>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      aria-label="More pull request actions"
                      className="size-6"
                      size="icon-xs"
                      variant="ghost-muted"
                    />
                  }
                >
                  <MoreHorizontalIcon className="size-4" />
                </MenuTrigger>
                <MenuPopup align="end" side="bottom" className="min-w-72">
                  <MenuItem disabled={detailQuery.isPending} onClick={() => void refreshFromHost()}>
                    <RefreshCwIcon className="size-3.5" />
                    Refresh
                  </MenuItem>
                  <MenuItem disabled={handoff !== null} onClick={askAboutPullRequest}>
                    <MessageCircleQuestionIcon className="mt-0.5 size-3.5 shrink-0 self-start" />
                    <span className="flex min-w-0 flex-col">
                      <span>{handoff === "ask" ? "Opening..." : "Ask a question"}</span>
                      <span className="text-xs text-muted-foreground">
                        {openedFromChat
                          ? "Adds the pull request to the chat's composer."
                          : "Opens a chat that knows which pull request you mean."}
                      </span>
                    </span>
                  </MenuItem>
                  <MenuItem disabled={handoff !== null} onClick={explainPullRequest}>
                    <BookOpenIcon className="mt-0.5 size-3.5 shrink-0 self-start" />
                    <span className="flex min-w-0 flex-col">
                      <span>{handoff === "explain" ? "Opening..." : "Explain this PR"}</span>
                      <span className="text-xs text-muted-foreground">
                        A walk through the diff and what to read closely.
                      </span>
                    </span>
                  </MenuItem>
                  <MenuItem disabled={handoff !== null} onClick={startFixFindings}>
                    <HammerIcon className="size-3.5" />
                    {handoff === "findings" ? "Preparing..." : handoffLabels.fixFindings}
                  </MenuItem>
                  <MenuSeparator />
                  {detail.state === "open" ? (
                    <>
                      {showsDraftToggle ? (
                        <MenuItem
                          disabled={actionPending}
                          onClick={() => void perform(detail.isDraft ? "ready" : "draft")}
                        >
                          {detail.isDraft ? (
                            <GitPullRequestIcon className="size-3.5" />
                          ) : (
                            <GitPullRequestDraftIcon className="size-3.5" />
                          )}
                          {detail.isDraft ? "Ready for review" : "Convert to draft"}
                        </MenuItem>
                      ) : null}
                      {autoMergeArmed && can("disable-auto-merge") ? (
                        <MenuItem
                          disabled={actionPending}
                          onClick={() => void perform("disable-auto-merge")}
                        >
                          <GitMergeIcon className="size-3.5" />
                          Disable auto-merge
                        </MenuItem>
                      ) : !autoMergeArmed &&
                        !detail.isDraft &&
                        !conflicting &&
                        can("enable-auto-merge") &&
                        allowedMergeMethods.length > 0 ? (
                        <MenuItem
                          disabled={actionPending}
                          onClick={() => setConfirmAction("enable-auto-merge")}
                        >
                          <GitMergeIcon className="size-3.5" />
                          Enable auto-merge
                        </MenuItem>
                      ) : null}
                      {showsMergeMethods ? (
                        <>
                          {showsDraftToggle ? <MenuSeparator /> : null}
                          <MenuRadioGroup
                            value={selectedMergeMethod}
                            onValueChange={(method) =>
                              setMergeMethod(method as PullRequestMergeMethod)
                            }
                          >
                            {allowedMergeMethods.map((method) => (
                              <MenuRadioItem key={method} value={method} disabled={actionPending}>
                                <span className="flex min-w-0 items-center gap-2">
                                  <GitMergeIcon className="size-3.5" />
                                  <span className="capitalize">{method}</span>
                                </span>
                              </MenuRadioItem>
                            ))}
                          </MenuRadioGroup>
                        </>
                      ) : null}
                      {pullRequestActionMenuHasGroup(
                        showsDraftToggle,
                        showsAutoMerge,
                        showsMergeMethods,
                      ) ? (
                        <MenuSeparator />
                      ) : null}
                    </>
                  ) : null}
                  <MenuItem onClick={() => openLink(detail.url)}>
                    <LinkIcon className="size-3.5" />
                    Copy link
                  </MenuItem>
                  {conflicting && primaryAction !== "resolve" ? (
                    <MenuItem disabled={handoff !== null} onClick={startResolveConflicts}>
                      <GitMergeIcon className="size-3.5" />
                      {handoff === "conflicts" ? "Preparing..." : handoffLabels.resolveConflicts}
                    </MenuItem>
                  ) : null}
                  {detail.state === "open" && can("close") ? (
                    <>
                      <MenuSeparator />
                      <MenuItem
                        variant="destructive"
                        disabled={actionPending}
                        onClick={() => setConfirmAction("close")}
                      >
                        <GitPullRequestClosedIcon className="size-3.5" />
                        Close pull request
                      </MenuItem>
                    </>
                  ) : detail.state === "closed" && can("reopen") ? (
                    <>
                      <MenuSeparator />
                      <MenuItem disabled={actionPending} onClick={() => void perform("reopen")}>
                        <GitPullRequestIcon className="size-3.5" />
                        Reopen pull request
                      </MenuItem>
                    </>
                  ) : null}
                </MenuPopup>
              </Menu>
              <Menu>
                <MenuTrigger
                  disabled={handoff !== null}
                  render={
                    <Button size="xs" variant="outline">
                      {handoff?.startsWith("checkout") ? (
                        "Checking out..."
                      ) : (
                        <>
                          <GitBranchIcon className="size-3" />
                          Check out
                          <ChevronDownIcon className="size-3 text-muted-foreground" />
                        </>
                      )}
                    </Button>
                  }
                />
                <MenuPopup align="end" side="bottom" className="min-w-72">
                  <MenuItem onClick={() => startCheckout("worktree")}>
                    <GitBranchIcon className="mt-0.5 size-3.5 shrink-0 self-start" />
                    <span className="flex min-w-0 flex-col">
                      <span>In a separate worktree</span>
                      <span className="text-xs text-muted-foreground">
                        Its own folder and chat. Nothing you have open moves.
                      </span>
                    </span>
                  </MenuItem>
                  <MenuItem onClick={() => startCheckout("local")}>
                    <FolderGit2Icon className="mt-0.5 size-3.5 shrink-0 self-start" />
                    <span className="flex min-w-0 flex-col">
                      <span>In this repository</span>
                      <span className="text-xs text-muted-foreground">
                        Switches the branch you are working in, like `gh pr checkout`.
                      </span>
                    </span>
                  </MenuItem>
                </MenuPopup>
              </Menu>
              {autoMergeArmed ? (
                <Badge
                  variant="info"
                  className="h-5 shrink-0 gap-1 rounded px-1.5 text-[10px]"
                  title="The host will merge this on its own once its requirements are met"
                >
                  <GitMergeIcon aria-hidden className="size-3" />
                  Auto-merge
                </Badge>
              ) : null}
              {primaryAction === "ready" ? (
                <Button size="xs" disabled={actionPending} onClick={() => void perform("ready")}>
                  Ready for review
                </Button>
              ) : primaryAction === "merge" ? (
                <Button
                  size="xs"
                  disabled={actionPending}
                  onClick={() => setConfirmAction("merge")}
                >
                  {pendingAction === "merge" ? "Merging..." : "Merge"}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            condensed
              ? "grid-rows-[1fr]"
              : "grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={condensedRowRef}
            className={cn(
              "min-h-0 overflow-hidden",
              condensed
                ? "opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none"
                : "opacity-0",
            )}
            inert={condensed ? undefined : ""}
          >
            {detail ? (
              <div className="flex min-w-0 items-center gap-1 px-4 pb-2">
                <nav aria-label="Pull request tabs" className="flex shrink-0 items-center gap-0.5">
                  {visibleTabs.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      tabIndex={condensed ? 0 : -1}
                      aria-pressed={tab === item.value}
                      onClick={() => setTab(item.value)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] transition-colors",
                        tab === item.value
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
                <span
                  className="ml-auto inline-flex min-w-0 shrink items-center gap-1 font-mono text-[11px] text-muted-foreground"
                  title={`${detail.baseBranch} ← ${detail.headBranch}`}
                >
                  <span className="truncate">{detail.baseBranch}</span>
                  {freshness ? (
                    <PullRequestBaseFreshnessWarning
                      baseBranch={detail.baseBranch}
                      freshness={freshness}
                      pending={actionPending}
                      onUpdate={(method) => void perform("update-branch", undefined, method)}
                      iconClassName="size-3"
                    />
                  ) : null}
                  <ArrowLeftIcon aria-label="receives changes from" className="size-3 shrink-0" />
                  <span className="truncate">{detail.headBranch}</span>
                </span>
                <span className="ml-2 inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <FileDiffIcon className="size-3" />
                    {detail.changedFiles.toLocaleString()}
                  </span>
                  <PullRequestDiffStat
                    additions={detail.additions}
                    deletions={detail.deletions}
                    className="shrink-0 font-mono text-[11px]"
                  />
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            condensed
              ? "grid-rows-[0fr]"
              : "grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={foldRef}
            className={cn(
              "min-h-0 overflow-hidden",
              condensed
                ? "opacity-0"
                : "opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none",
            )}
            inert={condensed ? "" : undefined}
          >
            {detail ? (
              <div className="col-span-2 mt-3 min-w-0 px-4 pb-4">
                {titleDraft === null ? (
                  <div className="group flex min-w-0 items-start gap-1">
                    <h1 className="min-w-0 flex-1 text-base font-semibold leading-snug">
                      {detail.title}
                    </h1>
                    {canEditPullRequestChangeRequest(detail) ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label="Edit title"
                        onClick={() => setTitleScope({ pullRequestKey, text: detail.title })}
                      >
                        <PencilIcon className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      autoFocus
                      size="sm"
                      disabled={titleSaving}
                      value={titleDraft}
                      aria-label="Pull request title"
                      onChange={(event) =>
                        setTitleScope({ pullRequestKey, text: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveTitle(titleDraft);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setTitleScope(null);
                        }
                      }}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={titleSaving}
                        onClick={() => setTitleScope(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={titleSaving || titleDraft.trim().length === 0}
                        onClick={() => void saveTitle(titleDraft)}
                      >
                        {titleSaving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                )}
                <PullRequestMetaLine className="mt-2 text-xs text-muted-foreground">
                  <PullRequestActorLabel actor={detail.author} className="font-medium" />
                  <span>updated {formatRelativeTimeLabel(detail.updatedAt)}</span>
                </PullRequestMetaLine>

                <div className="mt-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <code
                    className="min-w-0 max-w-48 shrink truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground"
                    title={detail.baseBranch}
                  >
                    {detail.baseBranch}
                  </code>
                  {freshness ? (
                    <PullRequestBaseFreshnessWarning
                      baseBranch={detail.baseBranch}
                      freshness={freshness}
                      pending={actionPending}
                      onUpdate={(method) => void perform("update-branch", undefined, method)}
                    />
                  ) : null}
                  <ArrowLeftIcon aria-label="receives changes from" className="size-4 shrink-0" />
                  <button
                    type="button"
                    className="grid min-w-0 max-w-64 shrink cursor-pointer rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                    aria-label={isBranchCopied ? "Branch name copied" : "Copy pull request branch"}
                    title={isBranchCopied ? "Copied" : "Copy pull request branch"}
                    onClick={() => copyBranchToClipboard(detail.headBranch)}
                  >
                    <code
                      className={cn(
                        "col-start-1 row-start-1 min-w-0 truncate transition-opacity duration-150 motion-reduce:transition-none",
                        isBranchCopied ? "opacity-0" : "opacity-100",
                      )}
                      title={detail.headBranch}
                    >
                      {detail.headBranch}
                    </code>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "col-start-1 row-start-1 truncate text-center transition-opacity duration-150 motion-reduce:transition-none",
                        isBranchCopied ? "opacity-100" : "opacity-0",
                      )}
                    >
                      Copied
                    </span>
                  </button>
                  <span className="ml-auto inline-flex shrink-0 items-center justify-end gap-2">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <FileDiffIcon className="size-3.5" />
                      {detail.changedFiles.toLocaleString()}{" "}
                      {detail.changedFiles === 1 ? "file" : "files"}
                    </span>
                    <PullRequestDiffStat
                      additions={detail.additions}
                      deletions={detail.deletions}
                      className="shrink-0 font-mono text-xs"
                    />
                  </span>
                </div>
              </div>
            ) : null}

            {detail && conflicting ? (
              <div className="col-span-2 flex items-center gap-1 px-4 pb-3">
                <Badge
                  variant="error"
                  className="h-auto gap-1.5 rounded-md px-3 py-1.5 text-xs text-destructive"
                >
                  <TriangleAlertIcon className="size-3.5" />
                  Merge conflicts
                </Badge>
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/8 hover:text-destructive"
                  disabled={handoff !== null}
                  onClick={startResolveConflicts}
                >
                  {handoff === "conflicts" ? "Preparing..." : handoffLabels.resolve}
                  <ArrowUpRightIcon className="size-3.5 text-destructive" />
                </Button>
              </div>
            ) : null}

            {detail ? (
              <nav
                className="col-span-2 flex min-w-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                aria-label="Pull request tabs"
              >
                {visibleTabs.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={tab === item.value}
                    onClick={() => setTab(item.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
                      tab === item.value
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
                {tab === "summary" ? (
                  <span
                    className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
                    aria-label={checksSummary ? `Checks: ${checksSummary}` : "Checks"}
                  >
                    {detail && checksState !== null ? (
                      <PullRequestChecksPopover checks={detail.checks} checksState={checksState} />
                    ) : (
                      <CircleDotIcon aria-hidden className="size-3.5" />
                    )}
                    {checksSummary}
                  </span>
                ) : tab === "timeline" ? (
                  <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <PullRequestMetaLine
                      className={cn(
                        "whitespace-nowrap text-[11px] transition-opacity",
                        (activityPending || activityError) && "opacity-35",
                      )}
                    >
                      <span
                        className="inline-flex items-center gap-1"
                        aria-label={
                          activityError
                            ? "Comments unavailable"
                            : `${detail.commentCount.toLocaleString()} ${
                                detail.commentCount === 1 ? "comment" : "comments"
                              }`
                        }
                      >
                        <MessageSquareIcon aria-hidden className="size-3" />
                        {activityError
                          ? "—"
                          : activityPending
                            ? "…"
                            : detail.commentCount.toLocaleString()}
                      </span>
                      <span
                        className="inline-flex items-center gap-1"
                        aria-label={
                          activityError
                            ? "Commits unavailable"
                            : `${detail.commits.length.toLocaleString()} ${
                                detail.commits.length === 1 ? "commit" : "commits"
                              }`
                        }
                      >
                        <GitCommitHorizontalIcon aria-hidden className="size-3" />
                        {activityError
                          ? "—"
                          : activityPending
                            ? "…"
                            : detail.commits.length.toLocaleString()}
                      </span>
                    </PullRequestMetaLine>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-7 px-2 text-[10px] text-muted-foreground"
                      aria-label={
                        timelineOrder === "newest"
                          ? "Show oldest activity first"
                          : "Show newest activity first"
                      }
                      onClick={() =>
                        setTimelineOrder((value) => (value === "newest" ? "oldest" : "newest"))
                      }
                    >
                      <ArrowDownUpIcon aria-hidden className="size-3" />
                      {timelineOrder === "newest" ? "Newest first" : "Oldest first"}
                    </Button>
                  </div>
                ) : null}
              </nav>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onScrollCapture={(event) => {
          if (chromeVariant !== "collapse") return;
          const scroller = event.target as HTMLElement;
          scrollerRef.current = scroller;
          const top = scroller.scrollTop;
          setChromeCondensed((previous) => {
            let next = previous;
            const foldHeight = foldRef.current?.scrollHeight ?? 0;
            const chromeDelta = foldHeight - (condensedRowRef.current?.scrollHeight ?? 0);
            if (previous) {
              if (top < 4 && foldHeight > 0) {
                next = false;
              }
            } else if (foldHeight > 0 && top > foldHeight + 32) {
              compensationRef.current = -chromeDelta;
              next = true;
            }
            chromeStateByTab.current[tab] = next;
            return next;
          });
        }}
      >
        {detailQuery.isPending && !detail ? (
          tab === "timeline" ? (
            <PullRequestTimelineGhost />
          ) : tab === "code" ? (
            <DiffPanelLoadingState label="Loading pull request diff..." />
          ) : (
            <PullRequestDetailGhost />
          )
        ) : detailQuery.error && !detail ? (
          <PullRequestsUnavailableState error={detailQuery.error} onRetry={refreshDetail} />
        ) : detail ? (
          <>
            {mountedTabs.has("summary") ? (
              <div className={cn("absolute inset-0", tab !== "summary" && "invisible")}>
                <PullRequestSummaryTab
                  reference={reference}
                  detail={detail}
                  activityPending={activityPending}
                  activityError={activityError}
                  pendingFinding={handoff}
                  fixFindingLabel={handoffLabels.fixFinding}
                  fixCheckLabel={handoffLabels.fixCheck}
                  onFixFinding={startFixFinding}
                  onRefresh={refreshDetail}
                />
              </div>
            ) : null}
            {mountedTabs.has("timeline") ? (
              <div className={cn("absolute inset-0", tab !== "timeline" && "invisible")}>
                {activityPending ? (
                  <PullRequestTimelineGhost />
                ) : activityError ? (
                  <PullRequestActivityUnavailableState
                    error={activityError}
                    onRetry={activityQuery.refresh}
                  />
                ) : (
                  <PullRequestTimelineTab
                    detail={detail}
                    reference={reference}
                    order={timelineOrder}
                    onOpenCommit={openCommit}
                    onRefresh={refreshDetail}
                  />
                )}
              </div>
            ) : null}
            {mountedTabs.has("code") ? (
              <div className={cn("absolute inset-0", tab !== "code" && "invisible")}>
                <Suspense fallback={<DiffPanelLoadingState label="Loading pull request diff..." />}>
                  <PullRequestCodeTab
                    onAskAboutSelection={askAboutSelection}
                    reference={reference}
                    detail={detail}
                    selectedCommitOid={selectedCodeCommitOid}
                    onSelectedCommitChange={selectCodeCommit}
                    pendingFinding={handoff}
                    fixFindingLabel={handoffLabels.fixFinding}
                    onFixFinding={startFixFinding}
                    onRefresh={refreshDetail}
                    refreshToken={refreshToken}
                  />
                </Suspense>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "merge"
                ? "Merge pull request?"
                : confirmAction === "enable-auto-merge"
                  ? "Enable auto-merge?"
                  : "Close pull request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "merge"
                ? `This merges #${reference.number} using ${selectedMergeMethod}.`
                : confirmAction === "enable-auto-merge"
                  ? `This merges #${reference.number} using ${selectedMergeMethod} as soon as the host considers it ready, which may be immediately.`
                  : `This closes #${reference.number} without merging it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              size="sm"
              variant={confirmAction === "close" ? "destructive" : "default"}
              disabled={actionPending}
              onClick={() => {
                const action = confirmAction;
                setConfirmAction(null);
                if (action === "merge") void perform("merge", selectedMergeMethod);
                if (action === "enable-auto-merge")
                  void perform("enable-auto-merge", selectedMergeMethod);
                if (action === "close") void perform("close");
              }}
            >
              {confirmAction === "merge"
                ? "Merge"
                : confirmAction === "enable-auto-merge"
                  ? "Enable auto-merge"
                  : "Close"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
