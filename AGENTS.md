# Working on Claudesaurus

The README is the reference for how the app works, the development commands and the performance
rules. Read its **Develop** section before testing anything, and its **Performance** section
before changing how the page scrolls, animates or redraws.

## Setup

- Install with `pnpm install`. `--frozen-lockfile` fails on a `patchedDependencies` mismatch;
  commit lockfile changes only when dependencies changed on purpose.
- pnpm skips PixelGUI's install script, so a fresh checkout has no Electron: the app exits with
  "the patched electron build is not installed" and `tsc` fails on `electron` types. Run it once:

  ```sh
  node "$(dirname "$(node -p 'require.resolve("@zenbu-labs/pixel/package.json")')")/scripts/postinstall.mjs"
  ```

## Verify in a Rex pane

Check every UI change in the real app, running in a Rex split beside your own pane and driven
through the `rex` CLI with Rex in the background. The vite dev server in a browser and
`screencapture` are the wrong surfaces: the page is drawn through PixelGUI into Rex, the Rex
window may be on another Space, and a screen capture picks up whatever else the user has open.

1. `pnpm build`.
2. Open a shell split, then start the app in it, so the pane survives the app quitting:

   ```sh
   B=$(rex split -b "$REX_BLOCK" --focus=false | tail -1)
   rex send -b "$B" "env CLAUDESAURUS_DEBUG_DIR=$PWD/.tmp/debug node $PWD/bin/claudesaurus.mjs --model haiku --effort low"
   rex send-key -b "$B" enter
   ```

3. Drive it with `rex send -b "$B" '…' && rex send-key -b "$B" enter`; `rex block call -b "$B"
   program_status` says when a turn is done.
4. Look at `.tmp/debug/page.png` (Chromium's own capture, every 2 s) and `messages.jsonl`.
5. To click, scroll or measure, use the test pane's Chromium debugging port and
   `Runtime.evaluate` (with `awaitPromise` for async expressions). Find the port through the test
   pane's own processes: the foreground pid from `rex block call -b "$B" process`, its
   descendants, then `lsof -nP -a -p PID -iTCP -sTCP:LISTEN`. A bare `grep pixel` also matches
   the pane you are running in.
6. Done when `page.png` or a measurement shows the change behaving, in each state it touches
   (idle, mid-turn, after the turn). Close the test pane with `rex block close "$B"`.

When a change trades smoothness against drawing, measure both versions on the same prompt:
`notes.jsonl` gets PixelGUI's cumulative `stats.rows` every second, so compare rows drawn per
word of the reply.

## Dogfood

The user runs Claudesaurus from this checkout and talks to you through it. To put the pane you
are in on a new build, build, then:

```sh
p=$$; until [ "$p" -le 1 ] || [ "$(ps -o comm= -p "$p" | sed "s|.*/||")" = pixel ]; do p=$(ps -o ppid= -p "$p" | tr -d " "); done
node scripts/dogfood-restart.mjs "$REX_BLOCK" "$p" "$CLAUDE_CODE_SESSION_ID"
```

It waits for your turn to end, quits the app and resumes this session on the new build; it logs
to `~/.local/state/claudesaurus/restart.log`.

## Changes and PRs

- One branch off `main` per change. Commit subjects are short imperative sentences; the body says
  what was wrong and why the change fixes it, as in `git log`.
- `pnpm check` passes before pushing.
- The PR description covers what changed, why, and how it was verified in Rex, with the numbers.
- Merge when the user says to, after CI passes (`gh pr checks N --watch`):
  `gh pr merge N --rebase --delete-branch`, which keeps `main` linear.

## Design

New UI joins the existing visual language: the theme variables at the top of
`src/ui/styles.css`, pill-shaped `.chip`s, and `Popover` for anything that opens. Claudesaurus
reports itself to terminals as `claude-code` on purpose, since it is a front end for Claude Code.
