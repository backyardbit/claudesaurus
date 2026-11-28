import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";

const FrameSizeSchema = z.object({ claudesaurusFrame: z.string(), height: z.number() });

const MAX_HEIGHT = 640;
const MIN_HEIGHT = 48;

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
