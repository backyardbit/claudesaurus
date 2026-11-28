import {
  ArrowDownUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HammerIcon,
  MessageSquareIcon,
  PencilIcon,
  SendIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type {
  PullRequestActor,
  PullRequestComment,
  PullRequestDetailView,
  PullRequestRef,
} from "~/contracts";
import { openLink } from "~/lib/links";
import { usePrCommand } from "~/lib/prApi";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestActivityUnavailableState } from "./PullRequestActivityUnavailableState";
import { PullRequestConversationGhost } from "./PullRequestGhosts";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor";
import { PullRequestReactionBar } from "./PullRequestReactions";
import { PullRequestReviewerPicker } from "./PullRequestReviewerPicker";
import {
  orderPullRequestComments,
  type PullRequestFinding,
  pullRequestFindingKey,
} from "./pullRequestDetail.logic";
import {
  canEditPullRequestChangeRequest,
  canEditPullRequestComment,
} from "./pullRequestEditing.logic";
import {
  PullRequestActorAvatar,
  PullRequestActorLabel,
  PullRequestCheckStatusIcon,
  pullRequestCheckStatusLabel,
} from "./pullRequestPresentation";
import { sectionCollapseAnchorScrollTop } from "./pullRequestSummaryScroll.logic";

function labelDotColor(color: string | null): string | null {
  const hex = color?.trim().replace(/^#/, "") ?? "";
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : null;
}

function CommentAuthor({ actor }: { actor: PullRequestActor | null }) {
  const login = actor?.login ?? "ghost";
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="shrink-0 rounded-full" aria-label={login} />}>
        <PullRequestActorAvatar actor={actor} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {actor?.name && actor.name !== login ? `${actor.name} (@${login})` : login}
      </TooltipPopup>
    </Tooltip>
  );
}

