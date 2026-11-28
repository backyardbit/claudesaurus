import { basename } from "./format";

const VIDEO_PATH = /\.(mp4|m4v|mov|webm)$/i;

function decoded(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function pathOf(src: string) {
  return decoded(src.replace(/[?#].*$/, ""));
}

export function isVideo(src: string) {
  return VIDEO_PATH.test(pathOf(src));
}

export function videoName(src: string) {
  return basename(pathOf(src));
}

function fileUrl(path: string) {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function videoUrl(src: string, cwd: string | null) {
  if (/^(https?|file):\/\//i.test(src)) return src;
  const path = pathOf(src);
  if (path.startsWith("/")) return fileUrl(path);
  if (cwd === null || path.startsWith("~") || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  return fileUrl(`${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`);
}
