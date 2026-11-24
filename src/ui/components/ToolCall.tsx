import {
  Bot,
  ChevronRight,
  FilePlus,
  FileText,
  Globe,
  ListTodo,
  type LucideIcon,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { basename, formatDuration } from "../format";
import type { ToolInput, ToolResponse } from "../meta";
import type { Item, ToolState } from "../store";
import { CopyButton } from "./CodeBlock";
import {
  type DiffRow,
  DiffView,
  diffStats,
  patchHunks,
  rowsFromHunks,
  rowsFromTexts,
} from "./DiffView";
import { HtmlPreview } from "./HtmlPreview";
import { Output } from "./Output";

type Summary = {
  icon: LucideIcon;
  label: string;
  detail: string;
  /** Detail that is code (a path, a pattern) rather than prose. */
  mono?: boolean;
  badge?: string;
};

function summarize(tool: ToolState): Summary {
  const { input } = tool;
  const file = input.file_path ?? input.notebook_path;
  switch (tool.toolName) {
    case "Read":
      return { icon: FileText, label: "Read", detail: file ? basename(file) : "", mono: true };
    case "Write":
      return { icon: FilePlus, label: "Write", detail: file ? basename(file) : "", mono: true };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { icon: Pencil, label: "Edit", detail: file ? basename(file) : "", mono: true };
    case "Bash": {
      const description = input.description;
      const command = input.command ?? "";
      return {
        icon: SquareTerminal,
        label: "Bash",
        detail: description ?? command.split("\n")[0] ?? "",
        mono: !description,
      };
    }
    case "Grep":
      return {
        icon: Search,
        label: "Search",
        detail: `“${input.pattern ?? ""}”`,
        mono: true,
      };
    case "Glob":
      return {
        icon: Search,
        label: "Find",
        detail: input.pattern ?? "",
        mono: true,
      };
    case "WebFetch":
      return { icon: Globe, label: "Fetch", detail: input.url ?? "", mono: true };
    case "WebSearch":
      return { icon: Globe, label: "Web search", detail: input.query ?? "" };
    case "Task":
    case "Agent":
      return {
        icon: Bot,
        label: "Agent",
        detail: input.description ?? tool.title,
        badge: input.subagent_type,
      };
    case "TodoWrite":
      return { icon: ListTodo, label: "Todo", detail: todoProgress(input) };
    case "Skill":
      return { icon: Sparkles, label: "Skill", detail: input.skill ?? tool.title };
    default:
      return { icon: Wrench, label: tool.toolName ?? "Tool", detail: tool.title };
  }
}

function todoProgress({ todos }: ToolInput) {
  if (!todos) return "";
  const done = todos.filter((todo) => todo.status === "completed").length;
  return `${done}/${todos.length}`;
}

function contentText(tool: ToolState) {
  const parts: string[] = [];
  for (const entry of tool.content) {
    if (entry.type === "content" && entry.content.type === "text") parts.push(entry.content.text);
  }
  return parts.join("\n");
}

/** The adapter wraps command output in a ```console fence; the card shows it bare. */
function stripFence(text: string) {
  const match = /^```[a-z]*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  return match?.[1] ?? text;
}

function bashOutput(tool: ToolState) {
  const stdout = tool.response?.stdout;
  const stderr = tool.response?.stderr;
  if (stdout !== undefined || stderr !== undefined) {
    return { stdout: stdout ?? "", stderr: stderr ?? "" };
  }
  if (tool.status === "pending" || tool.status === "in_progress") return { stdout: "", stderr: "" };
  const text = tool.output ?? stripFence(contentText(tool));
  return tool.status === "failed" ? { stdout: "", stderr: text } : { stdout: text, stderr: "" };
}

function diffRows(response: ToolResponse | null, content: ToolState["content"]) {
  const hunks = patchHunks(response);
  if (hunks) return rowsFromHunks(hunks);
  const rows: DiffRow[] = [];
  for (const entry of content) {
    if (entry.type === "diff") rows.push(...rowsFromTexts(entry.oldText ?? null, entry.newText));
  }
  return rows;
}

/** A whole HTML or SVG file that Claude just wrote, which can be shown live. */
function writtenPage(tool: ToolState) {
  if (tool.toolName !== "Write") return null;
  const file = tool.input.file_path ?? "";
  if (!/\.(html?|svg)$/i.test(file)) return null;
  return tool.input.content ?? null;
}

function resultCount(tool: ToolState) {
  const files = tool.response?.numFiles;
  if (files !== undefined) return `${files} ${files === 1 ? "file" : "files"}`;
  const lines = tool.response?.numLines;
  if (lines !== undefined) return `${lines} ${lines === 1 ? "line" : "lines"}`;
  return null;
}

/** Tools whose row already says what was asked, so only their result is worth showing. */
const SELF_DESCRIBING = new Set([
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Skill",
]);

function genericBody(tool: ToolState) {
  const output = tool.output ?? stripFence(contentText(tool));
  const described = tool.toolName !== null && SELF_DESCRIBING.has(tool.toolName);
  const input =
    described || tool.rawInput === undefined ? "" : JSON.stringify(tool.rawInput, null, 2);
  const showInput = input !== "" && input !== "{}";
  if (!output && !showInput) return null;
  return (
    <>
      {showInput && <Output text={input} />}
      {output && <Output text={output} tone={tool.status === "failed" ? "error" : "normal"} />}
    </>
  );
}

type ToolCallProps = {
  tool: ToolState;
  renderChildren(items: Item[]): ReactNode;
};

export function ToolCall({ tool, renderChildren }: ToolCallProps) {
  const summary = summarize(tool);
  const Icon = summary.icon;
  const active = tool.status === "pending" || tool.status === "in_progress";
  const failed = tool.status === "failed";
  const isEdit = tool.kind === "edit" || tool.content.some((entry) => entry.type === "diff");
  const isBash = tool.toolName === "Bash";
  const [open, setOpen] = useState<boolean | null>(null);
  const [preview, setPreview] = useState(false);
  const { response, content } = tool;
  const rows = useMemo(
    () => (isEdit ? diffRows(response, content) : []),
    [isEdit, response, content],
  );

  let meta: ReactNode = null;
  let body: ReactNode = null;
  let footer: ReactNode = null;
  let openByDefault = false;

  if (isEdit) {
    const stats = diffStats(rows);
    const page = writtenPage(tool);
    openByDefault = true;
    meta = (
      <>
        {page !== null && !active && (
          <button
            type="button"
            className="link-button"
            onClick={(event) => {
              event.stopPropagation();
              setPreview((shown) => !shown);
            }}
          >
            {preview ? "Show diff" : "Preview"}
          </button>
        )}
        {stats.added > 0 && <span className="added">+{stats.added}</span>}
        {stats.removed > 0 && <span className="removed">−{stats.removed}</span>}
      </>
    );
    if (preview && page !== null)
      body = (
        <div className="card page-preview">
          <HtmlPreview html={page} />
        </div>
      );
    else if (rows.length > 0) body = <DiffView rows={rows} />;
  } else if (isBash) {
    const command = tool.input.command ?? "";
    const { stdout, stderr } = bashOutput(tool);
    openByDefault = true;
    body = (
      <>
        {command && (
          <div className="card command">
            <pre>{command}</pre>
            <CopyButton text={command} />
          </div>
        )}
        {stdout && <Output text={stdout} />}
        {stderr && <Output text={stderr} tone="error" />}
      </>
    );
    if (!active && tool.endedAt !== null) {
      footer = (
        <div className={`tool-footer ${failed ? "failed" : ""}`}>
          {failed ? "Failed" : "Done"}{" "}
          {tool.timed && (
            <span className="dim">{formatDuration(tool.endedAt - tool.startedAt)}</span>
          )}
        </div>
      );
    }
  } else if (tool.children.length > 0) {
    meta = <span>{tool.children.length} steps</span>;
    body = <div className="nested">{renderChildren(tool.children)}</div>;
    openByDefault = active;
  } else {
    meta = resultCount(tool);
    body = genericBody(tool);
  }

  const expanded = open ?? openByDefault;
  const expandable = body !== null;

  return (
    <div className={`tool ${failed ? "failed" : ""}`}>
      <button
        type="button"
        className="tool-row"
        disabled={!expandable}
        onClick={() => setOpen(!expanded)}
      >
        <span className={`tool-icon ${active ? "active" : ""}`}>
          <Icon size={15} />
        </span>
        <span className="tool-label">{summary.label}</span>
        {summary.badge && <span className="badge">{summary.badge}</span>}
        <span className={`tool-detail ${summary.mono ? "mono" : ""}`}>{summary.detail}</span>
        {expandable && <ChevronRight size={13} className={`chevron ${expanded ? "open" : ""}`} />}
        <span className="tool-meta">{meta}</span>
      </button>
      {expanded && body}
      {footer}
    </div>
  );
}
