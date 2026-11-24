import { basename } from "./format";

/** File types the page plays as video when a reply shows one with Markdown image syntax. */
const VIDEO_PATH = /\.(mp4|m4v|mov|webm)$/i;

function decoded(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The address without its query or fragment, decoded: what names the file. */
function pathOf(src: string) {
  return decoded(src.replace(/[?#].*$/, ""));
}

/** Whether a Markdown image (`![demo](/tmp/demo.mp4)`) names a video rather than a picture. */
export function isVideo(src: string) {
  return VIDEO_PATH.test(pathOf(src));
}

/** The file's name, for telling the user which video did not play. */
export function videoName(src: string) {
  return basename(pathOf(src));
}

/** A `file://` URL for an absolute path, with every character that means something in a URL escaped. */
function fileUrl(path: string) {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Where to load a video from: a web or `file://` address as it is, an absolute path as a file,
 * and a relative path from the session's folder. Null when there is no way to tell, as for `~`.
 */
export function videoUrl(src: string, cwd: string | null) {
  if (/^(https?|file):\/\//i.test(src)) return src;
  const path = pathOf(src);
  if (path.startsWith("/")) return fileUrl(path);
  if (cwd === null || path.startsWith("~") || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  return fileUrl(`${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`);
}
