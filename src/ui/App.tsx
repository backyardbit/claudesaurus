import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { PlanPill } from "./components/PlanPill";
import { Timeline } from "./components/Timeline";
import { formatDuration, shortPath } from "./format";
import { useAppState } from "./store";

/** Room kept under the newest content when the view moves to show it, in pixels. */
const FOLLOW_MARGIN = 24;

/**
 * Where the newest content lands when the view moves during a turn, as a fraction of the pane's
 * height from the top. The space below it fills up before the view has to move again.
 */
const PAGE_ANCHOR = 0.3;

/** Room kept above a message that was just sent, in pixels. */
const SENT_MARGIN = 16;

function Working({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div className="working">
      <span className="working-dot" aria-hidden="true" />
      Working <span className="dim">{formatDuration(seconds * 1000)} · esc to stop</span>
    </div>
  );
}

function Welcome() {
  const session = useAppState((state) => state.session);
  const account = useAppState((state) => state.account);
  return (
    <div className="welcome">
      <div className="welcome-mark">🦕</div>
      <h1>Claudesaurus</h1>
      {session && <p className="mono dim">{shortPath(session.cwd)}</p>}
      {account && <p className="dim">{account.label}</p>}
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

  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const runningNow = useRef(running);
  runningNow.current = running;
  const sentMessage = useRef<string | null>(null);
  const [away, setAway] = useState(false);

  /**
   * Brings the newest content into view once it runs past the bottom. Moving the view redraws
   * the whole pane in the terminal, so during a turn it moves a page at a time, not a line.
   */
  const follow = useCallback(() => {
    const view = scroller.current;
    const marker = end.current;
    if (!view || !marker || !following.current) return;
    const bottom = marker.offsetTop;
    if (bottom <= view.scrollTop + view.clientHeight - FOLLOW_MARGIN) return;
    view.scrollTop = runningNow.current
      ? bottom - view.clientHeight * PAGE_ANCHOR
      : bottom - view.clientHeight + FOLLOW_MARGIN;
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

  useEffect(() => {
    if (!column.current) return;
    const observer = new ResizeObserver(follow);
    observer.observe(column.current);
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
        <div className={items.length > 0 ? "column filled" : "column"} ref={column}>
          {items.length === 0 && phase !== "failed" && <Welcome />}
          <Timeline items={items} permissions={permissions} running={running} />
          {running && turnStartedAt !== null && <Working since={turnStartedAt} />}
          {phase === "failed" && (
            <div className="notice error fatal">
              <div>
                <strong>Claude stopped</strong>
                <pre>{failure}</pre>
                <div className="dim">
                  Press <kbd>ctrl</kbd>+<kbd>q</kbd> to quit, then start claudesaurus again.
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
        <PlanPill plan={plan} />
        <Composer />
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
