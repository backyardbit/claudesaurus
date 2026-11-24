import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";

/** What a preview's own script posts: its frame's id and the height of its content. */
const FrameSizeSchema = z.object({ claudesaurusFrame: z.string(), height: z.number() });

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
      const size = FrameSizeSchema.safeParse(event.data);
      if (!size.success || size.data.claudesaurusFrame !== frameId) return;
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(size.data.height))));
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
