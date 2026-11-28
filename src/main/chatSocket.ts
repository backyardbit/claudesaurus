import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const ChatMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draft"), text: z.string() }),
  z.object({ type: z.literal("celebrate"), pr: z.number().int().nullable() }),
]);

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

function parseMessage(line: string) {
  try {
    const parsed = ChatMessageSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createChatSocket(onMessage: (message: ChatMessage) => void) {
  let socketPath: string | null = null;
  let server: net.Server | null = null;

  return {
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
          const message = parseMessage(buffer.slice(0, end));
          if (message) onMessage(message);
          connection.end(message ? "ok\n" : "refused\n");
        });
        connection.on("error", () => {});
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

export function sendToChat(socketPath: string, message: ChatMessage) {
  return new Promise<void>((resolve, reject) => {
    const connection = net.createConnection(socketPath);
    let answer = "";
    connection.setEncoding("utf8");
    connection.on("connect", () => connection.write(`${JSON.stringify(message)}\n`));
    connection.on("data", (chunk) => {
      answer += chunk;
    });
    connection.on("end", () =>
      answer.trim() === "ok" ? resolve() : reject(new Error("The chat refused the message.")),
    );
    connection.on("error", reject);
  });
}
