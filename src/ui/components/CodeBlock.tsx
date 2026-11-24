import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useActions } from "../store";
import { HtmlPreview } from "./HtmlPreview";

export function CopyButton({ text }: { text: string }) {
  const actions = useActions();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      title="Copy"
      onClick={() => {
        actions.copy(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

const PREVIEWABLE = new Set(["html", "svg"]);

function svgDataUrl(source: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

type CodeBlockProps = {
  language: string | null;
  source: string;
  /** The highlighted code, shown as the source view. */
  children: ReactNode;
  /** While the block is still being written, the preview waits. */
  streaming: boolean;
};

export function CodeBlock({ language, source, children, streaming }: CodeBlockProps) {
  const previewable = language !== null && PREVIEWABLE.has(language);
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const showPreview = previewable && !streaming && view === "rendered";

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-language">{language ?? "text"}</span>
        {previewable && !streaming && (
          <div className="segmented">
            <button
              type="button"
              className={view === "rendered" ? "active" : ""}
              onClick={() => setView("rendered")}
            >
              Rendered
            </button>
            <button
              type="button"
              className={view === "source" ? "active" : ""}
              onClick={() => setView("source")}
            >
              Source
            </button>
          </div>
        )}
        <CopyButton text={source} />
      </div>
      {showPreview && language === "html" && <HtmlPreview html={source} />}
      {showPreview && language === "svg" && (
        <div className="svg-preview">
          <img src={svgDataUrl(source)} alt="SVG preview" />
        </div>
      )}
      {!showPreview && <pre>{children}</pre>}
    </div>
  );
}
