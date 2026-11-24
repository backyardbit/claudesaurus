import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "@zenbu-labs/pixel/electron";
import type { MainMessage } from "../shared/protocol";

const CAPTURE_INTERVAL_MS = 2000;

/**
 * Development aid, on when `CLAUDESAURUS_DEBUG_DIR` is set: logs every message sent to the page
 * and keeps a screenshot of the page as Chromium drew it, so a run can be checked without
 * looking at the terminal.
 */
export function startDebugCapture(directory: string, contents: WebContents) {
  fs.mkdirSync(directory, { recursive: true });
  const log = path.join(directory, "messages.jsonl");
  fs.writeFileSync(log, "");

  const timer = setInterval(async () => {
    try {
      const image = await contents.capturePage();
      fs.writeFileSync(path.join(directory, "page.png"), image.toPNG());
    } catch (error) {
      fs.appendFileSync(log, `${JSON.stringify({ captureError: String(error) })}\n`);
    }
  }, CAPTURE_INTERVAL_MS);

  return {
    /** Notes a fact about the run, such as the pane's size. */
    note<Fact>(label: string, value: Fact) {
      fs.appendFileSync(
        path.join(directory, "notes.jsonl"),
        `${JSON.stringify({ [label]: value })}\n`,
      );
    },
    record(message: MainMessage) {
      fs.appendFileSync(log, `${JSON.stringify(message)}\n`);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
