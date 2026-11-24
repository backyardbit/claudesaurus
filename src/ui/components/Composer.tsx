import type { AvailableCommand } from "@agentclientprotocol/sdk";
import { ArrowUp, Bot, CornerDownLeft, Folder, Leaf, Square, X } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentChoice, PastSession, PromptImage } from "../../shared/protocol";
import { formatAge, shortPath } from "../format";
import { useActions, useAppState } from "../store";
import { ConfigChips } from "./ConfigChips";
import { ContextChip } from "./ContextChip";

const MAX_COMMANDS = 10;
const MAX_SESSIONS = 10;

/** Commands the page answers itself, listed ahead of the agent's own. */
const LOCAL_COMMANDS: AvailableCommand[] = [
  { name: "new", description: "Start a new chat" },
  { name: "clear", description: "Start a new chat, as /new does" },
  { name: "resume", description: "Open a past chat from this folder" },
  { name: "restart", description: "Restart Claudesaurus and resume this chat" },
  { name: "agent", description: "Switch to another agent, such as Codex, Grok or Antigravity" },
  { name: "patches", description: "Draw only the areas that change: much less data to send" },
  { name: "tiles", description: "Draw in tiles, PixelGUI's usual way in Rex" },
  { name: "zen", description: "Hide tool calls and thoughts, or show them again" },
  { name: "quit", description: "Close Claudesaurus" },
];

const LOCAL_NAMES = new Set(LOCAL_COMMANDS.map((command) => command.name));

/** `/resume` and what follows it, which picks a past session. */
const RESUME_PATTERN = /^\/resume\s+(.*)$/s;

/** `/agent` and what follows it, which picks an agent. */
const AGENT_PATTERN = /^\/agent\s+(.*)$/s;

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A row of the menu above the composer: a command, or a session to open. Enter and a click
 * `pick` it; Tab only `fill`s a command into the input, as in Claude Code.
 */
type MenuEntry = {
  key: string;
  name: string;
  detail: string;
  mono: boolean;
  /** Whether the input is the start of this row, so Enter means it and not the text as typed. */
  typed: boolean;
  pick(): void;
  fill(): void;
};

/** How a typed character reaches the input, as opposed to a paste or a drop. */
const TYPED_INPUT = new Set(["insertText", "insertLineBreak", "insertParagraph"]);

/** How long after a handled key press its own character can still arrive. */
const CONSUMED_KEY_WINDOW_MS = 100;

export function matchCommands(
  commands: AvailableCommand[],
  text: string,
  canResume: boolean,
  updateVersion: string | null = null,
) {
  const match = /^\/(\S*)$/.exec(text);
  if (!match) return [];
  const query = (match[1] ?? "").toLowerCase();
  const local = LOCAL_COMMANDS.filter((command) => canResume || command.name !== "resume").map(
    (command) =>
      command.name === "restart" && updateVersion
        ? { ...command, description: `Apply update v${updateVersion} and resume this chat` }
        : command,
  );
  // Put `/restart` first when an update is waiting, so typing `/` surfaces it immediately.
  const orderedLocal = updateVersion
    ? [
        ...local.filter((command) => command.name === "restart"),
        ...local.filter((command) => command.name !== "restart"),
      ]
    : local;
  const all = [...orderedLocal, ...commands.filter((command) => !LOCAL_NAMES.has(command.name))];
  const starts = all.filter((command) => command.name.toLowerCase().startsWith(query));
  const contains = all.filter(
    (command) =>
      !command.name.toLowerCase().startsWith(query) && command.name.toLowerCase().includes(query),
  );
  return [...starts, ...contains].slice(0, MAX_COMMANDS);
}

/** The sessions whose title or id holds every word of the query, other than the open one. */
export function matchSessions(sessions: PastSession[], query: string, currentId: string | null) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return sessions
    .filter((past) => past.sessionId !== currentId)
    .filter((past) => {
      const haystack = `${past.title ?? ""} ${past.sessionId}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, MAX_SESSIONS);
}

/** The agents whose name, id or description holds every word of the query. */
export function matchAgents(agents: AgentChoice[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return agents
    .filter((agent) => {
      const haystack = `${agent.name} ${agent.id} ${agent.description ?? ""}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, MAX_SESSIONS);
}

