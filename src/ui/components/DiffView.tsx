import { diffLines } from "diff";
import { useMemo, useState } from "react";
import type { PatchHunk, ToolResponse } from "../meta";

export type DiffRow = {
  type: "add" | "remove" | "context";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

/** The unified hunks Claude Code reports for a finished edit, which carry real line numbers. */
export function patchHunks(response: ToolResponse | null) {
  const patch = response?.structuredPatch;
  return patch && patch.length > 0 ? patch : null;
}

export function rowsFromHunks(hunks: PatchHunk[]) {
  const rows: DiffRow[] = [];
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      const text = line.slice(1);
      if (line.startsWith("+")) rows.push({ type: "add", oldLine: null, newLine: newLine++, text });
      else if (line.startsWith("-"))
        rows.push({ type: "remove", oldLine: oldLine++, newLine: null, text });
      else rows.push({ type: "context", oldLine: oldLine++, newLine: newLine++, text });
    }
  }
  return rows;
}

export function rowsFromTexts(oldText: string | null, newText: string) {
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of diffLines(oldText ?? "", newText)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) {
      if (part.added) rows.push({ type: "add", oldLine: null, newLine: newLine++, text });
      else if (part.removed) rows.push({ type: "remove", oldLine: oldLine++, newLine: null, text });
      else rows.push({ type: "context", oldLine: oldLine++, newLine: newLine++, text });
    }
  }
  return rows;
}

export function diffStats(rows: DiffRow[]) {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === "add") added += 1;
    else if (row.type === "remove") removed += 1;
  }
  return { added, removed };
}

const COLLAPSED_ROWS = 16;
const MARKERS = { add: "+", remove: "−", context: " " };

export function DiffView({ rows }: { rows: DiffRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(
    () => (expanded ? rows : rows.slice(0, COLLAPSED_ROWS)),
    [rows, expanded],
  );
  const hidden = rows.length - visible.length;
  return (
    <div className="card diff">
      <div className="diff-rows">
        {visible.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reorder
          <div key={index} className={`diff-row ${row.type}`}>
            <span className="diff-line">{row.oldLine ?? row.newLine}</span>
            <span className="diff-marker">{MARKERS[row.type]}</span>
            <span className="diff-text">{row.text || " "}</span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <button type="button" className="more" onClick={() => setExpanded(true)}>
          {hidden} more {hidden === 1 ? "line" : "lines"}
        </button>
      )}
    </div>
  );
}
