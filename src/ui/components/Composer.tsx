import type { AvailableCommand } from "@agentclientprotocol/sdk";
import { ArrowUp, CornerDownLeft, Folder, Square, X } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PromptImage } from "../../shared/protocol";
import { shortPath } from "../format";
import { useActions, useAppState } from "../store";
import { ConfigChips } from "./ConfigChips";
import { ContextChip } from "./ContextChip";

const MAX_COMMANDS = 8;

/** Commands the page answers itself, listed ahead of Claude's own. */
const LOCAL_COMMANDS: AvailableCommand[] = [
  { name: "new", description: "Start a new chat" },
  { name: "patches", description: "Draw only the areas that change: much less data to send" },
  { name: "tiles", description: "Draw in tiles, PixelGUI's usual way in Rex" },
  { name: "quit", description: "Close Claudesaurus" },
];

/** How a typed character reaches the input, as opposed to a paste or a drop. */
const TYPED_INPUT = new Set(["insertText", "insertLineBreak", "insertParagraph"]);

/** How long after a handled key press its own character can still arrive. */
const CONSUMED_KEY_WINDOW_MS = 100;

function matchCommands(commands: AvailableCommand[], text: string) {
  const match = /^\/(\S*)$/.exec(text);
  if (!match) return [];
  const query = (match[1] ?? "").toLowerCase();
  const all = [...LOCAL_COMMANDS, ...commands];
  const starts = all.filter((command) => command.name.toLowerCase().startsWith(query));
  const contains = all.filter(
    (command) =>
      !command.name.toLowerCase().startsWith(query) && command.name.toLowerCase().includes(query),
  );
  return [...starts, ...contains].slice(0, MAX_COMMANDS);
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

export function Composer() {
  const actions = useActions();
  const phase = useAppState((state) => state.phase);
  const running = useAppState((state) => state.running);
  const session = useAppState((state) => state.session);
  const configOptions = useAppState((state) => state.configOptions);
  const commands = useAppState((state) => state.commands);
  const queue = useAppState((state) => state.queue);
  const pendingPermission = useAppState((state) => state.permissions[0] ?? null);

  const [text, setText] = useState("");
  const [images, setImages] = useState<PromptImage[]>([]);
  const [selected, setSelected] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  /** When a key press was last handled as a command, so the character it types can be dropped. */
  const consumedKeyAt = useRef(Number.NEGATIVE_INFINITY);

  const matches = useMemo(
    () => (menuDismissed ? [] : matchCommands(commands, text)),
    [commands, text, menuDismissed],
  );
  const active = matches[Math.min(selected, matches.length - 1)];
  const canSend = phase === "ready" && (text.trim() !== "" || images.length > 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the height depends on the text
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    element.style.overflowY = element.scrollHeight > element.clientHeight + 1 ? "auto" : "hidden";
  }, [text]);

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

  function submit() {
    if (!canSend) return;
    const command = text.trim();
    if (command === "/new" || command === "/clear") actions.newSession();
    else if (command === "/quit" || command === "/exit") actions.quit();
    else if (command === "/patches") actions.setDrawing("patches");
    else if (command === "/tiles") actions.setDrawing("tiles");
    else actions.send({ text: command, images });
    setText("");
    setImages([]);
  }

  function complete(command: AvailableCommand) {
    setText(`/${command.name} `);
    setSelected(0);
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pendingPermission && text === "" && /^[1-9]$/.test(event.key)) {
      const option = pendingPermission.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        actions.answerPermission(pendingPermission.requestId, option.optionId);
        return;
      }
    }
    if (matches.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelected((selected + step + matches.length) % matches.length);
        return;
      }
      if ((event.key === "Tab" || event.key === "Enter") && active) {
        event.preventDefault();
        complete(active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuDismissed(true);
        return;
      }
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
                title="Send now"
                onClick={() => actions.sendNow(index)}
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
      {matches.length > 0 && (
        <div className="command-menu">
          {matches.map((command) => (
            <button
              type="button"
              key={command.name}
              className={`menu-item ${command === active ? "selected" : ""}`}
              onClick={() => {
                complete(command);
                input.current?.focus();
              }}
            >
              <span className="menu-name mono">/{command.name}</span>
              <span className="menu-description">{command.description}</span>
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
            phase === "connecting" ? "Starting Claude…" : "Ask Claude anything — / for commands"
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
              title={running ? "Queue message" : "Send"}
              disabled={!canSend}
              onClick={submit}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