function reviewStateLabel(state: string): string {
  const words = state.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface CommentEditing {
  readonly cwd: string;
  readonly canEdit: (comment: PullRequestComment) => boolean;
  readonly editingId: string | null;
  readonly saving: boolean;
  readonly onEdit: (comment: PullRequestComment | null) => void;
  readonly onSave: (comment: PullRequestComment, body: string) => void;
}

function CommentBody({
  comment,
  editing,
  className,
}: {
  comment: PullRequestComment;
  editing: CommentEditing;
  className?: string | undefined;
}) {
  if (editing.editingId === comment.id) {
    return (
      <PullRequestMarkdownEditor
        className={className}
        value={comment.body}
        cwd={editing.cwd}
        label="Edit comment"
        saving={editing.saving}
        onSave={(body) => editing.onSave(comment, body)}
        onCancel={() => editing.onEdit(null)}
      />
    );
  }
  return (
    <div className={cn("flex items-start gap-1", className)}>
      <PullRequestMarkdown className="min-w-0 flex-1" text={comment.body} cwd={editing.cwd} />
      {editing.canEdit(comment) ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Edit comment"
          onClick={() => editing.onEdit(comment)}
        >
          <PencilIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

function CollapsedComment({
  comment,
  editing,
  label,
  reactionBar,
}: {
  comment: PullRequestComment;
  editing: CommentEditing;
  label: string;
  reactionBar: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <article className="group rounded-lg border border-border/60 [contain-intrinsic-block-size:44px] [content-visibility:auto]">
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 p-3 text-left transition-opacity hover:opacity-100",
            open ? "opacity-100" : "opacity-65",
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <CommentAuthor actor={comment.author} />
            <span>{formatRelativeTimeLabel(comment.createdAt)}</span>
            <span>{label}</span>
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          {open ? (
            <div className="px-3 pb-3">
              {comment.path ? (
                <p className="truncate text-xs text-muted-foreground" title={comment.path}>
                  {comment.path}
                </p>
              ) : null}
              <CommentBody className="mt-2" comment={comment} editing={editing} />
              {reactionBar}
            </div>
          ) : null}
        </CollapsiblePanel>
      </article>
    </Collapsible>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 flex-1 text-foreground">{children}</span>
    </div>
  );
}

function Section({
  title,
  count,
  defaultOpen = true,
  actions,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingRef = useRef<HTMLDivElement>(null);
  const setOpenWithScrollAnchor = (nextOpen: boolean) => {
    if (!nextOpen) {
      const heading = headingRef.current;
      const section = heading?.closest<HTMLElement>("[data-pull-request-summary-section]");
      const scroller = heading?.closest<HTMLElement>("[data-pull-request-summary-scroll]");
      if (heading && section && scroller) {
        const target = sectionCollapseAnchorScrollTop({
          scrollTop: scroller.scrollTop,
          viewportTop: scroller.getBoundingClientRect().top,
          sectionTop: section.getBoundingClientRect().top,
          headingTop: heading.getBoundingClientRect().top,
        });
        if (target !== null) scroller.scrollTop = target;
      }
    }
    setOpen(nextOpen);
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpenWithScrollAnchor}
      data-pull-request-summary-section
    >
      <div
        ref={headingRef}
        className="sticky top-0 z-10 flex w-full items-center border-t border-border/60 bg-background pr-4"
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-sm font-medium">
          <span>{title}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          {count === undefined ? null : (
            <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
          )}
        </CollapsibleTrigger>
        {open ? actions : null}
      </div>
      <CollapsiblePanel>
        <div className="px-4 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function CommentComposer({
  detail,
  onCommented,
}: {
  detail: PullRequestDetailView;
  onCommented: () => void;
}) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const postComment = usePrCommand("comment");

  const submit = async () => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || posting) return;
    setPosting(true);
    const result = await postComment({
      input: {
        repository: detail.repository,
        number: detail.number,
        body: trimmed,
      },
    });
    setPosting(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not post the comment" });
      return;
    }
    setBody("");
    onCommented();
  };

  return (
    <div className="mt-3 space-y-2">
      <Textarea
        disabled={posting}
        value={body}
        rows={3}
        placeholder="Leave a comment"
        aria-label="Comment on this pull request"
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          size="xs"
          variant="outline"
          disabled={body.trim().length === 0 || posting}
          onClick={() => void submit()}
        >
          <SendIcon className="size-3.5" />
          {posting ? "Posting..." : "Comment"}
        </Button>
      </div>
    </div>
  );
}

const COMMENT_PAGE = 30;

export function PullRequestSummaryTab({
  reference,
  detail,
  activityPending,
  activityError,
  pendingFinding,
  fixFindingLabel = "Fix in a thread",
  fixCheckLabel = "Fix",
  onFixFinding,
  onRefresh,
}: {
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  activityPending: boolean;
  activityError: string | null;
  pendingFinding?: string | null;
  fixFindingLabel?: string;
  fixCheckLabel?: string;
  onFixFinding?: (finding: PullRequestFinding) => void;
  onRefresh: () => void;
}) {
  const [shown, setShown] = useState({ url: detail.url, count: COMMENT_PAGE });
  const shownComments = shown.url === detail.url ? shown.count : COMMENT_PAGE;
  const recentComments = detail.comments.slice(Math.max(0, detail.comments.length - shownComments));
  const hiddenCommentCount = detail.comments.length - recentComments.length;
  const [commentOrder, setCommentOrder] = useState<"newest" | "oldest">("newest");
  const visibleComments = orderPullRequestComments(recentComments, commentOrder);

  const threadByCommentId = new Map(
    detail.reviewThreads.flatMap((thread) =>
      thread.comments.map((comment) => [comment.id, thread] as const),
    ),
  );

  const openCheck = (url: string) => {
    openLink(url);
  };

  const update = usePrCommand("update");
  const updateComment = usePrCommand("updateComment");
  const [bodyScope, setBodyScope] = useState<string | null>(null);
  const [bodySaving, setBodySaving] = useState(false);
  const [commentScope, setCommentScope] = useState<{
    readonly pullRequest: string;
    readonly commentId: string;
  } | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const editingCommentId = commentScope?.pullRequest === detail.url ? commentScope.commentId : null;

  const saveBody = async (body: string) => {
    if (bodySaving) return;
    setBodySaving(true);
    const result = await update({ input: { ...reference, body } });
    setBodySaving(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not save the description" });
      return;
    }
    setBodyScope(null);
    onRefresh();
  };

  const commentEditing: CommentEditing = {
    cwd: detail.workspaceRoot,
    canEdit: (comment) => canEditPullRequestComment(detail, comment),
    editingId: editingCommentId,
    saving: commentSaving,
    onEdit: (comment) =>
      setCommentScope(comment === null ? null : { pullRequest: detail.url, commentId: comment.id }),
    onSave: async (comment, body) => {
      if (commentSaving || comment.kind === "review") return;
      setCommentSaving(true);
      const result = await updateComment({
        input: { ...reference, commentId: comment.id, kind: comment.kind, body },
      });
      setCommentSaving(false);
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not save the comment" });
        return;
      }
      setCommentScope(null);
      onRefresh();
    },
  };

  return (
    <div className="h-full overflow-y-auto" data-pull-request-summary-scroll>
      <section className="px-4 py-3">
        <div>
          <MetaRow icon={<UsersIcon className="size-3.5" />} label="Reviewers">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {detail.reviewers.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <span className="flex items-center -space-x-1">
                  {detail.reviewers.map((actor) => (
                    <Tooltip key={actor.login}>
                      <TooltipTrigger
                        render={
                          <span
                            className="relative rounded-full hover:z-10"
                            aria-label={actor.name ?? actor.login}
                          />
                        }
                      >
                        <PullRequestActorLabel
                          actor={actor}
                          className="gap-0 [&>img]:ring-2 [&>img]:ring-background [&>span:first-child]:ring-2 [&>span:first-child]:ring-background [&>span:last-child]:sr-only"
                        />
                      </TooltipTrigger>
                      <TooltipPopup side="bottom">
                        {actor.name && actor.name !== actor.login
                          ? `${actor.name} (@${actor.login})`
                          : actor.login}
                      </TooltipPopup>
                    </Tooltip>
                  ))}
                </span>
              )}
              {detail.capabilities.reviewers.request &&
              detail.capabilities.reviewers.listCandidates ? (
                <PullRequestReviewerPicker
                  reference={reference}
                  allowed={detail.viewerPermissions.requestReviewers}
                  onRequested={onRefresh}
                />
              ) : null}
            </span>
          </MetaRow>
          {detail.labels.length > 0 ? (
            <MetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {detail.labels.map((label) => {
                  const dot = labelDotColor(label.color);
                  return (
                    <span
                      key={label.name}
                      className="inline-flex max-w-48 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 py-0.5 pl-1.5 pr-2 text-xs"
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full bg-muted-foreground"
                        {...(dot ? { style: { backgroundColor: dot } } : {})}
                      />
                      <span className="truncate">{label.name}</span>
                    </span>
                  );
                })}
              </span>
            </MetaRow>
          ) : null}
          <MetaRow icon={<MessageSquareIcon className="size-3.5" />} label="Comments">
            {activityPending
              ? "Loading conversation…"
              : activityError
                ? "Conversation unavailable"
                : detail.commentCount === 1
                  ? "1 comment"
                  : `${detail.commentCount} comments`}
          </MetaRow>
        </div>
      </section>

      <Section title="Description">
        <div className="group">
          {bodyScope === detail.url ? (
            <PullRequestMarkdownEditor
              allowEmpty
              value={detail.body}
              cwd={detail.workspaceRoot}
              label="Pull request description"
              placeholder="Describe this pull request"
              saving={bodySaving}
              onSave={(body) => void saveBody(body)}
              onCancel={() => setBodyScope(null)}
            />
          ) : (
            <div className="flex items-start gap-1">
              <PullRequestMarkdown
                className="min-w-0 flex-1"
                text={detail.body.trim().length > 0 ? detail.body : "_No description provided._"}
                cwd={detail.workspaceRoot}
              />
              {canEditPullRequestChangeRequest(detail) ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Edit description"
                  onClick={() => setBodyScope(detail.url)}
                >
                  <PencilIcon className="size-3" />
                </Button>
              ) : null}
            </div>
          )}
          <PullRequestReactionBar
            className="mt-2"
            reactions={detail.reactions ?? []}
            canReact={detail.capabilities.reactions === true}
            reference={reference}
            onRefresh={onRefresh}
          />
        </div>
      </Section>

      <Section title="Checks" count={detail.checks.length}>
        {detail.checks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No checks reported.</p>
        ) : (
          <div className="space-y-0.5">
            {detail.checks.map((check, index) => {
              const finding = { kind: "check", check } as const;
              const failing = check.status === "failure" || check.status === "cancelled";
              return (
                <div
                  key={`${index}:${check.name}:${check.url ?? ""}`}
                  className="group flex items-center gap-1 rounded-md pr-1 hover:bg-accent/60"
                >
                  <button
                    type="button"
                    disabled={!check.url}
                    onClick={() => check.url && openCheck(check.url)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                      check.url ? undefined : "cursor-default",
                    )}
                  >
                    <PullRequestCheckStatusIcon status={check.status} />
                    <span className="min-w-0 flex-1 truncate">{check.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {pullRequestCheckStatusLabel(check.status)}
                    </span>
                  </button>
                  {onFixFinding && failing ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="shrink-0"
                      disabled={pendingFinding !== null && pendingFinding !== undefined}
                      onClick={() => onFixFinding(finding)}
                    >
                      <HammerIcon className="size-3" />
                      {pendingFinding === pullRequestFindingKey(finding)
                        ? "Preparing..."
                        : fixCheckLabel}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Comments"
        {...(activityPending || activityError ? {} : { count: detail.commentCount })}
        actions={
          !activityPending && !activityError && detail.comments.length > 0 ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-[10px] text-muted-foreground"
              aria-label={
                commentOrder === "newest"
                  ? "Show oldest comments first"
                  : "Show newest comments first"
              }
              onClick={() => setCommentOrder((value) => (value === "newest" ? "oldest" : "newest"))}
            >
              <ArrowDownUpIcon aria-hidden className="size-3" />
              {commentOrder === "newest" ? "Newest first" : "Oldest first"}
            </Button>
          ) : null
        }
      >
        {activityPending ? (
          <PullRequestConversationGhost />
        ) : activityError ? (
          <PullRequestActivityUnavailableState compact error={activityError} onRetry={onRefresh} />
        ) : (
          <>
            {detail.commentsTruncated ? (
              <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs">
                This conversation is longer than this page reads in one go. The most recent{" "}
                {detail.comments.length} are here; open it on the host to read the rest.
              </p>
            ) : null}
            {detail.comments.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <div className="space-y-3">
                {hiddenCommentCount > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      setShown({ url: detail.url, count: shownComments + COMMENT_PAGE })
                    }
                  >
                    Show {Math.min(hiddenCommentCount, COMMENT_PAGE)} earlier{" "}
                    {hiddenCommentCount === 1 ? "comment" : "comments"}
                  </Button>
                ) : null}
                {visibleComments.map((comment) => {
                  const thread = threadByCommentId.get(comment.id);
                  const reviewState = comment.reviewState?.toLowerCase();
                  if (thread?.isResolved || reviewState === "dismissed") {
                    return (
                      <CollapsedComment
                        key={comment.id}
                        comment={comment}
                        editing={commentEditing}
                        label={thread?.isResolved ? "Resolved" : "Approval dismissed"}
                        reactionBar={
                          <PullRequestReactionBar
                            className="mt-2"
                            reactions={comment.reactions ?? []}
                            canReact={detail.capabilities.reactions === true}
                            subjectId={comment.id}
                            reference={reference}
                            onRefresh={onRefresh}
                          />
                        }
                      />
                    );
                  }
                  const finding: PullRequestFinding | null =
                    (comment.kind !== "review" && comment.kind !== "review-comment") ||
                    reviewState === "approved"
                      ? null
                      : thread === undefined
                        ? { kind: "comment", comment }
                        : { kind: "thread", thread };
                  return (
                    <article
                      key={comment.id}
                      className="group rounded-lg border border-border/60 p-3 [contain-intrinsic-block-size:120px] [content-visibility:auto]"
                    >
                      <div className="flex items-start gap-2">
                        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
                          <CommentAuthor actor={comment.author} />
                          <span>{formatRelativeTimeLabel(comment.createdAt)}</span>
                          {comment.reviewState ? (
                            <span>{reviewStateLabel(comment.reviewState)}</span>
                          ) : null}
                        </span>
                        {onFixFinding && finding ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="-mt-1 shrink-0"
                            disabled={pendingFinding !== null && pendingFinding !== undefined}
                            onClick={() => onFixFinding(finding)}
                          >
                            <HammerIcon className="size-3" />
                            {pendingFinding === pullRequestFindingKey(finding)
                              ? "Preparing..."
                              : fixFindingLabel}
                          </Button>
                        ) : null}
                      </div>
                      {comment.path ? (
                        <p
                          className="mt-1 truncate text-xs text-muted-foreground"
                          title={comment.path}
                        >
                          {comment.path}
                        </p>
                      ) : null}
                      <CommentBody className="mt-2" comment={comment} editing={commentEditing} />
                      <PullRequestReactionBar
                        className="mt-2"
                        reactions={comment.reactions ?? []}
                        canReact={detail.capabilities.reactions === true}
                        subjectId={comment.id}
                        reference={reference}
                        onRefresh={onRefresh}
                      />
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
        {detail.capabilities.comment && detail.viewerPermissions.comment ? (
          <CommentComposer
            key={`${detail.repository}#${detail.number}`}
            detail={detail}
            onCommented={onRefresh}
          />
        ) : null}
      </Section>
    </div>
  );
}
