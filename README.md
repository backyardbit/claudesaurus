# Claudesaurus

A graphical Claude Code chat that runs inside a [Rex](https://www.superlogical.com/rex) pane.

Type `claudesaurus` in a Rex terminal and the pane becomes a chat with Claude Code: message
bubbles, tool cards, diffs, permission prompts, and a composer with model, effort and permission
mode chips. Markdown, LaTeX and HTML (scripts included) render for real, because the chat is a web
page drawn into the terminal.

## How it works

```
Rex pane  <-- Kitty graphics --  PixelGUI (Chromium, off screen)  -- chat page (React)
                                        |
                                 main process  -- ACP over stdio --  claude-agent-acp -- Claude Code
```

- **[PixelGUI](https://github.com/zenbu-labs/terminal-browser/tree/main/pixel)** (`@zenbu-labs/pixel`),
  the library under terminal-browser, runs Chromium off screen, draws its frames into the pane with
  the Kitty graphics protocol, and feeds the terminal's keyboard and mouse back to the page.
- **`src/ui`** is the chat page. It renders Markdown with `react-markdown`, math with KaTeX, and
  `html` code blocks in sandboxed iframes.
- **`src/main`** is the main process. It starts
  [`claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp), the adapter T3 Code
  and Zed use, speaks the [Agent Client Protocol](https://agentclientprotocol.com) to it with the
  official SDK, and relays messages to the page (`src/shared/protocol.ts`).

Claude Code runs with your normal setup: login, settings, `CLAUDE.md`, hooks, MCP servers, skills.

## Install

Needs a Claude Code login (`claude` then `/login`).

With Homebrew, on macOS or Linux:

```sh
brew tap backyardbit/tap
brew install backyardbit/tap/claudesaurus
```

Homebrew installs only the built app. The first run downloads the app's runtime, PixelGUI's
Electron and Claude Code, into `~/.local/share/claudesaurus`, which takes about a minute;
`claudesaurus --setup` does it ahead of time. They are signed programs that Homebrew would rewrite
and re-sign, which breaks Electron on macOS. If macOS still calls Electron damaged, the next run
sees it and sets the runtime up again. Uninstalling leaves that folder behind.

From source, with Node 22 or newer and pnpm:

```sh
pnpm install
pnpm build
ln -s "$PWD/bin/claudesaurus.mjs" ~/.local/bin/claudesaurus
```

If `pnpm install` fails in PixelGUI's postinstall with `EXDEV: cross-device link not permitted`,
your temp directory is on another filesystem. Point it at this one and install again:

```sh
mkdir -p .tmp && TMPDIR=$PWD/.tmp pnpm install
```

## Use

```sh
claudesaurus                                  # chat in the current directory
claudesaurus --model opus --effort high       # start with these settings
claudesaurus --mode plan                      # default, acceptEdits, plan, auto, bypassPermissions
claudesaurus --continue                       # reopen the latest session in this directory
claudesaurus --resume SESSION_ID              # reopen a session, including one from the claude CLI
claudesaurus --remove-rex-actions             # take the split actions out of Rex's palette
```

In Rex, the command palette (Cmd+K) gets two actions, **Claudesaurus: Open in Horizontal Split**
(a new pane to the right) and **Claudesaurus: Open in Vertical Split** (below), both working in
the focused pane's folder. Claudesaurus adds them itself on its first run or with `--setup`, and
keeps them up to date: it copies `rex/claudesaurus.lua` to `~/.config/rex/plugins/claudesaurus/`
and loads it from a marked block in `~/.config/rex/init.lua` (or `$REX_CONFIG`). The actions
start whichever install ran last, a Homebrew one or a source checkout.
`--remove-rex-actions` leaves an empty marked block behind, so later runs keep them out.

Every session adds a note to Claude's system prompt (`src/main/systemPrompt.ts`) saying what the
chat can draw, so Claude answers "show me" with an inline `html` block instead of writing a file.

| Key                      | Does                                                       |
| ------------------------ | ---------------------------------------------------------- |
| Enter                    | Send. While Claude works, the message is queued            |
| Ctrl+Enter               | Send now, into Claude's running turn; or the first queued  |
| Shift+Enter              | New line                                                   |
| Esc                      | Stop Claude                                                |
| `/`                      | Slash commands. `/new` or `/clear` starts a new chat,      |
|                          | `/quit` closes. Enter runs the picked one, Tab fills it in |
| `/resume`                | Pick a past chat from this directory; type to filter       |
| `/patches`, `/tiles`     | Choose how frames are drawn (see Performance)              |
| 1–9                      | Answer a permission prompt (with an empty input)           |
| Ctrl+C                   | Copy the selection, else stop Claude, else clear the input |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom                                                       |
| Ctrl+Q                   | Quit                                                       |

Clicking a link copies its address, since the page cannot open a browser on your computer.

## Status and notifications

Claudesaurus reports what Claude is doing to the terminal with the
[Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status) (OSC 7501),
which Rex shows on tabs and in its session picker (`src/main/status.ts`):

| State     | When                                                          |
| --------- | ------------------------------------------------------------- |
| `working` | A turn is running. The message names the tool Claude is using |
| `blocked` | A permission prompt is waiting (`kind=permission`)            |
| `done`    | A turn finished while the pane was not focused                |
| `idle`    | Waiting for you, or you stopped the turn                      |
| `error`   | The turn or the Claude adapter failed                         |

When a turn finishes, fails or needs permission while the pane is not focused, it also sends a
desktop notification (OSC 777). `rex block call -b BLOCK program_status` shows the current record.

## Performance

Every change on the page is drawn again in the terminal, and with Rex each frame travels from this
machine to the Rex app. So the page avoids changes that are not needed: its one animation is the
dinosaur that hatches and grows up while Claude works, at twelve frames a second, and it shows
streamed text in steps of 80 ms. On a 1440x1749 pane a running turn drew about 19,800 more rows a
second than the idle pane, against 10,900 at eight frames and 7,000 for the four-frame pixel
sprite before it; nothing is drawn for it between turns. During a turn the view follows the newest line, which drew about a quarter more
than moving it a page at a time, measured as rows drawn per word of a reply; the page jumps left
most of the pane empty below the newest line.

Scrolling is cheap only when PixelGUI can move the picture already in the terminal and send just
the strip that came into view. Three things make that work:

- PixelGUI 0.3.3 or newer, which added it.
- The conversation scrolls in an element with an opaque background (`.scroller`), which is what
  lets Chromium scroll it on its own layer and report the scroll to PixelGUI.
- `patches/@zenbu-labs__pixel@0.3.3.patch`. When Chromium has no working GPU it paints every
  frame twice, once without scroll information, and PixelGUI then redraws the whole pane for each
  one. The patch drops the duplicate. Measured on a 1572x1323 pane, scrolling went from about
  9 MB/s sent to the Rex app to about 2 MB/s.

Chromium draws on the CPU when the GPU cannot be used, which costs two to three cores while
scrolling. Check `~/.local/state/pixel/logs/claudesaurus.stderr.log` for GPU errors.

How frames are drawn is a setting, saved in `~/.config/claudesaurus/settings.json`:

- `/tiles` (the default) is what PixelGUI does in Rex: it resends a 256 px tile around each change.
- `/patches` sends only the area that changed. Measured against a remote Rex app it sent about a
  tenth of the data for typing and streaming.

`scripts/bench.sh` measures a build: it replays a recorded conversation in a split and reports
the KB/s sent to the Rex app (the peer's `TxBytes` in `tailscale status --json`) and the app's CPU
while idle, working, streaming and typing. It relies on two settings for development:

- `CLAUDESAURUS_REPLAY=messages.jsonl` shows a conversation the debug capture recorded, without
  starting Claude, and answers every prompt with canned streamed text (`wait` as the prompt leaves
  the turn running).
- `CLAUDESAURUS_RENDER='{"maxFps":10}'` overrides PixelGUI's render settings.

With `CLAUDESAURUS_DEBUG_DIR` set, `notes.jsonl` gets PixelGUI's frame counts every second, and
`kill -USR2` on the app's main process starts an engine profile; a second one stops it and notes
the file (in `profiles/`).

## Develop

```sh
pnpm dev:ui      # the chat page in a browser, with a scripted conversation (add ?static, ?dark or ?empty)
pnpm start       # build, then run in this pane
pnpm check       # format and lint (Biome), anti-slop lint (Oxlint), typecheck, unit tests
pnpm lint:slop   # just the anti-slop lint
```

`tools/oxlint/anti-slop/` is a copy of Dillon Mulroy's anti-slop Oxlint plugin, configured in
`.oxlintrc.json` with every rule at `error`. Biome and Oxlint leave the copy itself alone.

Set `CLAUDESAURUS_DEBUG_DIR` to a folder to log every message sent to the page
(`messages.jsonl`) and keep a screenshot of the page as Chromium drew it (`page.png`). With
`rex split`, `rex send` and `rex send-key`, that is enough to drive and check a real run without
looking at the pane:

```sh
rex split -- env CLAUDESAURUS_DEBUG_DIR=$PWD/.tmp/debug claudesaurus --model haiku --effort low
rex send --block BLOCK 'say hi' && rex send-key --block BLOCK enter
```

To work on Claudesaurus from a session running in Claudesaurus, build, then hand the pane to the
new build with `scripts/dogfood-restart.mjs`: it waits for the turn to end, quits the app and
reopens the same session with this checkout's `bin/claudesaurus.mjs`. It detaches itself, so run
it straight from the session; it logs to `~/.local/state/claudesaurus/restart.log`.

```sh
node scripts/dogfood-restart.mjs "$REX_BLOCK" PIXEL_PID SESSION_ID
```

`PIXEL_PID` is the pane's `pixel` process, the one listening on the Chromium debugging port.

To look inside a pane that is already running, use that port: find it with
`ss -ltnp | grep pixel` on Linux or `lsof -nP -iTCP -sTCP:LISTEN | grep pixel` on macOS, list the
pages at `http://127.0.0.1:PORT/json`, and send `Runtime.evaluate` over the page's WebSocket.

## Release

`pnpm package` builds, in `release/`, the archive `claudesaurus-VERSION.tar.gz` (the built app
with the lockfile and patches) and the Homebrew formula for it, `claudesaurus.rb`, from
`packaging/claudesaurus.rb`. To release, set the version in `package.json`, tag it, attach the
archive to a GitHub release, and copy the formula to `Formula/` in
[backyardbit/homebrew-tap](https://github.com/backyardbit/homebrew-tap).

The Package workflow installs the formula with Homebrew on macOS and Linux and runs
`scripts/smoke.sh`, which starts the installed app on a recorded conversation and keeps a
screenshot of the page. Run it with the `tap` input to check the released formula too.

## Not built yet

- `@` file mentions.
- Opening links and files on the computer you are sitting at.
