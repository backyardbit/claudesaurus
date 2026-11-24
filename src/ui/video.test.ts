import { expect, test } from "vitest";
import { isVideo, videoUrl } from "./video";

test("tells videos from pictures by their extension", () => {
  expect(isVideo("/tmp/demo.mp4")).toBe(true);
  expect(isVideo("/tmp/Demo.WEBM")).toBe(true);
  expect(isVideo("/tmp/screen%20recording.mov")).toBe(true);
  expect(isVideo("https://example.com/clip.m4v?raw=1")).toBe(true);
  expect(isVideo("/tmp/shot.png")).toBe(false);
  expect(isVideo("/tmp/mp4")).toBe(false);
});

test("loads an absolute path as a file, escaping what a URL would read", () => {
  expect(videoUrl("/tmp/demo.mp4", "/w")).toBe("file:///tmp/demo.mp4");
  expect(videoUrl("/tmp/my%20demo.mp4", "/w")).toBe("file:///tmp/my%20demo.mp4");
  expect(videoUrl("/tmp/take%20%232.webm", "/w")).toBe("file:///tmp/take%20%232.webm");
});

test("resolves a relative path from the session's folder", () => {
  expect(videoUrl("demo.webm", "/w/app")).toBe("file:///w/app/demo.webm");
  expect(videoUrl("./out/demo.webm", "/w/app/")).toBe("file:///w/app/out/demo.webm");
  expect(videoUrl("demo.webm", null)).toBeNull();
});

test("keeps web and file addresses, and gives up on a home-relative path", () => {
  expect(videoUrl("https://example.com/a.mp4", "/w")).toBe("https://example.com/a.mp4");
  expect(videoUrl("file:///tmp/a.mp4", "/w")).toBe("file:///tmp/a.mp4");
  expect(videoUrl("~/Movies/a.mov", "/w")).toBeNull();
  expect(videoUrl("javascript:alert(1)//a.mp4", "/w")).toBeNull();
});
