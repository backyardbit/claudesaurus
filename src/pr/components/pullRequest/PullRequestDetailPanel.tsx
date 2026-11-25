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
  // True whichever it did: a pull request that was already mergeable merges the moment this is
  // armed, and the client has no way to tell that apart from one still waiting on something.
  "enable-auto-merge":
    "Auto-merge turned on — merges as soon as this is ready, sooner if it already is",
  "disable-auto-merge": "Auto-merge turned off",
};

/** Said as the thing that did not happen, rather than as the operation that returned an error. */
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

/** What to try, for the times the host says only that it refused. */
const ACTION_FAILURE_HINTS: Record<PullRequestAction, string> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  draft: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen:
    "The host refused it. Check that you have write access, and that the branch still exists.",
  // Said for the merge commit, which is what an update is unless a rebase was asked for. The
  // rebase has its own reasons to fail and its own sentence below.
  "update-branch":
    "The host refused it. Check that you have write access to the branch — one from a fork also needs its author to allow edits from maintainers — and that it does not conflict with the base.",
  // The one refusal that is usually a repository setting rather than anything about this branch:
  // GitHub will not arm an auto-merge at all unless the repository has the feature switched on.
  "enable-auto-merge":
    "The host refused it. Check that this repository allows auto-merge, that you have write access, and that there is something left for it to wait on.",
  "disable-auto-merge":
    "The host refused it. Check that you have write access, and that the merge has not already happened.",
};

/**
 * Said instead of the update hint when the reader asked for a rebase: it is the one that fails on
 * its own merits, because GitHub replays the commits and stops at the first that does not apply.
 * Offering the merge commit only makes sense to somebody who did not already choose it.
 */
const UPDATE_BRANCH_REBASE_FAILURE_HINT =
  "The host refused it. A rebase stops at the first commit that does not apply cleanly; updating with a merge commit may still work.";

