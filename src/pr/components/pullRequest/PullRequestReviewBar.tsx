import { CheckIcon, MessageSquareIcon, XCircleIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PullRequestRef, PullRequestReviewVerdict } from "~/contracts";
import { usePrCommand } from "~/lib/prApi";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";

const VERDICTS: ReadonlyArray<{
  readonly value: PullRequestReviewVerdict;
  readonly label: string;
  readonly sent: string;
  readonly icon: ReactNode;
}> = [
  {
    value: "comment",
    label: "Comment",
    sent: "Review submitted",
    icon: <MessageSquareIcon className="size-3" />,
  },
  {
    value: "approve",
    label: "Approve",
    sent: "Pull request approved",
    icon: <CheckIcon className="size-3" />,
  },
  {
    value: "request-changes",
    label: "Request changes",
    sent: "Changes requested",
    icon: <XCircleIcon className="size-3" />,
  },
];

export function PullRequestReviewBar({
  reference,
  verdicts,
  onSubmitted,
}: {
  reference: PullRequestRef;
  verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  onSubmitted: () => void;
}) {
  const [pending, setPending] = useState(false);
  const comments = usePendingReviewComments(reference);
  const reviewKey = pullRequestReviewKey(reference);
  const body = usePullRequestReviewStore((store) => store.summaries[reviewKey] ?? "");
  const clear = usePullRequestReviewStore((store) => store.clear);
  const removeComments = usePullRequestReviewStore((store) => store.removeComments);
  const setSummary = usePullRequestReviewStore((store) => store.setSummary);
  const clearSummary = usePullRequestReviewStore((store) => store.clearSummary);
  const submitReview = usePrCommand("submitReview");

  const offered = VERDICTS.filter((verdict) => verdicts.includes(verdict.value));
  if (offered.length === 0) return null;

  const submit = async (verdict: (typeof VERDICTS)[number]) => {
    if (pending) return;
    const submittedBody = body;
    const submittedComments = comments;
    setPending(true);
    const result = await submitReview({
      input: {
        ...reference,
        verdict: verdict.value,
        body: submittedBody,
        comments: submittedComments.map(({ id: _id, ...draft }) => draft),
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "The review could not be submitted" });
      return;
    }
    removeComments(
      reviewKey,
      submittedComments.map((comment) => comment.id),
    );
    clearSummary(reviewKey, submittedBody);
    toastManager.add({ type: "success", title: verdict.sent });
    onSubmitted();
  };

  const canSubmit = (verdict: PullRequestReviewVerdict) =>
    verdict === "approve" || body.trim().length > 0 || comments.length > 0;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {comments.length === 0
            ? "No line comments yet"
            : `${comments.length} ${comments.length === 1 ? "comment" : "comments"} pending`}
        </span>
        {comments.length > 0 ? (
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => clear(reviewKey)}>
            Discard
          </Button>
        ) : null}
      </div>
      <Textarea
        size="sm"
        className="mt-2"
        value={body}
        placeholder="Summarize your review (optional)"
        aria-label="Review summary"
        onChange={(event) => setSummary(reviewKey, event.target.value)}
      />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {offered.map((verdict) => (
          <Button
            key={verdict.value}
            size="xs"
            variant={verdict.value === "comment" ? "outline" : "default"}
            disabled={pending || !canSubmit(verdict.value)}
            onClick={() => void submit(verdict)}
          >
            <span className="flex items-center gap-1.5">
              {verdict.icon}
              {verdict.label}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
