import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "@zenbu-labs/pixel/electron";
import type { MainMessage } from "../shared/protocol";

const CAPTURE_INTERVAL_MS = 2000;

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
