/** "20m ago", "3d ago" or "just now", as T3 Code labels times. */
type RelativeTimeParts = { value: string; suffix: string | null };

function formatRelativeTime(isoDate: string): RelativeTimeParts | null {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return { value: "just now", suffix: null };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { value: `${minutes}m`, suffix: "ago" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: `${hours}h`, suffix: "ago" };
  return { value: `${Math.floor(hours / 24)}d`, suffix: "ago" };
}

export function formatRelativeTimeLabel(isoDate: string) {
  const relative = formatRelativeTime(isoDate);
  if (!relative) return "";
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}
