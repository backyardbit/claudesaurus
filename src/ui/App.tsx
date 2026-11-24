import { ArrowDown, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AuthPrompt } from "./components/AuthPrompt";
import { Composer } from "./components/Composer";
import { PlanPill } from "./components/PlanPill";
import { Timeline } from "./components/Timeline";
import { Working } from "./components/Working";
import { shortPath } from "./format";
import { useActions, useAppState } from "./store";

/** Room kept under the newest content when the view moves to show it, in pixels. */
const FOLLOW_MARGIN = 24;

/** Room kept above a message that was just sent, in pixels. */
const SENT_MARGIN = 16;

function Welcome() {
  const session = useAppState((state) => state.session);
  const account = useAppState((state) => state.account);
  const phase = useAppState((state) => state.phase);
  const detail = useAppState((state) => state.connectingDetail);
  return (
    <div className="welcome">
      <div className="welcome-mark">🦕</div>
      <h1>Claudesaurus</h1>
      {session && <p className="mono dim">{shortPath(session.cwd)}</p>}
      {account && <p className="dim">{account.label}</p>}
      {phase === "connecting" && detail && <p className="dim">{detail}</p>}
      <p className="dim hints">
        <kbd>enter</kbd> send · <kbd>shift</kbd>+<kbd>enter</kbd> new line · <kbd>esc</kbd> stop ·{" "}
        <kbd>ctrl</kbd>+<kbd>q</kbd> quit
      </p>
    </div>
  );
}

export function App() {
  const phase = useAppState((state) => state.phase);
  const failure = useAppState((state) => state.failure);
  const items = useAppState((state) => state.items);
  const permissions = useAppState((state) => state.permissions);
  const running = useAppState((state) => state.running);
  const turnStartedAt = useAppState((state) => state.turnStartedAt);
  const plan = useAppState((state) => state.plan);
  const toast = useAppState((state) => state.toast);
  const zen = useAppState((state) => state.zen);
  const agentName = useAppState((state) => state.agent?.name ?? "The agent");
  const auth = useAppState((state) => (state.phase === "auth" ? state.auth : null));

  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const sentMessage = useRef<string | null>(null);
  const [away, setAway] = useState(false);

  /**
   * Keeps the newest content at the bottom of the view once it runs past it. PixelGUI moves the
   * picture already in the terminal and sends only the strip that scrolled in, so following line
   * by line costs about a quarter more drawing during a turn than moving a page at a time did,
   * and leaves no empty space under the newest line.
   */
  const follow = useCallback(() => {
    const view = scroller.current;
    const marker = end.current;
    if (!view || !marker || !following.current) return;
    const bottom = marker.offsetTop;
    if (bottom <= view.scrollTop + view.clientHeight - FOLLOW_MARGIN) return;
    view.scrollTop = bottom - view.clientHeight + FOLLOW_MARGIN;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: new content is what moves the end
  useLayoutEffect(() => {
    const view = scroller.current;
    const last = items.at(-1);
    const justSent = running && last?.kind === "user" && last.id !== sentMessage.current;
    if (last?.kind === "user") sentMessage.current = last.id;
    if (justSent && view) {
      const bubbles = view.querySelectorAll<HTMLElement>(".user");
      const sent = bubbles[bubbles.length - 1];
      following.current = true;
      if (sent) view.scrollTop = sent.offsetTop - SENT_MARGIN;
      return;
    }
    follow();
  }, [items, permissions, running]);

  // The column grows with new content and reflows when the pane's width changes; the view itself
  // gets shorter when the pane does, which would leave the newest lines under the composer.
  useEffect(() => {
    if (!column.current || !scroller.current) return;
    const observer = new ResizeObserver(follow);
    observer.observe(column.current);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [follow]);

  function onScroll() {
    const view = scroller.current;
    const marker = end.current;
    if (!view || !marker) return;
    following.current = marker.offsetTop <= view.scrollTop + view.clientHeight + FOLLOW_MARGIN;
    setAway(!following.current);
  }

  return (
    <div className="app">
      <div className="scroller" ref={scroller} onScroll={onScroll}>
        <div className={running && items.length > 0 ? "column reserve" : "column"} ref={column}>
          {items.length === 0 && phase !== "failed" && <Welcome />}
          <Timeline items={items} permissions={permissions} running={running} zen={zen} />
          {running && turnStartedAt !== null && <Working since={turnStartedAt} />}
          {auth && <AuthPrompt agentName={agentName} auth={auth} />}
          {phase === "failed" && (
            <div className="notice error fatal">
              <div>
                <strong>{agentName} stopped</strong>
                <pre>{failure}</pre>
                <div className="dim">
                  Type <kbd>/agent</kbd> to switch to another agent, or press <kbd>ctrl</kbd>+
                  <kbd>q</kbd> to quit and start claudesaurus again.
                </div>
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="dock">
        {away && (
          <button
            type="button"
            className="chip jump"
            onClick={() => {
              following.current = true;
              setAway(false);
              follow();
            }}
          >
            <ArrowDown size={13} /> Latest
          </button>
        )}
        {!zen && <PlanPill plan={plan} />}
        <Composer />
      </div>
      {toast && <div className="toast">{toast}</div>}
      <UpdateToast />
    </div>
  );
}

function UpdateToast() {
  const version = useAppState((state) => state.updateVersion);
  const dismissed = useAppState((state) => state.updateDismissed);
  const actions = useActions();
  if (!version || dismissed) return null;
  return (
    <output className="update-toast">
      <RefreshCw size={14} className="update-toast-icon" />
      <span className="update-toast-label">v{version} ready</span>
      <button
        type="button"
        className="chip update-toast-action"
        title="Restart Claudesaurus to apply update and resume this chat (/restart)"
        onClick={actions.restart}
      >
        /restart
      </button>
      <button
        type="button"
        className="icon-button"
        title="Dismiss"
        aria-label="Dismiss update notification"
        onClick={actions.dismissUpdate}
      >
        <X size={13} />
      </button>
    </output>
  );
}
