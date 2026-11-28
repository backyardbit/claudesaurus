import { useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { PullRequestMarkdown } from "./PullRequestMarkdown";

export function PullRequestMarkdownEditor({
  value,
  cwd,
  placeholder,
  label,
  saving,
  allowEmpty = false,
  className,
  onSave,
  onCancel,
}: {
  readonly value: string;
  readonly cwd: string;
  readonly placeholder?: string | undefined;
  readonly label: string;
  readonly saving: boolean;
  readonly allowEmpty?: boolean;
  readonly className?: string | undefined;
  readonly onSave: (next: string) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  const empty = draft.trim().length === 0;

  return (
    <div
      className={cn("space-y-2", className)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || saving) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          variant={preview ? "ghost" : "outline"}
          disabled={saving}
          onClick={() => setPreview(false)}
        >
          Write
        </Button>
        <Button
          size="xs"
          variant={preview ? "outline" : "ghost"}
          disabled={saving}
          onClick={() => setPreview(true)}
        >
          Preview
        </Button>
      </div>
      {preview ? (
        <div className="rounded-lg border border-border/60 px-3 py-2">
          {empty ? (
            <p className="text-xs text-muted-foreground">Nothing to preview.</p>
          ) : (
            <PullRequestMarkdown text={draft} cwd={cwd} />
          )}
        </div>
      ) : (
        <Textarea
          autoFocus
          disabled={saving}
          value={draft}
          rows={6}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={saving || (empty && !allowEmpty)}
          onClick={() => onSave(draft)}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
