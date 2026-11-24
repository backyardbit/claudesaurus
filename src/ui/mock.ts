import type { SessionConfigOption, SessionUpdate } from "@agentclientprotocol/sdk";
import type { Bridge, MainMessage, UiMessage } from "../shared/protocol";

/**
 * A scripted conversation for working on the page in a plain browser (`pnpm dev:ui`).
 * Add `?static` to the address to skip the delays.
 */

let configOptions: SessionConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "opus",
    options: [
      { value: "opus", name: "Opus 5.5", description: "For complex work and everyday tasks" },
      { value: "fable", name: "Fable 5.2", description: "For your toughest challenges" },
      { value: "sonnet", name: "Sonnet 5.5", description: "Most efficient for simpler tasks" },
      { value: "haiku", name: "Haiku 5.5", description: "Fastest for quick answers" },
    ],
  },
  {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "default", name: "Default" },
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
      { value: "xhigh", name: "Xhigh" },
      { value: "max", name: "Max" },
    ],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "default",
    options: [
      { value: "default", name: "Manual", description: "Always ask before making changes" },
      {
        value: "acceptEdits",
        name: "Accept edits",
        description: "Automatically accept all file edits",
      },
      { value: "plan", name: "Plan", description: "Create a plan before making changes" },
      { value: "auto", name: "Auto", description: "Claude handles permission decisions" },
    ],
  },
  {
    id: "fast",
    name: "Fast mode",
    category: "speed",
    type: "select",
    currentValue: "off",
    options: [
      { value: "off", name: "Off" },
      { value: "on", name: "On" },
    ],
  },
];

const ANSWER = `Fixed. \`TERN_THEME\` now overrides the file:

| Source | Before | After |
| --- | --- | --- |
| \`config.toml\` | wins | loses |
| \`TERN_THEME\` | ignored | **wins** |

The blend weight is $w = \\frac{1}{1 + e^{-k(x - x_0)}}$, and over the whole range:

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

Here is a live preview of the picker:

\`\`\`html
<div style="display:flex;gap:10px;align-items:center;font:15px system-ui">
  <button id="b" style="padding:8px 14px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer">Clicked 0 times</button>
  <canvas id="c" width="260" height="40"></canvas>
</div>
<script>
  let n = 0;
  b.onclick = () => (b.textContent = "Clicked " + ++n + " times");
  const x = c.getContext("2d");
  let t = 0;
  setInterval(() => {
    x.clearRect(0, 0, 260, 40);
    x.fillStyle = "#d97757";
    x.fillRect(10 + Math.abs(Math.sin((t += 0.08))) * 200, 8, 36, 24);
  }, 100);
</script>
\`\`\`

\`\`\`ts
export function applyEnv(config: Config) {
  // the environment wins
  return { ...config, theme: process.env.TERN_THEME ?? config.theme };
}
\`\`\`

Tests pass. <kbd>ctrl</kbd>+<kbd>q</kbd> quits.`;

function tool<Update extends SessionUpdate>(update: Update, toolName: string, parent?: string) {
  return { ...update, _meta: { claudeCode: { toolName, parentToolUseId: parent } } };
}

