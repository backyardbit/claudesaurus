import type { CodeViewItem, DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import type { CodeViewDiffItem } from "@pierre/diffs/react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  MessageSquareIcon,
  MessageSquareOffIcon,
  Rows3Icon,
  SparklesIcon,
  TextWrapIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PullRequestDetailView,
  PullRequestDiffSide,
  PullRequestOmittedFileStat,
  PullRequestRef,
  PullRequestReviewPosition,
  PullRequestReviewThread,
} from "~/contracts";
import { useTheme } from "~/hooks/useTheme";
import { areAllDiffFilesCollapsed } from "~/lib/diffCollapse";
import { createPullRequestDiffFileContentsLoader } from "~/lib/diffFileContents";
import {
  buildFileDiffRenderKey,
  fnv1a32,
  getDiffLineStat,
  getRenderablePatch,
  type RenderablePatch,
  resolveFileDiffPath,
  resolveFileDiffPreviousPath,
} from "~/lib/diffRendering";
import { prQuery, usePrCommand, usePrQuery } from "~/lib/prApi";
import { cn } from "~/lib/utils";
import {
  buildDiffReviewComment,
  type ReviewCommentContext,
  resolveDiffReviewPosition,
} from "~/reviewCommentContext";
import { DiffPanelLoadingState } from "../DiffPanelShell";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PendingReviewCommentCard, ReviewThreadCard } from "./PullRequestReviewAnnotation";
import { PullRequestReviewBar } from "./PullRequestReviewBar";
import { type PullRequestFinding, pullRequestFindingKey } from "./pullRequestDetail.logic";
import {
  type DiffFoldOverride,
  isFileDiffCollapsed,
  isLineInFileDiff,
} from "./pullRequestDiff.logic";
import { canEditPullRequestComment } from "./pullRequestEditing.logic";
import { orderDiffFiles } from "./pullRequestFileOrder.logic";
import { PullRequestDiffStat, PullRequestMetaLine } from "./pullRequestPresentation";
import {
  nextPendingReviewCommentId,
  type PendingReviewComment,
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";

interface ReviewAnnotationGroup {
  readonly threads: ReadonlyArray<PullRequestReviewThread>;
  readonly pending: ReadonlyArray<PendingReviewComment>;
  readonly draft: boolean;
}

type ReviewAnnotation = DiffLineAnnotation<ReviewAnnotationGroup>;

const COMMIT_PAGE_SIZE = 10;

interface DiffSlice {
  readonly cursor: string | null;
  readonly patch: string;
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  readonly omittedFileStats: ReadonlyArray<PullRequestOmittedFileStat>;
}

const REPLACE_FILE_COUNTS_CSS = `
[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  display: none !important;
}`;

const NO_SLICES: ReadonlyArray<DiffSlice> = [];

interface MutableAnnotationGroup {
  readonly side: PullRequestDiffSide;
  readonly line: number;
  readonly threads: PullRequestReviewThread[];
  readonly pending: PendingReviewComment[];
  draft: boolean;
}

interface DraftAnchor {
  readonly fileKey: string;
  readonly path: string;
  readonly oldPath: string | null;
  readonly position: PullRequestReviewPosition;
  readonly range: SelectedLineRange;
}

export interface PullRequestAskSelectionInput {
  readonly comment: ReviewCommentContext;
  readonly question: string;
}

function toViewerSide(side: PullRequestDiffSide) {
  return side === "left" ? ("deletions" as const) : ("additions" as const);
}

function getReviewPositionAnchor(position: PullRequestReviewPosition): {
  line: number;
  side: PullRequestDiffSide;
} {
  switch (position.kind) {
    case "added":
      return { line: position.newLine, side: "right" };
    case "deleted":
      return { line: position.oldLine, side: "left" };
    case "context":
      return {
        line: position.side === "left" ? position.oldLine : position.newLine,
        side: position.side,
      };
  }
}

export function PullRequestCodeTab({
  reference,
  detail,
  selectedCommitOid,
  onSelectedCommitChange,
  pendingFinding,
  fixFindingLabel = "Fix in a thread",
  onFixFinding,
  onAskAboutSelection,
  onRefresh,
  refreshToken = 0,
}: {
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  selectedCommitOid: string | null;
  onSelectedCommitChange: (oid: string | null) => void;
  pendingFinding?: string | null;
  fixFindingLabel?: string;
  onFixFinding?: (finding: PullRequestFinding) => void;
  onAskAboutSelection?: (input: PullRequestAskSelectionInput) => void;
  onRefresh: () => void;
  refreshToken?: number;
}) {
  const { resolvedTheme, syntaxThemeName } = useTheme();
  const [toggledFiles, setToggledFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [visibleCommitCount, setVisibleCommitCount] = useState(COMMIT_PAGE_SIZE);
  const [foldOverride, setFoldOverride] = useState<DiffFoldOverride>(null);
  const [diffRenderMode, setDiffRenderMode] = useState<"stacked" | "split">("stacked");
  const [wordWrap, setWordWrap] = useState(false);
  const [selectedLines, setSelectedLines] = useState<{
    id: string;
    range: SelectedLineRange;
  } | null>(null);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  const [threadPending, setThreadPending] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sliceState, setSliceState] = useState<{
    readonly key: string;
    readonly cursor: string | null;
    readonly slices: ReadonlyArray<DiffSlice>;
  }>({ key: "", cursor: null, slices: NO_SLICES });
  const parseCache = useRef(new Map<string, RenderablePatch>());

  const referenceKey = pullRequestReviewKey(reference);
  const commit = selectedCommitOid;
  const scopeKey = commit === null ? referenceKey : `${referenceKey}@${commit}`;
  useEffect(() => {
    setDraft(null);
    setSelectedLines(null);
    setToggledFiles(new Set());
    setFoldOverride(null);
    setVisibleCommitCount(COMMIT_PAGE_SIZE);
    setOrphansOpen(false);
    setSliceState({ key: scopeKey, cursor: null, slices: NO_SLICES });
    parseCache.current.clear();
  }, [scopeKey]);

  const loadedSlices = sliceState.key === scopeKey ? sliceState.slices : NO_SLICES;
  const cursor = sliceState.key === scopeKey ? sliceState.cursor : null;
  const diffQuery = usePrQuery(
    prQuery("diff", {
      input: {
        ...reference,
        ...(cursor === null ? {} : { cursor }),
        ...(commit === null ? {} : { commit }),
      },
    }),
  );
  useEffect(() => {
    const data = diffQuery.data;
    if (data === null) return;
    setSliceState((previous) => {
      const slices = previous.key === scopeKey ? previous.slices : NO_SLICES;
      const next = {
        cursor,
        patch: data.patch,
        truncated: data.truncated,
        nextCursor: data.nextCursor,
        omittedFileStats: data.omittedFileStats ?? [],
      };
      const index = slices.findIndex((slice) => slice.cursor === cursor);
      if (index === -1) {
        return { key: scopeKey, cursor, slices: [...slices, next] };
      }
      const existing = slices[index];
      if (
        existing !== undefined &&
        existing.patch === next.patch &&
        existing.truncated === next.truncated &&
        existing.nextCursor === next.nextCursor &&
        existing.omittedFileStats.length === next.omittedFileStats.length &&
        existing.omittedFileStats.every((file, index) => {
          const refreshed = next.omittedFileStats[index];
          return (
            refreshed !== undefined &&
            refreshed.path === file.path &&
            refreshed.additions === file.additions &&
            refreshed.deletions === file.deletions
          );
        })
      ) {
        return previous;
      }
      return { key: scopeKey, cursor, slices: [...slices.slice(0, index), next] };
    });
  }, [cursor, diffQuery.data, scopeKey]);
  const refreshFirstDiffPage = usePrQuery(
    prQuery("diff", {
      input: { ...reference, ...(commit === null ? {} : { commit }) },
    }),
  ).refresh;
  const appliedRefreshToken = useRef(refreshToken);
  useEffect(() => {
    if (appliedRefreshToken.current === refreshToken) return;
    appliedRefreshToken.current = refreshToken;
    setSliceState({ key: scopeKey, cursor: null, slices: NO_SLICES });
    refreshFirstDiffPage();
  }, [refreshToken, scopeKey, refreshFirstDiffPage]);
  const reviewKey = referenceKey;
  const pendingComments = usePendingReviewComments(reference);
  const addComment = usePullRequestReviewStore((store) => store.addComment);
  const removeComment = usePullRequestReviewStore((store) => store.removeComment);
  const replyToThread = usePrCommand("replyToThread");
  const setThreadResolution = usePrCommand("setThreadResolution");
  const updateComment = usePrCommand("updateComment");
  const getDiffFileContents = usePrCommand("diffFileContents");
  const loadDiffFiles = useMemo(
    () =>
      createPullRequestDiffFileContentsLoader(getDiffFileContents, {
        reference,
        commit,
        cacheKey: `pull-request:${referenceKey}:${detail.updatedAt}:${commit ?? "all"}`,
      }),
    [commit, detail.updatedAt, getDiffFileContents, reference, referenceKey],
  );

  const review = useMemo(() => {
    const hostReview = detail.capabilities.review;
    const viewer = detail.viewerPermissions;
    return {
      inlineComment: hostReview.inlineComment && viewer.comment,
      reply: hostReview.reply && viewer.comment,
      resolve: hostReview.resolve && viewer.resolve,
      verdicts: hostReview.verdicts.filter((verdict) => viewer.verdicts.includes(verdict)),
    };
  }, [detail.capabilities.review, detail.viewerPermissions]);
  const canCommentOnLines = review.inlineComment && commit === null;
  const parsedSlices = useMemo(
    () =>
      loadedSlices.map((slice) => {
        const sliceKey = `${scopeKey}:${slice.cursor ?? "first"}:${fnv1a32(slice.patch)}`;
        const parseCacheKey = `pull-request:${sliceKey}`;
        const cached = parseCache.current.get(parseCacheKey);
        if (cached) return cached;
        const parsed = getRenderablePatch(slice.patch, `pull-request:${sliceKey}`, {
          compactPartialHunkOffsets: true,
        });
        if (parsed) parseCache.current.set(parseCacheKey, parsed);
        return parsed;
      }),
    [loadedSlices, scopeKey, syntaxThemeName],
  );
  const files = useMemo(
    () =>
      parsedSlices.flatMap((parsed) =>
        parsed?.kind === "files" ? orderDiffFiles(parsed.files) : [],
      ),
    [parsedSlices],
  );
  const nextCursor = loadedSlices.at(-1)?.nextCursor ?? null;
  const withheldContent =
    loadedSlices.some((slice) => slice.truncated) ||
    parsedSlices.some((parsed) => parsed?.kind === "raw");

  const placedThreadIds = useMemo(() => {
    const placed = new Set<string>();
    if (commit !== null) return placed;
    for (const file of files) {
      const path = resolveFileDiffPath(file);
      for (const thread of detail.reviewThreads) {
        if (
          thread.path === path &&
          thread.line !== null &&
          isLineInFileDiff(file, thread.side, thread.line)
        ) {
          placed.add(thread.id);
        }
      }
    }
    return placed;
  }, [commit, detail.reviewThreads, files]);

  const items = useMemo<CodeViewDiffItem<ReviewAnnotationGroup>[]>(
    () =>
      files.map((fileDiff) => {
        const fileKey = buildFileDiffRenderKey(fileDiff);
        const path = resolveFileDiffPath(fileDiff);
        const groups = new Map<string, MutableAnnotationGroup>();
        const groupAt = (side: PullRequestDiffSide, line: number) => {
          const key = `${side}:${line}`;
          const existing = groups.get(key);
          if (existing) return existing;
          const created: MutableAnnotationGroup = {
            side,
            line,
            threads: [],
            pending: [],
            draft: false,
          };
          groups.set(key, created);
          return created;
        };

        for (const thread of detail.reviewThreads) {
          if (thread.path !== path || thread.line === null) continue;
          if (!placedThreadIds.has(thread.id)) continue;
          groupAt(thread.side, thread.line).threads.push(thread);
        }
        if (commit === null) {
          for (const comment of pendingComments) {
            if (comment.path !== path) continue;
            const anchor = getReviewPositionAnchor(comment.position);
            groupAt(anchor.side, anchor.line).pending.push(comment);
          }
        }
        if (draft?.fileKey === fileKey) {
          const anchor = getReviewPositionAnchor(draft.position);
          groupAt(anchor.side, anchor.line).draft = true;
        }

        const collapsed = isFileDiffCollapsed(fileKey, foldOverride, toggledFiles);

        const annotations: ReviewAnnotation[] = [...groups.values()].map((group) => ({
          side: toViewerSide(group.side),
          lineNumber: group.line,
          metadata: { threads: group.threads, pending: group.pending, draft: group.draft },
        }));
        return {
          id: fileKey,
          type: "diff" as const,
          fileDiff,
          annotations,
          collapsed,
          version: fnv1a32(
            `${syntaxThemeName}:${collapsed ? "1" : "0"}:${annotations
              .map(
                ({ side, lineNumber, metadata }) =>
                  `${side}:${lineNumber}:${metadata.draft ? "d" : ""}:${metadata.pending
                    .map((comment) => `${comment.id}:${comment.body}`)
                    .join(",")}:${metadata.threads
                    .map(
                      (thread) =>
                        `${thread.id}:${thread.isResolved ? "r" : ""}:${
                          thread.isOutdated ? "o" : ""
                        }:${thread.comments
                          .map(
                            (comment) =>
                              `${comment.id}:${comment.author?.login ?? ""}:${comment.createdAt}:${comment.body}:${(
                                comment.reactions ?? []
                              )
                                .map(
                                  (r) => `${r.content}:${r.count}:${r.viewerHasReacted ? "v" : ""}`,
                                )
                                .join(",")}`,
                          )
                          .join(";")}`,
                    )
                    .join(",")}`,
              )
              .join("|")}`,
          ),
        };
      }),
    [
      commit,
      detail.reviewThreads,
      draft,
      files,
      foldOverride,
      pendingComments,
      placedThreadIds,
      syntaxThemeName,
      toggledFiles,
    ],
  );
  const lineStat = useMemo(() => getDiffLineStat(files), [files]);
  const omittedFileStats = useMemo(
    () =>
      new Map(
        loadedSlices.flatMap((slice) =>
          slice.omittedFileStats.map((file) => [file.path, file] as const),
        ),
      ),
    [loadedSlices],
  );
  const fileKeys = useMemo(() => items.map((item) => item.id), [items]);
  const collapsedFileKeys = useMemo(
    () => new Set(items.filter((item) => item.collapsed === true).map((item) => item.id)),
    [items],
  );
  const allFilesCollapsed = areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys);

  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (
      sentinel === null ||
      nextCursor === null ||
      nextCursor === cursor ||
      diffQuery.isPending ||
      diffQuery.error !== null
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          setSliceState((previous) => ({ ...previous, cursor: nextCursor }));
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, diffQuery.error, diffQuery.isPending, nextCursor, sentinel]);

  const toggleFile = useCallback(
    (fileKey: string) =>
      setToggledFiles((current) => {
        const next = new Set(current);
        if (next.has(fileKey)) next.delete(fileKey);
        else next.add(fileKey);
        return next;
      }),
    [],
  );

  const toggleAllFiles = () => {
    setFoldOverride(areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys) ? "expanded" : "folded");
    setToggledFiles(new Set());
  };

  const orderedCommits = useMemo(
    () =>
      detail.commits.toSorted(
        (left, right) => Date.parse(right.committedDate) - Date.parse(left.committedDate),
      ),
    [detail.commits],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange | null, context: { item: CodeViewItem<ReviewAnnotationGroup> }) => {
      if (!range || !canCommentOnLines) return;
      const item = context.item;
      if (item.type !== "diff") return;
      const file = files.find((candidate) => buildFileDiffRenderKey(candidate) === item.id);
      if (!file) return;
      const path = resolveFileDiffPath(file);
      const previousPath = resolveFileDiffPreviousPath(file);
      const position = resolveDiffReviewPosition(file, range.end, range.endSide ?? range.side);
      if (position === null) return;
      setDraft({
        fileKey: item.id,
        path,
        oldPath: previousPath === path ? null : previousPath,
        position,
        range,
      });
    },
    [canCommentOnLines, files],
  );

  const askAboutSelection = useCallback(
    (anchor: DraftAnchor, question: string) => {
      const file = files.find((candidate) => buildFileDiffRenderKey(candidate) === anchor.fileKey);
      const comment =
        file === undefined
          ? null
          : buildDiffReviewComment({
              id: `pull-request-selection:${anchor.fileKey}:${anchor.range.start}:${anchor.range.end}`,
              sectionId: `pull-request:${detail.number}`,
              sectionTitle: `PR #${detail.number} review`,
              filePath: anchor.path,
              fileDiff: file,
              range: anchor.range,
              text: question,
            });
      setDraft(null);
      setSelectedLines(null);
      if (comment === null || !onAskAboutSelection) return;
      onAskAboutSelection({ comment, question });
    },
    [detail.number, files, onAskAboutSelection],
  );

  const renderCodeViewFooter = useCallback(
    () =>
      nextCursor === null ? null : (
        <div
          ref={setSentinel}
          className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
        >
          {diffQuery.error !== null ? (
            <>
              <span>The rest of this diff could not be loaded.</span>
              <Button size="xs" variant="outline" onClick={() => diffQuery.refresh()}>
                Retry
              </Button>
            </>
          ) : diffQuery.isPending ? (
            "Loading more files..."
          ) : null}
        </div>
      ),
    [nextCursor, diffQuery.error, diffQuery.isPending, diffQuery.refresh],
  );

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<ReviewAnnotationGroup>) => {
      const collapsed = item.collapsed === true;
      return (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand diff" : "Collapse diff"}
          className="mr-1 rounded hover:bg-transparent"
          onClick={(event) => {
            event.stopPropagation();
            toggleFile(item.id);
          }}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-4" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )}
        </Button>
      );
    },
    [toggleFile],
  );

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<ReviewAnnotationGroup>) => {
      if (item.type !== "diff") return null;
      let additions = 0;
      let deletions = 0;
      for (const hunk of item.fileDiff.hunks) {
        additions += hunk.additionLines;
        deletions += hunk.deletionLines;
      }
      if (additions === 0 && deletions === 0) {
        const withheld = omittedFileStats.get(resolveFileDiffPath(item.fileDiff));
        if (withheld) ({ additions, deletions } = withheld);
      }
      return (
        <PullRequestDiffStat
          additions={additions}
          deletions={deletions}
          className="font-mono text-[11px]"
        />
      );
    },
    [omittedFileStats],
  );

  const diffViewOptions = useMemo(
    () => ({
      diffStyle: diffRenderMode === "split" ? ("split" as const) : ("unified" as const),
      lineDiffType: "none" as const,
      overflow: wordWrap ? ("wrap" as const) : ("scroll" as const),
      theme: syntaxThemeName,
      themeType: resolvedTheme,
      stickyHeaders: true,
      loadDiffFiles,
      enableGutterUtility: canCommentOnLines && draft === null,
      enableLineSelection: canCommentOnLines && draft === null,
      onGutterUtilityClick: beginComment,
      onLineSelectionEnd: beginComment,
    }),
    [
      diffRenderMode,
      wordWrap,
      resolvedTheme,
      syntaxThemeName,
      loadDiffFiles,
      canCommentOnLines,
      draft,
      beginComment,
    ],
  );

  const runThreadCommand = useCallback(
    async (label: string, run: () => Promise<{ readonly _tag: string }>): Promise<boolean> => {
      if (threadPending) return false;
      setThreadPending(true);
      const result = await run();
      setThreadPending(false);
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: label });
        return false;
      }
      onRefresh();
      return true;
    },
    [onRefresh, threadPending],
  );

  const renderThreadCard = useCallback(
    (thread: PullRequestReviewThread) => (
      <ReviewThreadCard
        key={`${reference.repository}#${reference.number}:${thread.id}`}
        thread={thread}
        workspaceRoot={detail.workspaceRoot}
        canReply={review.reply}
        canResolve={review.resolve}
        canReact={detail.capabilities.reactions === true}
        reference={reference}
        pending={threadPending}
        fixPending={pendingFinding === pullRequestFindingKey({ kind: "thread", thread })}
        fixLabel={fixFindingLabel}
        {...(onFixFinding ? { onFix: () => onFixFinding({ kind: "thread", thread }) } : {})}
        onReply={(body) =>
          runThreadCommand("Reply could not be posted", () =>
            replyToThread({
              input: { ...reference, threadId: thread.id, body },
            }),
          )
        }
        canEditComment={(comment) =>
          canEditPullRequestComment(detail, { author: comment.author, kind: "review-comment" })
        }
        onEditComment={(commentId, body) =>
          runThreadCommand("The comment could not be saved", () =>
            updateComment({
              input: { ...reference, commentId, kind: "review-comment", body },
            }),
          )
        }
        onToggleResolved={() =>
          void runThreadCommand("The conversation could not be updated", () =>
            setThreadResolution({
              input: { ...reference, threadId: thread.id, resolved: !thread.isResolved },
            }),
          )
        }
        onReacted={onRefresh}
      />
    ),
    [
      detail,
      fixFindingLabel,
      onRefresh,
      onFixFinding,
      pendingFinding,
      reference,
      replyToThread,
      review.reply,
      review.resolve,
      runThreadCommand,
      setThreadResolution,
      threadPending,
      updateComment,
    ],
  );

  const renderAnnotation = useCallback(
    (annotation: ReviewAnnotation) => (
      <div className="py-1 font-sans text-foreground">
        {annotation.metadata.threads.map(renderThreadCard)}
        {annotation.metadata.pending.map((comment) => (
          <PendingReviewCommentCard
            key={comment.id}
            comment={comment}
            onRemove={() => removeComment(reviewKey, comment.id)}
          />
        ))}
        {annotation.metadata.draft && draft ? (
          <DiffCommentAnnotation
            kind="draft"
            rangeLabel={`${draft.path}:${getReviewPositionAnchor(draft.position).line}`}
            text=""
            submitLabel="Add to review"
            {...(onAskAboutSelection
              ? {
                  secondaryAction: {
                    label: "Ask",
                    icon: <SparklesIcon className="size-3" />,
                    allowEmpty: true,
                    onAction: (question: string) => askAboutSelection(draft, question),
                  },
                }
              : {})}
            onCancel={() => {
              setDraft(null);
              setSelectedLines(null);
            }}
            onComment={(body) => {
              addComment(reviewKey, {
                id: nextPendingReviewCommentId(),
                path: draft.path,
                ...(draft.oldPath === null ? {} : { oldPath: draft.oldPath }),
                position: draft.position,
                body,
              });
              setDraft(null);
              setSelectedLines(null);
            }}
          />
        ) : null}
      </div>
    ),
    [
      addComment,
      askAboutSelection,
      draft,
      onAskAboutSelection,
      removeComment,
      renderThreadCard,
      reviewKey,
    ],
  );

  const reviewOverlay =
    review.verdicts.length === 0 ? null : (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        {reviewOpen ? (
          <div className="surface-glass pointer-events-auto absolute inset-x-3 bottom-3 rounded-xl border border-border/60 shadow-lg">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Close review"
              className="absolute right-2 top-2"
              onClick={() => setReviewOpen(false)}
            >
              <XIcon className="size-3.5" />
            </Button>
            <PullRequestReviewBar
              reference={reference}
              verdicts={review.verdicts}
              onSubmitted={() => {
                onRefresh();
                setReviewOpen(false);
              }}
            />
          </div>
        ) : (
          <Button
            className="pointer-events-auto absolute right-4 bottom-3 rounded-full shadow-lg"
            onClick={() => setReviewOpen(true)}
            size="compact"
            variant="glass"
          >
            <MessageSquareIcon className="size-3.5" />
            Review
            {pendingComments.length > 0 ? (
              <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[10px] tabular-nums text-accent-foreground">
                {pendingComments.length}
              </span>
            ) : null}
          </Button>
        )}
      </div>
    );
  const selectedCommit = orderedCommits.find((entry) => entry.oid === commit);
  useEffect(() => {
    if (commit !== null && selectedCommit === undefined) {
      onSelectedCommitChange(null);
    }
  }, [commit, onSelectedCommitChange, selectedCommit]);
  const scopeLabel = selectedCommit ? selectedCommit.messageHeadline : "All commits";
  const toolbar = (
    <div className="flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-4 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {orderedCommits.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-6 max-w-64 items-center gap-1 rounded-md bg-accent px-2 text-xs font-medium text-accent-foreground outline-none transition-colors hover:bg-accent/80 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Diff scope: ${scopeLabel}`}
            >
              <span className="truncate">{scopeLabel}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              <DropdownMenuItem
                className={commit === null ? "bg-foreground/[0.08]" : undefined}
                onClick={() => onSelectedCommitChange(null)}
              >
                <span>All commits</span>
              </DropdownMenuItem>
              {orderedCommits.slice(0, visibleCommitCount).map((entry) => (
                <DropdownMenuItem
                  key={entry.oid}
                  className={entry.oid === commit ? "bg-foreground/[0.08]" : undefined}
                  onClick={() => onSelectedCommitChange(entry.oid)}
                >
                  <span className="min-w-0 truncate" title={entry.messageHeadline}>
                    {entry.messageHeadline}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                    {entry.oid.slice(0, 7)}
                  </span>
                </DropdownMenuItem>
              ))}
              {orderedCommits.length > visibleCommitCount ? (
                <DropdownMenuItem
                  closeOnClick={false}
                  onClick={() => setVisibleCommitCount((count) => count + COMMIT_PAGE_SIZE)}
                >
                  <span className="text-muted-foreground">
                    Show more ({orderedCommits.length - visibleCommitCount} left)
                  </span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <PullRequestMetaLine>
          <span className="shrink-0 tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}
            {nextCursor === null ? "" : "+"}
          </span>
          {withheldContent ? (
            <Tooltip>
              <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
                <TriangleAlertIcon
                  aria-label="Some of this diff was not shown"
                  className="size-3.5 text-amber-600 dark:text-amber-500"
                />
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                The host withheld part of this diff — a binary file, or a change too large to
                inline.
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {commit !== null && review.inlineComment ? (
            <Tooltip>
              <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
                <MessageSquareOffIcon
                  aria-label="Line comments are written from the whole change"
                  className="size-3.5"
                />
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                A comment is anchored to the whole change, so switch to All commits to write one.
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </PullRequestMetaLine>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <PullRequestDiffStat
          additions={lineStat.additions}
          deletions={lineStat.deletions}
          className="mr-1"
        />
        {fileKeys.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={allFilesCollapsed ? "Expand all files" : "Collapse all files"}
                  onClick={toggleAllFiles}
                />
              }
            >
              {allFilesCollapsed ? (
                <ChevronsUpDownIcon className="size-3.5" />
              ) : (
                <ChevronsDownUpIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {allFilesCollapsed ? "Expand all files" : "Collapse all files"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        <ToggleGroup
          className="shrink-0 gap-1"
          size="sm"
          value={[diffRenderMode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "stacked" || next === "split") {
              setDiffRenderMode(next);
            }
          }}
        >
          <Toggle aria-label="Stacked diff view" value="stacked" variant="ghost">
            <Rows3Icon className="size-3.5" />
          </Toggle>
          <Toggle aria-label="Split diff view" value="split" variant="ghost">
            <Columns2Icon className="size-3.5" />
          </Toggle>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
                variant="ghost"
                size="sm"
                pressed={wordWrap}
                onPressedChange={(pressed) => {
                  setWordWrap(Boolean(pressed));
                }}
              />
            }
          >
            <TextWrapIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
  const withReviewBar = (body: ReactNode) => (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-auto">{body}</div>
        {reviewOverlay}
      </div>
    </div>
  );

  if (diffQuery.isPending && loadedSlices.length === 0) {
    return withReviewBar(<DiffPanelLoadingState label="Loading pull request diff..." />);
  }

  if (diffQuery.error && loadedSlices.length === 0) {
    return withReviewBar(
      <p className="px-4 py-5 text-sm text-muted-foreground">{diffQuery.error}</p>,
    );
  }

  const rawSlices =
    nextCursor === null
      ? parsedSlices.flatMap((parsed) => (parsed?.kind === "raw" ? [parsed] : []))
      : [];
  if (files.length === 0 && rawSlices.length > 0) {
    return withReviewBar(
      <div className="space-y-4 px-4 py-5">
        {rawSlices.map((slice) => (
          <div key={`${slice.reason}:${slice.text.slice(0, 64)}`} className="space-y-2">
            <p className="text-xs text-muted-foreground">{slice.reason}</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{slice.text}</pre>
          </div>
        ))}
      </div>,
    );
  }

  if (items.length === 0 && nextCursor === null) {
    return withReviewBar(
      <p className="px-4 py-5 text-sm text-muted-foreground">
        {commit === null
          ? "This pull request has no file changes."
          : "This commit has no file changes."}
      </p>,
    );
  }

  const orphanThreads = detail.reviewThreads.filter((thread) => !placedThreadIds.has(thread.id));
  const orphanFiles = new Map<string, PullRequestReviewThread[]>();
  for (const thread of orphanThreads) {
    const existing = orphanFiles.get(thread.path);
    if (existing) existing.push(thread);
    else orphanFiles.set(thread.path, [thread]);
  }

  const unstructured =
    rawSlices.length === 0 ? null : (
      <div className="space-y-4 border-t border-border/60 px-4 py-5">
        {rawSlices.map((slice) => (
          <div key={`${slice.reason}:${slice.text.slice(0, 64)}`} className="space-y-2">
            <p className="text-xs text-muted-foreground">{slice.reason}</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{slice.text}</pre>
          </div>
        ))}
      </div>
    );

  return (
    <DiffWorkerPoolProvider>
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        {orphanFiles.size > 0 ? (
          <Collapsible
            className="shrink-0 border-b border-border/60"
            open={orphansOpen}
            onOpenChange={setOrphansOpen}
          >
            <h2>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs text-muted-foreground">
                <span>
                  {nextCursor === null
                    ? "Conversations not on the current diff"
                    : "Conversations not on the diff loaded so far"}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className={cn("size-3.5 transition-transform", orphansOpen && "rotate-90")}
                />
                <span aria-hidden className="tabular-nums">
                  {orphanThreads.length}
                </span>
                <span className="sr-only">
                  {orphanThreads.length === 1
                    ? "1 conversation"
                    : `${orphanThreads.length} conversations`}
                </span>
              </CollapsibleTrigger>
            </h2>
            <CollapsiblePanel>
              <div className="max-h-64 space-y-3 overflow-auto px-4 pb-3">
                {[...orphanFiles].map(([path, threads]) => (
                  <div key={path}>
                    <p className="truncate px-3 text-xs text-muted-foreground" title={path}>
                      {path}
                    </p>
                    <div className="mt-1 space-y-2">
                      {threads.map((thread) => (
                        <div key={thread.id}>
                          {thread.line === null ? null : (
                            <p className="px-3 text-xs text-muted-foreground">Line {thread.line}</p>
                          )}
                          {renderThreadCard(thread)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}
        <div
          className="relative min-h-0 flex-1"
          onClickCapture={(event) => {
            const composedPath = event.nativeEvent.composedPath?.() ?? [];
            for (const node of composedPath) {
              if (!(node instanceof HTMLElement)) continue;
              if (node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement) {
                return;
              }
              if (node.hasAttribute("data-diffs-header")) {
                const filePath = node.querySelector("[data-title]")?.textContent?.trim();
                if (filePath === undefined || filePath === "") return;
                const item = items.find(
                  (candidate) => resolveFileDiffPath(candidate.fileDiff) === filePath,
                );
                if (item !== undefined) toggleFile(item.id);
                return;
              }
            }
          }}
        >
          <StyledDiffCodeView<ReviewAnnotationGroup>
            className="h-full overflow-auto [scrollbar-gutter:stable]"
            items={items}
            selectedLines={selectedLines}
            onSelectedLinesChange={setSelectedLines}
            options={diffViewOptions}
            renderCodeViewFooter={renderCodeViewFooter}
            renderHeaderPrefix={renderHeaderPrefix}
            renderHeaderMetadata={renderHeaderMetadata}
            renderAnnotation={renderAnnotation}
            unsafeCSSExtra={REPLACE_FILE_COUNTS_CSS}
          />
          {reviewOverlay}
        </div>
        {unstructured}
      </div>
    </DiffWorkerPoolProvider>
  );
}

export default PullRequestCodeTab;
