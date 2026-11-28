# Claudesaurus

A graphical Claude Code chat that runs inside a [Rex](https://www.superlogical.com/rex) pane.

Type `claudesaurus` in a Rex terminal and the pane becomes a chat with Claude Code: message
bubbles, tool cards, diffs, permission prompts, and a composer with model, effort and permission
mode chips. Markdown, LaTeX and HTML (scripts included) render for real, because the chat is a web
page drawn into the terminal.

Claude is the default. `/agent` switches the chat to another agent from the
[ACP registry](https://agentclientprotocol.com/registry), such as OpenAI Codex, xAI Grok or Google
Antigravity (see [Other agents](#other-agents)).

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
- **`src/pr`** is the pull request viewer's page, and `src/main/prViewer.ts` its main process,
  which reads GitHub with `gh` (`src/main/pr`).
- **`src/main`** is the main process. It starts
  [`claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp), the adapter T3 Code
  and Zed use, speaks the [Agent Client Protocol](https://agentclientprotocol.com) to it with the
  official SDK, and relays messages to the page (`src/shared/protocol.ts`).

Claude Code runs with your normal setup: login, settings, `CLAUDE.md`, hooks, MCP servers, skills.
Other agents are started the same way, from the ACP registry (`src/main/registry.ts`,
`src/main/launch.ts`).

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
sees it and sets the runtime up again. When a newer release is published on GitHub, packaged
installs download and prepare it in the background into the same folder, show a restart toast in the
top right, and switch to it on `/restart` (or the next launch); set `CLAUDESAURUS_NO_AUTO_UPDATE=1`
to disable. Uninstalling leaves that folder behind.

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
claudesaurus --agent codex                    # chat with another agent for this run
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
An agent that takes no system prompt gets the note with the session's first message instead.

Every session also gets a small MCP server, `claudesaurus` (`src/main/celebrateServer.ts`), with
one tool, `celebrate`. The note asks the agent to call it once a pull request from the
conversation is merged. The tool tells the chat through its socket, and the dinosaur runs in
along the composer in a party hat and roars while confetti cannons fire from the composer's
corners. A chat cannot tell from outside when the work in a thread is done; the agent can. The
tool needs no permission, and a reopened session does not play the party again.

A Markdown image of a video file, `![demo](/abs/path/demo.mp4)`, is shown as a player, so Claude
can show you a recording it made. It plays MP4 and MOV (H.264, HEVC, AV1) and WebM (VP8, VP9,
AV1), never starts by itself, and pauses when scrolled out of view, since every frame it plays is
drawn again in the terminal.

| Key                      | Does                                                       |
| ------------------------ | ---------------------------------------------------------- |
| Enter                    | Send. While the agent works, the message is queued         |
| Ctrl+Enter               | Send now, into the agent's running turn; or the first      |
|                          | queued. An agent that cannot take it mid-turn gets it next |
| Shift+Enter              | New line                                                   |
| Esc                      | Stop Claude                                                |
| `/`                      | Slash commands. `/new` or `/clear` starts a new chat,      |
|                          | `/quit` closes. Enter runs the picked one, Tab fills it in |
| `/resume`                | Pick a past chat from this directory; type to filter       |
| `/restart`               | Restart Claudesaurus, apply any downloaded update, and     |
|                          | reopen the current chat                                    |
| `/agent`                 | Switch to another agent, starting a new chat; type to      |
|                          | filter. Kept for later runs                                |
| `/patches`, `/tiles`     | Choose how frames are drawn (see Performance)              |
| `/zen`                   | Show only the conversation: hide tool calls, thoughts,     |
|                          | notices and the plan; again shows them. Kept for later     |
|                          | runs. Errors and permission prompts still show             |
| 1–9                      | Answer a permission prompt (with an empty input)           |
| Ctrl+C                   | Copy the selection, else stop Claude, else clear the input |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom                                                       |
| Ctrl+Q                   | Quit                                                       |

Clicking a link copies its address, since the page cannot open a browser on your computer. A
GitHub pull request link instead opens the pull request viewer in a split beside the chat (in Rex);
the next one replaces it.

## Pull requests

```sh
claudesaurus pr                               # the pull request of the branch checked out here
claudesaurus pr 15                            # pull request 15 of this folder's repository
claudesaurus pr owner/repo#15                 # or name the repository
claudesaurus pr https://github.com/owner/repo/pull/15
```

The viewer is T3 Code's pull request view, ported (`src/pr`, MIT, see `src/pr/T3CODE-LICENSE`),
reading and writing GitHub through the `gh` CLI and its login:

- **Summary**: reviewers (and requesting more), labels, the description, checks, and the
  conversation, with reactions, editing your own comments, and a box to comment.
- **Timeline**: commits, reviews and comments in order; a commit opens its diff in Code.
- **Code**: the diff, stacked or split, with syntax highlighting, expandable context and a scope
  menu for one commit. Click a line number, or drag across several, to comment: comments gather
  into a pending review that **Review** submits as a comment, an approval or a change request.
  Review threads sit under their lines, where you can reply and resolve them.
- The header holds the merge button and a menu with ready/draft, auto-merge, the merge method,
  close and reopen, and the title is editable.
- **Ask a question**, **Explain this PR**, **Fix** and **Ask** on selected lines leave the task
  in a chat's composer, for you to read over and send. When a chat opened the viewer from a link,
  the task goes to that chat, after anything already typed, and the focus moves there; otherwise
  a new chat opens beside the viewer.
- **Check out** puts the branch in a worktree beside this checkout (`<repo>-worktrees/pr-N`) or
  checks it out here, and opens a chat there.

## Other agents

`/agent` lists Claude and every agent in the [ACP registry](https://agentclientprotocol.com/registry)
that runs on this computer, Codex, Grok and Antigravity first. Picking one starts a new chat with
it, and later runs start with it too; `--agent NAME` picks one for a single run. `NAME` is
`claude`, `codex`, `grok`, `antigravity` or a registry id. The composer shows the agent in a chip,
which opens the list.

Claude runs from the adapter that ships with Claudesaurus and needs no network. For any other
agent, Claudesaurus reads the registry's index, which it keeps in `~/.cache/claudesaurus/` for
when the network is down, and starts the agent as the registry says:

- An npm or PyPI package runs with `npx` or `uvx`, which download it the first time.
- A binary release is downloaded once into `~/.cache/claudesaurus/agents/ID/VERSION/`, checked
  against the registry's SHA-256, and unpacked with the system's `unzip` or `tar`, which keep
  its symlinks. Antigravity's is about 100 MB to download and 300 MB unpacked.

The pane shows the progress while an agent downloads and starts. Each agent uses its own login
and settings (`~/.codex`, `~/.grok`, `~/.gemini`). An agent that needs a sign-in first shows its
ways to sign in: one the agent does itself, usually in the browser, starts when picked; one done
in a terminal opens a Rex pane below that runs the agent's login, and the chat carries on when it
finishes. Outside Rex the card shows the command to run instead.

What each agent can do differs, and the page follows what the agent says it supports:

| Agent       | `/resume`, `--continue` | Ctrl+Enter mid-turn | Note on what the chat draws | Sign-in                |
| ----------- | ----------------------- | ------------------- | --------------------------- | ---------------------- |
| Claude      | yes                     | yes                 | system prompt               | Claude Code's login    |
| Codex       | yes                     | yes                 | system prompt               | ChatGPT or API key     |
| Grok        | yes                     | queued for next     | first message               | Grok, in the browser   |
| Antigravity | yes                     | queued for next     | first message               | Google, in the browser |

`--model`, `--effort` and `--mode` apply to the agent the app starts with, matched to its own
settings by id or kind; one it has no setting for is skipped with a note.

## Status and notifications

Claudesaurus reports what the agent is doing to the terminal with the
[Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status) (OSC 7501),
which Rex shows on tabs and in its session picker (`src/main/status.ts`). It reports under the
agent's own program name, so Rex shows its icon: `claude-code` for Claude, `codex`, `grok-build`,
`agy` for Antigravity, and the registry id for an agent Rex does not know.

| State     | When                                                             |
| --------- | ---------------------------------------------------------------- |
| `working` | A turn is running. The message names the tool the agent is using |
| `blocked` | A permission prompt is waiting (`kind=permission`)               |
| `done`    | A turn finished while the pane was not focused                   |
| `idle`    | Waiting for you, or you stopped the turn                         |
| `error`   | The turn or the agent failed                                     |

When a turn finishes, fails or needs permission while the pane is not focused, it also sends a
desktop notification (OSC 777). `rex block call -b BLOCK program_status` shows the current record.

Claudesaurus also reports how to bring a chat or pull request pane back after a terminal or Rex
server restart using the
[Program Resume Protocol](https://www.superlogical.com/rex/docs/build/program-resume) (OSC 7577,
`src/main/resume.ts`). When the terminal sets `OSC7577_TOKEN`, Claudesaurus strips the token from
child processes, keeps the pane's current agent and session (or pull request target) in a
user-only state file under `~/.local/state/claudesaurus/resume/`, and reports `--resume-file`
with that path. `rex/claudesaurus.lua` automatically registers a `resume.trust.claudesaurus` rule
in Rex when the server supports resume rules; override or disable it in `~/.config/rex/init.lua`
after the Claudesaurus block. Intentional quits (`Ctrl+Q`, `/quit`) remove the state file and
send `clear=1`; terminal shutdowns (`SIGHUP`/`SIGTERM`) keep it so the pane resumes.

## Performance

Every change on the page is drawn again in the terminal, and with Rex each frame travels from this
machine to the Rex app. So the page avoids changes that are not needed: its one animation is the
dinosaur that hatches and grows up while Claude works, at twelve frames a second, and it shows
streamed text in steps of 80 ms. On a 1440x1749 pane a running turn drew about 19,800 more rows a
second than the idle pane, against 10,900 at eight frames and 7,000 for the four-frame pixel
sprite before it; nothing is drawn for it between turns. The party for a merged pull request runs at thirty
frames a second for about seven seconds, since confetti stutters at twelve: on a 1200x1750 pane
it drew up to 91,000 rows a second against 3,500 idle, about 390,000 rows in all, which is what
twenty seconds of the working dinosaur costs. During a turn the view follows the newest line, which drew about a quarter more
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

The same patch keeps resizing calm. PixelGUI gave the page's box the pane's new size at once and
filled it with the old frame, squashed or stretched to fit, until Chromium painted the page at the
new size about 25 ms later, so a drag squashed the whole page on every step. Now the box keeps the
size of the frame on show and takes a new frame's size just before that frame is drawn, and the
page is resized at most every 100 ms during a drag. A single resize lands at once, and the last
size of a drag always lands.
On a 40-step drag of a 1464x1749 pane's width, in `/patches`, frames drawn went from 42 to 21,
squashed draws from 34 to 12, and the times the pane was laid out again from 98 to 58.

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
pnpm dev:pr      # the PR viewer's page in a browser; it needs the app's bridge, so check it in Rex
pnpm start       # build, then run in this pane
pnpm check       # format and lint (Biome), anti-slop lint (Oxlint), typecheck, unit tests
pnpm lint:slop   # just the anti-slop lint
```

`tools/oxlint/anti-slop/` is a copy of Dillon Mulroy's anti-slop Oxlint plugin, configured in
`.oxlintrc.json` with every rule at `error`. Biome and Oxlint leave the copy itself alone.

`tools/oxlint/no-comments/` bans comments in JS and TS. It allows only what a tool reads: a
shebang, `/// <reference>`, `biome-ignore`, `oxlint-` and `eslint-` directives, `@ts-` pragmas,
`#__PURE__`-style annotations, and the `SAFETY:` notes anti-slop requires on type assertions
(with the `//` lines that continue them). `pnpm exec oxlint --fix` deletes the rest.

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
