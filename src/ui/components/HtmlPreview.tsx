import { useEffect, useId, useRef, useState } from "react";

const MAX_HEIGHT = 640;
const MIN_HEIGHT = 48;

/** Reports the document's height to the host page so the frame can fit its content. */
function sizeReporter(frameId: string) {
  return `<script>(() => {
  const report = () => parent.postMessage({ claudesaurusFrame: ${JSON.stringify(frameId)}, height: document.documentElement.scrollHeight }, "*");
  new ResizeObserver(report).observe(document.documentElement);
  addEventListener("load", report);
  report();
})();</script>`;
}

const BASE_STYLE =
  "<style>html{color-scheme:light;background:white}body{margin:12px;font:15px/1.5 system-ui,sans-serif}</style>";

/** Runs HTML (scripts included) in a sandboxed frame with no access to the chat page. */
export function HtmlPreview({ html }: { html: string }) {
  const frameId = useId();
  const [height, setHeight] = useState(MIN_HEIGHT);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      if (!("claudesaurusFrame" in data) || data.claudesaurusFrame !== frameId) return;
      if (!("height" in data) || typeof data.height !== "number") return;
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(data.height))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId]);

  return (
    <iframe
      ref={frame}
      className="html-frame"
      title="HTML preview"
      sandbox="allow-scripts allow-forms"
      srcDoc={`${BASE_STYLE}${html}${sizeReporter(frameId)}`}
      style={{ height }}
    />
  );
}
