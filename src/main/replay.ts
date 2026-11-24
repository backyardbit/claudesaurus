import fs from "node:fs";
import type { MainMessage } from "../shared/protocol";
import type { Agent } from "./agent";

const CHUNK_INTERVAL_MS = 30;
const CHUNKS_PER_REPLY = 240;

const PARAGRAPH =
  "This is replayed text, streamed in small pieces the way a real answer arrives, with `inline code`, **bold words** and enough length to wrap across several lines of the conversation. ";

/**
 * Development aid, used when `CLAUDESAURUS_REPLAY` names a `messages.jsonl` recorded by the debug
 * capture: shows that conversation without starting Claude, and answers every prompt with a
 * streamed canned reply. It makes a long conversation free and repeatable to measure.
 */
export function createReplayAgent(file: string, emit: (message: MainMessage) => void): Agent {
  let timer: NodeJS.Timeout | null = null;

  function stopStreaming() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    emit({ type: "turnEnded", stopReason: "cancelled" });
  }

  return {
    async start() {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        // SAFETY: the file is a messages.jsonl the debug capture wrote, one MainMessage a line.
        emit(JSON.parse(line) as MainMessage);
      }
    },
    async prompt(text) {
      if (text === "wait") return;
      const messageId = `replay-${Date.now()}`;
      const words = PARAGRAPH.split(/(?<= )/);
      let sent = 0;
      timer = setInterval(() => {
        const word = words[sent % words.length] ?? "";
        const text = sent > 0 && sent % 60 === 0 ? `\n\n${word}` : word;
        emit({
          type: "update",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
            messageId,
          },
        });
        sent += 1;
        if (sent < CHUNKS_PER_REPLY) return;
        if (timer !== null) clearInterval(timer);
        timer = null;
        emit({ type: "turnEnded", stopReason: "end_turn" });
      }, CHUNK_INTERVAL_MS);
    },
    // The canned reply that is streaming carries on; the page already shows the message.
    async steer() {},
    async cancel() {
      stopStreaming();
    },
    resolvePermission() {},
    async setConfig() {},
    async newSession() {},
    async listSessions() {
      emit({ type: "sessions", sessions: [] });
    },
    async resume() {},
    dispose() {
      if (timer !== null) clearInterval(timer);
    },
  };
}
