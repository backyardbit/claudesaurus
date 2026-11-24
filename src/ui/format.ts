export function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

export function formatTokens(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** Shortens a directory to its last two segments, with `~` for the home directory. */
export function shortPath(path: string) {
  const home = path.replace(/^\/(?:home|Users)\/[^/]+/, "~");
  const parts = home.split("/");
  return parts.length <= 3 ? home : `…/${parts.slice(-2).join("/")}`;
}
