import { CheckIcon, UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { PullRequestRef, PullRequestReviewerCandidate } from "~/contracts";
import { prQuery, usePrCommand, usePrQuery } from "~/lib/prApi";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestPeopleGhost } from "./PullRequestGhosts";
import { readableFailure } from "./pullRequestDetail.logic";
import { PullRequestActorLabel } from "./pullRequestPresentation";

function matches(candidate: PullRequestReviewerCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    candidate.login.toLowerCase().includes(needle) ||
    (candidate.name ?? "").toLowerCase().includes(needle)
  );
}

export function PullRequestReviewerPicker({
  reference,
  allowed,
  onRequested,
}: {
  reference: PullRequestRef;
  allowed: boolean;
  onRequested: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const candidatesQuery = usePrQuery(
    open ? prQuery("reviewerCandidates", { input: reference }) : null,
  );
  const requestReviewers = usePrCommand("requestReviewers");

  const candidates = useMemo(
    () => (candidatesQuery.data?.candidates ?? []).filter((entry) => matches(entry, query)),
    [candidatesQuery.data, query],
  );

  const toggle = async (candidate: PullRequestReviewerCandidate) => {
    if (pending !== null) return;
    setPending(candidate.id);
    const result = await requestReviewers({
      input: {
        ...reference,
        reviewers: [{ id: candidate.id, kind: candidate.kind }],
        requested: !candidate.isRequested,
      },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: candidate.isRequested
          ? `Could not take back the review request to ${candidate.login}`
          : `Could not ask ${candidate.login} for a review`,
        description: readableFailure(
          result.error,
          "The host refused it. Check that you have write access on this repository, and that they still have access to it.",
        ),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: candidate.isRequested
        ? `Review request to ${candidate.login} taken back`
        : `Review requested from ${candidate.login}`,
    });
    onRequested();
    candidatesQuery.refresh();
  };

  if (!allowed) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="icon-xs" variant="ghost" disabled aria-label="Request a review">
              <UserPlusIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          Asking someone to review needs write access on this repository
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button size="icon-xs" variant="ghost" aria-label="Request a review">
            <UserPlusIcon className="size-3.5" />
          </Button>
        }
      />
      <MenuPopup align="start" side="bottom" className="w-72 p-0">
        <div className="border-b border-border/60 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search people with access"
            aria-label="Search people with access"
            size="compact"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {candidatesQuery.isPending ? (
            <PullRequestPeopleGhost rows={4} />
          ) : candidatesQuery.error !== null ? (
            <p className="p-2 text-xs text-muted-foreground">
              The people with access could not be read. {candidatesQuery.error}
            </p>
          ) : candidates.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              {query.length > 0
                ? "Nobody with access matches that."
                : "Nobody else has access to this repository."}
            </p>
          ) : (
            candidates.map((candidate) => (
              <button
                key={`${candidate.kind}:${candidate.id}`}
                type="button"
                disabled={pending !== null}
                onClick={() => void toggle(candidate)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60 disabled:opacity-60"
              >
                <PullRequestActorLabel actor={candidate} className="min-w-0 flex-1 truncate" />
                {candidate.kind === "team" ? (
                  <span className="shrink-0 text-muted-foreground">team</span>
                ) : null}
                {candidate.isRequested ? (
                  <CheckIcon aria-label="Already asked" className="size-3.5 shrink-0" />
                ) : null}
              </button>
            ))
          )}
          {candidatesQuery.data?.truncated ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              This repository has more people with access than are listed here. Ask for the rest on
              the host.
            </p>
          ) : null}
        </div>
      </MenuPopup>
    </Menu>
  );
}