function readImage(file: File) {
  return new Promise<PromptImage>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ mimeType: file.type, data: url.slice(url.indexOf(",") + 1) });
    };
    reader.readAsDataURL(file);
  });
}

/** Makes the input as tall as its text, and scrollable past the height the styles allow. */
function fitInput(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
  element.style.overflowY = element.scrollHeight > element.clientHeight + 1 ? "auto" : "hidden";
}

export function Composer() {
  const actions = useActions();
  const phase = useAppState((state) => state.phase);
  const running = useAppState((state) => state.running);
  const session = useAppState((state) => state.session);
  const configOptions = useAppState((state) => state.configOptions);
  const commands = useAppState((state) => state.commands);
  const queue = useAppState((state) => state.queue);
  const pastSessions = useAppState((state) => state.pastSessions);
  const pendingPermission = useAppState((state) => state.permissions[0] ?? null);
  const zen = useAppState((state) => state.zen);
  const agent = useAppState((state) => state.agent);
  const agents = useAppState((state) => state.agents);
  const updateVersion = useAppState((state) => state.updateVersion);
  const auth = useAppState((state) => (state.phase === "auth" ? state.auth : null));
  const canResume = session?.features.resume ?? false;
  const agentName = agent?.name ?? "the agent";
  const draft = useAppState((state) => state.draft);

  const [text, setText] = useState("");
  const [images, setImages] = useState<PromptImage[]>([]);
  const [selected, setSelected] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  // A task handed over by a PR viewer joins whatever is already typed rather than replacing it.
  useEffect(() => {
    if (draft === null) return;
    const taken = actions.takeDraft();
    if (taken === null) return;
    setText((typed) => (typed.trim() === "" ? taken : `${typed.trimEnd()}\n\n${taken}`));
    input.current?.focus();
  }, [draft, actions]);
  /** When a key press was last handled as a command, so the character it types can be dropped. */
  const consumedKeyAt = useRef(Number.NEGATIVE_INFINITY);

  const resumeQuery = canResume ? (RESUME_PATTERN.exec(text)?.[1] ?? null) : null;
  const resuming = resumeQuery !== null;
  const agentQuery = AGENT_PATTERN.exec(text)?.[1] ?? null;
  const choosingAgent = agentQuery !== null;
  const picking = resuming || choosingAgent;
  const matches = useMemo(
    () => (menuDismissed || picking ? [] : matchCommands(commands, text, canResume, updateVersion)),
    [commands, text, menuDismissed, picking, canResume, updateVersion],
  );
  const agentMatches = useMemo(
    () => (agentQuery === null || menuDismissed ? [] : matchAgents(agents ?? [], agentQuery)),
    [agents, agentQuery, menuDismissed],
  );
  const sessionMatches = useMemo(
    () =>
      resumeQuery === null || menuDismissed
        ? []
        : matchSessions(pastSessions ?? [], resumeQuery, session?.sessionId ?? null),
    [pastSessions, resumeQuery, menuDismissed, session],
  );
  const agentEntries: MenuEntry[] = agentMatches.map((choice) => ({
    key: choice.id,
    name: choice.name,
    detail: choice.id === agent?.id ? "Current" : (choice.description ?? ""),
    mono: false,
    typed: true,
    pick: () => switchAgent(choice.id),
    fill: () => switchAgent(choice.id),
  }));
  const entries: MenuEntry[] = choosingAgent
    ? agentEntries
    : resuming
      ? sessionMatches.map((past) => ({
          key: past.sessionId,
          name: past.title ?? "Untitled chat",
          detail: past.updatedAt ? formatAge(past.updatedAt, Date.now()) : "",
          mono: false,
          typed: true,
          pick: () => resume(past.sessionId),
          fill: () => resume(past.sessionId),
        }))
      : matches.map((command) => ({
          key: command.name,
          name: `/${command.name}`,
          detail: command.description ?? "",
          mono: true,
          typed: `/${command.name}`.toLowerCase().startsWith(text.toLowerCase()),
          // A command that takes an argument waits for it; any other runs at once.
          pick: () => (command.input ? complete(command) : submit(false, `/${command.name}`)),
          fill: () => complete(command),
        }));
  const active = entries[Math.min(selected, entries.length - 1)];
  const resumeTitle =
    !resuming || menuDismissed
      ? null
      : pastSessions === null
        ? "Listing chats…"
        : entries.length > 0
          ? "Resume a chat"
          : resumeQuery.trim()
            ? "No chats match"
            : "No other chats in this folder";
  const agentTitle =
    !choosingAgent || menuDismissed
      ? null
      : agents === null
        ? "Listing agents…"
        : entries.length > 0
          ? "Switch agent: a new chat starts on the one you pick"
          : "No agents match";
  const menuTitle = resumeTitle ?? agentTitle;
  const canSend = phase === "ready" && (text.trim() !== "" || images.length > 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the height depends on the text
  useLayoutEffect(() => fitInput(input.current), [text]);

  // A narrower pane wraps the same text onto more lines.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fitInput(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Lists the sessions anew each time `/resume` is typed, so a chat from just now is there.
  useEffect(() => {
    if (resuming) actions.listSessions();
  }, [resuming, actions]);

  useEffect(() => {
    if (choosingAgent) actions.listAgents();
  }, [choosingAgent, actions]);

  useEffect(() => {
    // The terminal delivers a key press and the character it types as separate events, so
    // cancelling the key press does not stop the character from being inserted.
    const element = input.current;
    if (!element) return;
    const dropConsumed = (event: InputEvent) => {
      const typed = TYPED_INPUT.has(event.inputType);
      if (typed && performance.now() - consumedKeyAt.current < CONSUMED_KEY_WINDOW_MS) {
        event.preventDefault();
      }
    };
    element.addEventListener("beforeinput", dropConsumed);
    return () => element.removeEventListener("beforeinput", dropConsumed);
  }, []);

  useEffect(() => {
    const focusInput = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) return;
      // A slider keeps focus after a drag, but it has no use for typed characters.
      if (target instanceof HTMLInputElement && target.type !== "range") return;
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      input.current?.focus();
    };
    window.addEventListener("keydown", focusInput);
    return () => window.removeEventListener("keydown", focusInput);
  }, []);

  /** Sends the input, or queues it while the agent works unless `now` sends it into the turn. */
  function submit(now = false, value = text) {
    const command = value.trim();
    // Switching agents, restarting and quitting work while an agent cannot start, too.
    if (command === "/agent") {
      setText("/agent ");
      setMenuDismissed(false);
      return;
    }
    if (choosingAgent) return;
    if (command === "/restart") {
      actions.restart();
      setText("");
      return;
    }
    if (command === "/quit" || command === "/exit") {
      actions.quit();
      return;
    }
    if (phase !== "ready" || (value.trim() === "" && images.length === 0)) return;
    if (command === "/resume" && canResume) {
      setText("/resume ");
      setMenuDismissed(false);
      return;
    }
    if (resuming) {
      // Enter with no chat picked opens one only when the text is a whole session id.
      const id = resumeQuery.trim();
      if (SESSION_ID_PATTERN.test(id)) resume(id);
      return;
    }
    if (command === "/new" || command === "/clear") actions.newSession();
    else if (command === "/patches") actions.setDrawing("patches");
    else if (command === "/tiles") actions.setDrawing("tiles");
    else if (command === "/zen") actions.toggleZen();
    else actions.send({ text: command, images }, { now });
    setText("");
    setImages([]);
  }

  function complete(command: AvailableCommand) {
    setText(`/${command.name} `);
    setSelected(0);
  }

  function switchAgent(agentId: string) {
    actions.switchAgent(agentId);
    setText("");
    setSelected(0);
  }

  function resume(sessionId: string) {
    actions.resume(sessionId);
    setText("");
    setSelected(0);
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (auth && text === "" && /^[1-9]$/.test(event.key)) {
      const method = auth.methods[Number(event.key) - 1];
      if (method) {
        event.preventDefault();
        actions.authenticate(method.id);
        return;
      }
    }
    if (pendingPermission && text === "" && /^[1-9]$/.test(event.key)) {
      const option = pendingPermission.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        actions.answerPermission(pendingPermission.requestId, option.optionId);
        return;
      }
    }
    if (entries.length > 0 || menuTitle !== null) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && entries.length > 0) {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelected((selected + step + entries.length) % entries.length);
        return;
      }
      if (event.key === "Tab" && active) {
        event.preventDefault();
        active.fill();
        return;
      }
      // A row whose name only contains the input, rather than starting with it, waits for an
      // arrow key; until then Enter sends the text as typed.
      if (event.key === "Enter" && !event.shiftKey && active && (active.typed || selected > 0)) {
        event.preventDefault();
        active.pick();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    // Ctrl+Enter sends now, as in Claude Code: the input, or with an empty input the first queued.
    if (event.key === "Enter" && event.ctrlKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) submit(true);
      else if (queue.length > 0) actions.sendQueuedNow(0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      actions.cancel();
      return;
    }
    if (event.ctrlKey && event.key === "c") {
      const selection = window.getSelection()?.toString() ?? "";
      const element = event.currentTarget;
      const inputSelection = element.value.slice(element.selectionStart, element.selectionEnd);
      event.preventDefault();
      if (inputSelection || selection) actions.copy(inputSelection || selection);
      else if (running) actions.cancel();
      else setText("");
      return;
    }
    if (event.ctrlKey && event.key === "d" && text === "") {
      event.preventDefault();
      actions.quit();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    handleKey(event);
    if (event.isDefaultPrevented()) consumedKeyAt.current = performance.now();
  }

  async function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    const pasted = await Promise.all(files.map(readImage));
    setImages((current) => [...current, ...pasted]);
  }

  return (
    <div className="composer-wrap">
      {queue.length > 0 && (
        <div className="queue">
          {queue.map((draft, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: queued drafts have no identity but their position
            <div key={index} className="queued">
              <span className="dim">Queued</span>
              <span className="queued-text">{draft.text || "Image"}</span>
              <button
                type="button"
                className="icon-button"
                title="Send now (ctrl+enter)"
                onClick={() => actions.sendQueuedNow(index)}
              >
                <CornerDownLeft size={13} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Remove"
                onClick={() => actions.unqueue(index)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {(entries.length > 0 || menuTitle !== null) && (
        <div className={`command-menu ${picking ? "sessions" : ""}`}>
          {menuTitle !== null && <div className="menu-title">{menuTitle}</div>}
          {entries.map((entry) => (
            <button
              type="button"
              key={entry.key}
              className={`menu-item ${entry === active ? "selected" : ""}`}
              onClick={() => {
                entry.pick();
                input.current?.focus();
              }}
            >
              <span className={`menu-name ${entry.mono ? "mono" : ""}`}>{entry.name}</span>
              <span className="menu-description">{entry.detail}</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer">
        {images.length > 0 && (
          <div className="attachments">
            {images.map((image, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: attachments have no identity but their position
              <div key={index} className="attachment">
                <img src={`data:${image.mimeType};base64,${image.data}`} alt="Attachment" />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setImages(images.filter((_, position) => position !== index))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          // biome-ignore lint/a11y/noAutofocus: the composer is the page's one input
          autoFocus
          rows={1}
          value={text}
          placeholder={
            phase === "connecting"
              ? `Starting ${agentName}…`
              : phase === "auth"
                ? `Sign in to ${agentName} above, or /agent to switch`
                : `Ask ${agentName} anything — / for commands`
          }
          onChange={(event) => {
            setText(event.target.value);
            setSelected(0);
            setMenuDismissed(false);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="composer-bar">
          <ConfigChips options={configOptions} />
          {zen && (
            <button
              type="button"
              className="chip zen-chip"
              title="Tool calls and thoughts are hidden. Click or type /zen to show them"
              onClick={actions.toggleZen}
            >
              <Leaf size={13} /> Zen
            </button>
          )}
          {agent && (
            <button
              type="button"
              className="plain-chip agent-chip"
              title="Switch agent (/agent)"
              onClick={() => {
                setText("/agent ");
                setMenuDismissed(false);
                input.current?.focus();
              }}
            >
              <Bot size={13} /> {agent.name}
            </button>
          )}
          {session && (
            <span className="plain-chip" title={session.cwd}>
              <Folder size={13} /> {shortPath(session.cwd)}
            </span>
          )}
          <span className="spacer" />
          <ContextChip />
          {running && !canSend ? (
            <button type="button" className="send stop" title="Stop (esc)" onClick={actions.cancel}>
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="send"
              title={running ? "Queue message (ctrl+enter sends now)" : "Send"}
              disabled={!canSend}
              onClick={() => submit()}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