function script(): [delay: number, message: MainMessage][] {
  const update = (delay: number, sessionUpdate: SessionUpdate): [number, MainMessage] => [
    delay,
    { type: "update", update: sessionUpdate },
  ];
  const words = ANSWER.split(/(?<=\s)/);
  return [
    [
      0,
      {
        type: "userMessage",
        text: "The config loader ignores TERN_THEME. Can you find out why and fix it?",
        images: [],
      },
    ],
    update(300, { sessionUpdate: "session_info_update", title: "Fix TERN_THEME override" }),
    update(100, { sessionUpdate: "usage_update", used: 64000, size: 200000 }),
    update(200, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "The loader probably applies the environment too early." },
    }),
    update(
      900,
      tool(
        {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "grep TERN_THEME",
          kind: "search",
          status: "completed",
          rawInput: { pattern: "TERN_THEME" },
          rawOutput: "README.md\nmain.go",
        },
        "Grep",
      ),
    ),
    update(
      200,
      tool(
        {
          sessionUpdate: "tool_call",
          toolCallId: "t2",
          title: "Read config.go",
          kind: "read",
          status: "completed",
          rawInput: { file_path: "/work/my-app/config.go" },
        },
        "Read",
      ),
    ),
    update(200, {
      sessionUpdate: "plan",
      entries: [
        {
          content: "Find where the environment is applied",
          priority: "medium",
          status: "completed",
        },
        { content: "Swap the load order", priority: "medium", status: "in_progress" },
        { content: "Run the tests", priority: "medium", status: "pending" },
      ],
    }),
    update(200, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "Found it: `Load` applies environment overrides **before** reading `config.toml`, so the file wins.\n\nI'll swap the order and add a test.",
      },
    }),
    update(
      400,
      tool(
        {
          sessionUpdate: "tool_call",
          toolCallId: "t3",
          title: "Edit config.go",
          kind: "edit",
          status: "completed",
          rawInput: { file_path: "/work/my-app/config.go" },
          content: [
            {
              type: "diff",
              path: "/work/my-app/config.go",
              oldText: "\tapplyEnv(cfg)\n\treadFile(cfg)",
              newText: "\treadFile(cfg)\n\tapplyEnv(cfg) // the environment wins",
            },
          ],
        },
        "Edit",
      ),
    ),
    update(
      300,
      tool(
        {
          sessionUpdate: "tool_call",
          toolCallId: "t4",
          title: "go test ./...",
          kind: "execute",
          status: "pending",
          rawInput: { command: "go test ./...", description: "Run the tests" },
        },
        "Bash",
      ),
    ),
    [
      300,
      {
        type: "permissionRequest",
        requestId: "p1",
        toolCall: { toolCallId: "t4", title: "go test ./..." },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always allow go test", kind: "allow_always" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      },
    ],
    [1200, { type: "permissionClosed", requestId: "p1" }],
    update(
      600,
      tool(
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "t4",
          status: "completed",
          rawOutput: "ok  \tconfig\t0.412s\nok  \tcmd/tern\t1.022s",
        },
        "Bash",
      ),
    ),
    update(
      200,
      tool(
        {
          sessionUpdate: "tool_call",
          toolCallId: "t5",
          title: "Check other env overrides",
          kind: "other",
          status: "in_progress",
          rawInput: { description: "Check other env overrides", subagent_type: "Explore" },
        },
        "Agent",
      ),
    ),
    update(
      300,
      tool(
        {
          sessionUpdate: "tool_call",
          toolCallId: "t5a",
          title: "grep os.Getenv",
          kind: "search",
          status: "completed",
          rawInput: { pattern: "os.Getenv" },
        },
        "Grep",
        "t5",
      ),
    ),
    update(
      300,
      tool({ sessionUpdate: "tool_call_update", toolCallId: "t5", status: "completed" }, "Agent"),
    ),
    update(100, {
      sessionUpdate: "plan",
      entries: [
        {
          content: "Find where the environment is applied",
          priority: "medium",
          status: "completed",
        },
        { content: "Swap the load order", priority: "medium", status: "completed" },
        { content: "Run the tests", priority: "medium", status: "completed" },
      ],
    }),
    ...words.map((word): [number, MainMessage] =>
      update(25, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: word } }),
    ),
    update(50, {
      sessionUpdate: "usage_update",
      used: 71000,
      size: 200000,
    }),
    [100, { type: "turnEnded", stopReason: "end_turn" }],
  ];
}

export function createMockBridge(): Bridge {
  const listeners = new Set<(message: MainMessage) => void>();
  const instant = new URLSearchParams(location.search).has("static");
  const emit = (message: MainMessage) => {
    for (const listener of listeners) listener(message);
  };

  async function play(steps: [number, MainMessage][]) {
    for (const [delay, message] of steps) {
      if (!instant) await new Promise((resolve) => window.setTimeout(resolve, delay));
      emit(message);
    }
  }

  function session(): MainMessage {
    return {
      type: "session",
      session: {
        sessionId: "mock",
        cwd: "/home/you/work/my-app",
        agent: { id: "claude-acp", name: "Claude" },
        features: { resume: true, steer: true, systemPrompt: true, embeddedContext: true },
        agentVersion: "mock",
        configOptions,
        loadingHistory: false,
      },
    };
  }

  function onMessage(message: UiMessage) {
    switch (message.type) {
      case "ready":
        emit({ type: "account", account: { label: "Claude Max", email: null } });
        emit(session());
        emit({
          type: "update",
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [
              { name: "compact", description: "Summarize the conversation to free up context" },
              { name: "review", description: "Review the current changes" },
              { name: "init", description: "Create a CLAUDE.md for this project" },
            ],
          },
        });
        if (new URLSearchParams(location.search).has("update")) {
          emit({ type: "updateReady", version: "0.4.0" });
        }
        if (!new URLSearchParams(location.search).has("empty")) void play(script());
        break;
      case "prompt":
        void play([
          [0, { type: "userMessage", text: message.text, images: message.images }],
          [
            400,
            {
              type: "update",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: `You said: ${message.text}` },
              },
            },
          ],
          [600, { type: "turnEnded", stopReason: "end_turn" }],
        ]);
        break;
      case "steer":
        emit({ type: "userMessage", text: message.text, images: message.images });
        break;
      case "listSessions": {
        const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
        emit({
          type: "sessions",
          sessions: [
            { sessionId: "mock-1", title: "Fix the flaky upload test", updatedAt: hoursAgo(2) },
            { sessionId: "mock-2", title: "Add dark mode", updatedAt: hoursAgo(30) },
            { sessionId: "mock-3", title: null, updatedAt: hoursAgo(24 * 9) },
          ],
        });
        break;
      }
      case "resume":
        emit(session());
        break;
      case "setConfig":
        configOptions = configOptions.map((option) =>
          option.id === message.configId && option.type === "select"
            ? { ...option, currentValue: String(message.value) }
            : option,
        );
        emit({ type: "configOptions", configOptions });
        break;
      case "newSession":
        emit(session());
        break;
      case "permission":
        emit({ type: "permissionClosed", requestId: message.requestId });
        break;
      default:
        break;
    }
  }

  return {
    send(message) {
      window.setTimeout(() => onMessage(message), 0);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
