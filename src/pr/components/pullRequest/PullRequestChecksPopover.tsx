import type { PullRequestCheck, PullRequestChecksState } from "~/contracts";
import { openLink } from "~/lib/links";
import { cn } from "~/lib/utils";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  PullRequestCheckStatusIcon,
  pullRequestCheckStatusLabel,
  pullRequestChecksStatePresentation,
  summarizePullRequestChecks,
} from "./pullRequestPresentation";

function ChecksBody({ checks }: { checks: ReadonlyArray<PullRequestCheck> }) {
  if (checks.length === 0) {
    return <p className="text-muted-foreground text-xs">No checks reported</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {/* Keyed by position as well as by name: the host is the one that decides how many runs
          share a name, and a repeated key is a rendering fault rather than a wrong list. */}
      {checks.map((check, index) => (
        <li key={`${index}:${check.name}`} className="flex items-center gap-2 text-xs">
          <PullRequestCheckStatusIcon status={check.status} />
          <span className="min-w-0 flex-1 truncate" title={check.description ?? check.name}>
            {check.name}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {pullRequestCheckStatusLabel(check.status)}
          </span>
          {check.url === null ? null : (
            <button
              type="button"
              className="shrink-0 text-primary hover:underline"
              onClick={() => openLink(check.url ?? "")}
            >
              Details
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The checks indicator in the detail header, and the list of checks it opens. */
export function PullRequestChecksPopover({
  checksState,
  checks,
  className,
}: {
  checksState: PullRequestChecksState;
  checks: ReadonlyArray<PullRequestCheck>;
  className?: string;
}) {
  const presentation = pullRequestChecksStatePresentation(checksState);
  // Counts beat the rollup's own wording where they are known, the way GitHub's own header reads.
  const summary = summarizePullRequestChecks(checks);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <span
            role="button"
            tabIndex={0}
            aria-label={`Checks: ${presentation.label}`}
            className={cn("inline-flex shrink-0 cursor-pointer items-center", className)}
          />
        }
        onClick={(event) => event.stopPropagation()}
      >
        <presentation.Icon aria-hidden className={cn("size-3.5", presentation.toneClassName)} />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-80 max-w-full" side="bottom">
        <p className="mb-2 font-medium text-sm">{presentation.label}</p>
        {summary === null ? null : <p className="mb-2 text-muted-foreground text-xs">{summary}</p>}
        <ChecksBody checks={checks} />
      </PopoverPopup>
    </Popover>
  );
}
