import { ExternalLinkIcon, PaperclipIcon, PlayIcon } from "lucide-react";

import { openLink } from "~/lib/links";
import { cn } from "~/lib/utils";

import ChatMarkdown from "../ChatMarkdown";
import { splitPullRequestBody } from "./pullRequestMarkdown.logic";

export function PullRequestMarkdown({
  text,
  className,
}: {
  text: string;
  cwd: string;
  className?: string;
}) {
  const segments = splitPullRequestBody(text);
  return (
    <div className={cn("space-y-3", className)}>
      {segments.map((segment) => {
        if (segment.kind === "markdown") {
          return <ChatMarkdown key={segment.id} text={segment.text} />;
        }
        const isVideo = segment.media === "video";
        const Icon = isVideo ? PlayIcon : PaperclipIcon;
        return (
          <a
            key={segment.id}
            href={segment.url}
            onClick={(event) => {
              event.preventDefault();
              openLink(segment.url);
            }}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm hover:bg-muted/60"
          >
            <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {isVideo ? "Copy the video's link" : "Copy the attachment's link"}
            </span>
            <ExternalLinkIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          </a>
        );
      })}
    </div>
  );
}