const TABS: ReadonlyArray<{ value: DetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

// The diff viewer pulls in its worker pool, so it stays out of the bundle until Code is opened.
// Named rather than inlined so the panel can also call it itself, to start the download before
// anyone has clicked the tab.
const loadCodeTab = () => import("./PullRequestCodeTab");
const PullRequestCodeTab = lazy(loadCodeTab);

/**
 * The stale-branch warning, said beside the branch it is about rather than as a bar of its own.
 * The banner this replaces held a row of chrome open across the top of every pull request that
 * had fallen behind, pushing the reading down to say something that is true of the base branch
 * and nothing else; as a mark on the base branch it is where a reader would look for it, and the
 * sentence and the way out of it arrive together the moment the mark is pointed at.
 *
 * A popover rather than a tooltip because what it holds can be pressed: a tooltip's layer takes
 * no pointer, and a control nobody can reach is worse than no control.
 */
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
        {/* Each way the host offers and this reader may take, as its own button: a split button
            would need a menu inside a popover, and two buttons say the same thing in one layer. */}
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
  /**
   * Whether a chat opened this viewer from a link. Its tasks then land in that chat's composer
   * instead of a new chat, as T3 Code's land in the thread its panel sits beside.
   */
  openedFromChat: boolean;
  /**
   * How the metadata above the content behaves: `full` keeps every row pinned; `collapse`
   * folds the whole of it into the top row once the active tab scrolls, and unfolds at the
   * top — the chrome spends its height on what is being read.
   */
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
  // Every tab the reader has opened stays mounted behind the active one. The diff viewer
  // always needed this (it virtualizes against its own scroll position); the trace showed the
  // summary needs it too — a large description re-parses its whole markdown on every return
  // to the tab. `visibility` keeps boxes, sizes and scroll offsets, and takes hidden content
  // out of the tab order and the accessibility tree.
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<DetailTab>>(
    () => new Set<DetailTab>(["summary"]),
  );
  useEffect(() => {
    setMountedTabs((previous) =>
      previous.has(tab) ? previous : new Set<DetailTab>(previous).add(tab),
    );
  }, [tab]);
  const [chromeCondensed, setChromeCondensed] = useState(false);
  // Each tab remembers whether its chrome was condensed. Only the active tab can emit scroll
  // events, so the capture handler always writes the active tab's entry — and a tab switch
  // reads the destination's memory instead of inheriting the tab being left. A tab too short
  // to scroll remembers "expanded", which is what keeps it from being stranded under a chrome
  // it has no scrollbar to reopen.
  const chromeStateByTab = useRef<Partial<Record<DetailTab, boolean>>>({});
  useEffect(() => {
    setChromeCondensed(chromeStateByTab.current[tab] ?? false);
  }, [tab]);
  const condensed = chromeVariant === "collapse" && chromeCondensed;
  // Collapsing removes the fold's height from the chrome, which would otherwise hand that
  // height to the scrollport and leap the content up by it mid-scroll. The cure is exact
  // compensation: collapse only once the reader has scrolled at least the fold's height,
  // then give that height back to `scrollTop` before the next paint — the content under
  // their eyes does not move, and the collapse itself is the only thing that changes.
  const scrollerRef = useRef<HTMLElement | null>(null);
  const foldRef = useRef<HTMLDivElement | null>(null);
  // The condensed chrome's second row opens as the fold closes, so the height the scrollport
  // gains is the fold's minus this row's. Measured the same way the fold is: `scrollHeight`
  // through a zero track reads its natural height in either state.
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
  // Which handoff is preparing, keyed so a per-finding button can say "Preparing..." on itself
  // alone. One at a time whatever the key: they all check the same pull request out.
  const [handoff, setHandoff] = useState<string | null>(null);
  const { copyToClipboard: copyBranchToClipboard, isCopied: isBranchCopied } = useCopyToClipboard({
    target: "branch name",
    timeout: 1600,
  });

  // The chunk is fetched as soon as the panel exists rather than waiting for the Code tab to be
  // clicked, so a reader who does click it lands on a chunk already in the module cache.
  useEffect(() => {
    void loadCodeTab();
  }, []);

  const detailQuery = usePrQuery(prQuery("detail", { input: reference }));
  const activityQuery = usePrQuery(prQuery("activity", { input: reference }));
  // Detail and diff are independent server reads, so the diff for the default view (no commit,
  // no cursor) is started here too rather than waiting for the Code tab to mount. This is one
  // extra cached read per opened pull request even for readers who never open the tab, but it
  // turns the tab's first paint from a cold request into a cache hit.
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
  // A pull request changes while it is open in front of somebody — a push lands, a check
  // finishes, a review arrives — so the panel reads it again when the pane is focused again.
  useRefreshOnFocus(refreshDetail);
  // The diff is read again with everything else when the reader asks for a refresh.
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshFromHost = useCallback(() => {
    refreshAllQueries();
    setRefreshToken((token) => token + 1);
  }, []);
  const runAction = usePrCommand("runAction");
  // Which action is in flight, not merely that one is: every control here is disabled while any
  // of them runs, but only the button that was pressed may say what it is doing.
  const [pendingAction, setPendingAction] = useState<PullRequestAction | null>(null);
  const actionPending = pendingAction !== null;
  const update = usePrCommand("update");
  // Scoped to the pull request it was typed against, since this one panel shows a different one
  // every time it is opened and a half-written title must not follow it there.
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
      // The host's own sentence, because it is the only thing that says why. A merge strategy a
      // branch policy forbids is refused at completion and nowhere earlier — Azure DevOps
      // publishes no per-strategy availability to hide the control with — so "action failed"
      // would leave the reader pressing the same button again.
      const failure = result.error;
      // The hint stands for what was actually asked for: a reader who pressed Update branch is
      // told to check their access, not offered the merge commit they already chose.
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
    // A branch update moves the head commit, which leaves the diff atom pointed at a comparison
    // that no longer exists — the same staleness the manual refresh button fixes, so it goes
    // through that path rather than a second one. Every other action here only changes metadata;
    // a merge does move the branch too, but it also closes the pull request, where the diff is
    // no longer what anyone is looking at.
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
      // The draft stays open with the words still in it: retyping a title somebody has just
      // rewritten is the one thing a failed save must not cost them.
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

  /**
   * The task as text for the chat's composer. T3 Code shows the quoted context as chips beside
   * the prompt; the chat has only its text box, so the context is written out readably, with a
   * blank line left after it for the question when there is no prompt yet.
   */
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

  /**
   * Leaves the task in a Claudesaurus chat's composer, for the reader to read over and send: the
   * chat that opened this viewer, when one did, or a new chat beside it — in this folder, or on
   * the pull request's branch when the task needs the code. T3 Code opens a thread here; in a
   * terminal the thread is a chat in a split. A check-out always gets its own chat, on its branch.
   */
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

  /** A question about the change, which needs a chat and nothing else. */
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

  /** Lines the reader marked in the diff, asked about rather than commented on. */
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

  /** One finding, handed over on its own — the surfaces that show findings call this. */
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

  // The host says which strategies it offers at all; the repository narrows that to the ones
  // it actually allows.
  const allowedMergeMethods = detail
    ? detail.capabilities.mergeMethods.filter((method) => detail.mergeCapabilities[method])
    : [];
  const selectedMergeMethod = allowedMergeMethods.includes(mergeMethod)
    ? mergeMethod
    : (allowedMergeMethods[0] ?? "merge");
  const conflicting = detail?.state === "open" && detail.mergeability === "conflicting";
  // Only an outright yes arms it. A host that reports nothing has not said the merge is already
  // spoken for, and an off switch for something that may not be on says the wrong thing twice.
  const autoMergeArmed = detail?.state === "open" && detail.autoMergeEnabled === true;
  // Out of date with the base, and still cleanly mergeable — the one pairing an update button
  // exists for. Null everywhere else, including hosts that cannot compare at all.
  const freshness = detail === null ? null : resolveBaseFreshness(detail);
  // A host that cannot produce a patch has no Code tab to open. The tabs themselves stay hidden
  // until the detail arrives, so the loading ghost is the panel's only unfinished UI.
  const visibleTabs = TABS.filter(
    (item) => item.value !== "code" || detail === null || detail.capabilities.diff,
  );
  // The Code tab can be opened while the detail is still on its way, and the detail may then say
  // this host has no patch to show. The tab goes, so whoever was standing on it is moved back to
  // the summary rather than left looking at a panel that is no longer reachable.
  useEffect(() => {
    if (!visibleTabs.some((item) => item.value === tab)) setTab("summary");
  }, [tab, visibleTabs]);
  // Two questions, both of which have to say yes: whether this host can do it at all, and
  // whether this account may. A reader with read access on someone else's project sees the pull
  // request and none of the buttons that would only ever be refused.
  const can = (action: PullRequestAction) =>
    detail?.capabilities.actions.includes(action) === true &&
    detail.viewerPermissions.actions.includes(action);
  // One live action holds the slot. A conflicting change cannot be merged now, so the slot goes
  // to the thing that would help instead of a Merge button that only ever says no.
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
  // What the menu's action group holds. Named once so the separators around it are drawn from
  // the same answer as its contents, rather than on the assumption that it has any.
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
  // The pull request number carries this state in the overview and the right-panel tab mirrors
  // it. Conflicts keep their own row below: an open pull request remains green there.
  const statePresentation = detail
    ? resolvePullRequestState({ state: detail.state, isDraft: detail.isDraft })
    : null;
  const checksSummary = detail ? summarizePullRequestChecks(detail.checks) : null;
  const checksState = detail ? pullRequestChecksState(detail.checks) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {/* The top row's geometry never changes: both of its states occupy the same stacked
          cell and crossfade, so the actions on the right have one home whatever the chrome
          is doing below. The fold and this fade share one 200ms clock. */}
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b border-border/60">
        {/* The fixed height lives on the two top-row cells — not the grid, whose later rows
            are the fold — so the actions have one immovable home in both states. */}
        <div className="ml-4 grid h-11 min-w-0 items-center">
          <div
            aria-hidden={condensed}
            inert={condensed ? "" : undefined}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-opacity sm:text-xs motion-reduce:transition-none",
              // Sequenced, not simultaneous: the leaving layer clears quickly before the
              // arriving one lands, so no frame shows both texts superimposed at half opacity.
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
                      {/* Only where the button row could not take it: "Ready for review" on a
                          draft is the primary header button, so offering it here as well would
                          show the same action twice. */}
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
                      {/* The same merge, left with the host to carry out once the things it
                          waits on are done. It is offered beside the merge rather than instead
                          of it, because the reader who can wait and the reader who cannot are
                          the same person on different days — and a conflicting branch is neither,
                          since nothing the host waits for will clear it. */}
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
                      {/* A preference for the merge action rather than a second action, so it
                          is a radio group here instead of a chevron welded to the Merge pill.
                          Hidden while conflicting: every method would fail. */}
                      {/* Only where merging is on offer at all: a strategy to merge with is not
                          a choice for someone who may not merge. */}
                      {showsMergeMethods ? (
                        <>
                          {/* Only below the draft control. A host with no draft of its own, or
                              a draft whose control is already the header button, would leave
                              this against the separator that opened the group. */}
                          {showsDraftToggle ? <MenuSeparator /> : null}
                          <MenuRadioGroup
                            value={selectedMergeMethod}
                            onValueChange={(method) =>
                              setMergeMethod(method as PullRequestMergeMethod)
                            }
                          >
                            {allowedMergeMethods.map((method) => (
                              <MenuRadioItem key={method} value={method} disabled={actionPending}>
                                {/* The radio item lays its children out as one block, so the
                                    icon and the label need their own row to share a line. */}
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
                  {/* Only where the button row could not take it, so it is never offered twice. */}
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
              {/* Checking a pull request out is the reason to open one here at all, so it is a
                  button of its own rather than a side effect of asking an agent for something.
                  It asks where, because the two answers are not interchangeable: one leaves your
                  work where it is, the other moves the repository you are standing in. */}
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
              {/* Said where the Merge button is, because it is the answer to why nobody has
                  pressed it: the merge is already asked for, and the host is holding it. */}
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

        {/* The condensed chrome's second row: the tabs that the closing fold takes with it,
            and compact copies of the branch pair and diff stat so they stay in sight while
            the full rows are folded away. Same zero-track mechanism as the fold, inverted. */}
        <div
          className={cn(
            "col-span-2 grid",
            // Inverse of the fold's track: closing eases while the fold above eases open,
            // so the chrome trades rows in one motion instead of two jumps.
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

        {/* Folding is a grid track going to zero: the rows below stay mounted, the track
            animates closed over them, and `inert` takes the hidden controls out of the tab
            order for as long as the chrome is condensed. */}
        <div
          className={cn(
            "col-span-2 grid",
            // Collapse is instant: it happens mid-scroll, and the compensation that keeps the
            // content pinned would fight an animated track frame by frame. Reopening happens
            // at the top with no compensation, so the fold can ease back in instead of
            // snapping the content down.
            condensed
              ? "grid-rows-[0fr]"
              : "grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={foldRef}
            // One-way on purpose: appearing content eases in over ground the instant track
            // already reserved; departing content cuts, because its ground is gone in the
            // same frame and the scroll compensation reads it as scrolled past.
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
                  // A title is one line of text, not markdown, so it takes an input rather than
                  // the editor the description and the remarks share.
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
                    {/* The rollup icon opens the checks behind the summary; with none reported
                        there is nothing to open, so the plain glyph stays. */}
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
        // Scroll does not bubble, but it captures: one listener hears every tab's own scroll
        // container. Collapse past two line-heights, expand only back at the very top, so the
        // boundary row cannot flap the chrome open and shut.
        onScrollCapture={(event) => {
          if (chromeVariant !== "collapse") return;
          const scroller = event.target as HTMLElement;
          scrollerRef.current = scroller;
          const top = scroller.scrollTop;
          setChromeCondensed((previous) => {
            let next = previous;
            // `scrollHeight` reads the fold's natural height whichever state the track is in.
            const foldHeight = foldRef.current?.scrollHeight ?? 0;
            // The chrome trades the fold for the condensed second row, so the height the
            // scrollport actually gains is the difference between the two.
            const chromeDelta = foldHeight - (condensedRowRef.current?.scrollHeight ?? 0);
            if (previous) {
              // The hard top reopens the chrome with no refund: the reader asked for the top,
              // and moving them a fold's height back down would snatch it away — the fold
              // slides in above while the content stays where they left it.
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
          // The ghost wears the shape of the tab being waited on, so switching tabs mid-load
          // does not flash a summary outline under a timeline heading.
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
                  ? // The host merges this as soon as it considers the pull request ready, which
                    // may be immediately — there is no telling from here whether anything is
                    // still outstanding.
                    `This merges #${reference.number} using ${selectedMergeMethod} as soon as the host considers it ready, which may be immediately.`
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
