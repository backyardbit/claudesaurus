import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** One task a PR viewer hands this chat: a line of JSON on the chat's socket. */
const DraftMessageSchema = z.object({ type: z.literal("draft"), text: z.string() });

function draftText(line: string) {
  try {
    const parsed = DraftMessageSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data.text : null;
  } catch {
    return null;
  }
}

/**
 * A socket a PR viewer opened from this chat writes tasks to, so they land in this chat's
 * composer the way T3 Code puts them in the thread its pull request panel sits beside. It lives
 * in a folder only this user can read, and is made the first time a viewer is opened.
 */
export function createChatSocket(onDraft: (text: string) => void) {
  let socketPath: string | null = null;
  let server: net.Server | null = null;

  return {
    /** The socket's path, listening from the first call on. */
    path() {
      if (socketPath) return socketPath;
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claudesaurus-chat-"));
      socketPath = path.join(directory, "chat.sock");
      server = net.createServer((connection) => {
        let buffer = "";
        connection.setEncoding("utf8");
        connection.on("data", (chunk) => {
          buffer += chunk;
          const end = buffer.indexOf("\n");
          if (end === -1) return;
          const text = draftText(buffer.slice(0, end));
          if (text !== null) onDraft(text);
          connection.end(text === null ? "refused\n" : "ok\n");
        });
        connection.on("error", () => {
          // A viewer that went away mid-message has nothing left to tell.
        });
      });
      server.listen(socketPath);
      return socketPath;
    },
    close() {
      server?.close();
      if (socketPath) fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
    },
  };
}

/** Hands `text` to the chat listening at `socketPath`; rejects when that chat is gone. */
export function sendDraftToChat(socketPath: string, text: string) {
  return new Promise<void>((resolve, reject) => {
    const connection = net.createConnection(socketPath);
    let answer = "";
    connection.setEncoding("utf8");
    connection.on("connect", () =>
      connection.write(`${JSON.stringify({ type: "draft", text })}\n`),
    );
    connection.on("data", (chunk) => {
      answer += chunk;
    });
    connection.on("end", () =>
      answer.trim() === "ok" ? resolve() : reject(new Error("The chat refused the task.")),
    );
    connection.on("error", reject);
  });
}
