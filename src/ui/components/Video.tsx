import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppState } from "../store";
import { videoName, videoUrl } from "../video";

const CONVERT = "Convert it to MP4 with H.264 video, or to WebM.";

/** Why a video cannot play, in words, from what Chromium reported. */
function failure(video: HTMLVideoElement) {
  // Chromium reports a file it could not read as a bare "Format error", and one it read but could
  // not take apart or decode with the pipeline status that stopped it.
  if (!video.error?.message.startsWith("PipelineStatus")) {
    return "The file could not be opened. Check that it exists.";
  }
  return `It is not a video this player can decode. ${CONVERT}`;
}

type PlayerProps = { url: string; title: string; onProblem(problem: string): void };

/** Plays only when the user starts it, and pauses out of view: every frame is drawn in the terminal. */
function Player({ url, title, onProblem }: PlayerProps) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) element.pause();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    // biome-ignore lint/a11y/useMediaCaption: an agent's recording comes without captions
    <video
      ref={video}
      className="video"
      src={url}
      title={title || undefined}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => {
        if (event.currentTarget.videoWidth === 0) {
          onProblem(`It has sound but no video this player can decode, as with ProRes. ${CONVERT}`);
        }
      }}
      onError={(event) => onProblem(failure(event.currentTarget))}
    />
  );
}

/** A video a reply shows with Markdown image syntax, or why it cannot be played. */
export function Video({ src, title }: { src: string; title: string }) {
  const cwd = useAppState((state) => state.session?.cwd ?? null);
  const url = videoUrl(src, cwd);
  const [failed, setFailed] = useState<string | null>(null);

  if (url !== null && failed === null) {
    return <Player url={url} title={title} onProblem={setFailed} />;
  }
  return (
    <span className="card video-problem">
      <CircleAlert size={16} className="video-problem-icon" />
      <span>
        <span className="video-problem-title">Cannot play {videoName(src)}</span>
        <span>{failed ?? "Give the full path to the file."}</span>
        <span className="mono dim">{src}</span>
      </span>
    </span>
  );
}
