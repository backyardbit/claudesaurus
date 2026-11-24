#!/bin/bash
# Checks that an installed `claudesaurus` starts: runs it in a pseudo-terminal on a recorded
# conversation, without Claude, and waits for the page to draw.
#
#   scripts/smoke.sh OUTPUT_DIR
#
# OUTPUT_DIR gets the page as Chromium drew it (page.png), the messages the page was sent, and
# what the app wrote to the terminal.
set -uo pipefail
out=$(mkdir -p "${1:?usage: smoke.sh OUTPUT_DIR}" && cd "$1" && pwd)
here=$(cd "$(dirname "$0")/.." && pwd)
export CLAUDESAURUS_DEBUG_DIR="$out" CLAUDESAURUS_REPLAY="$here/test/fixtures/hello.jsonl"

if script --version 2>/dev/null | grep -q util-linux; then
  script -qfc "claudesaurus" /dev/null >"$out/terminal.log" 2>&1 </dev/null &
else
  script -q /dev/null claudesaurus >"$out/terminal.log" 2>&1 </dev/null &
fi
started=$!

# Stops the app this script started, and nothing else that happens to be running.
stop_tree() {
  local child
  for child in $(pgrep -P "$1"); do stop_tree "$child"; done
  kill "$1" 2>/dev/null
}

for _ in $(seq 1 60); do
  [ -s "$out/page.png" ] && break
  sleep 1
done
sleep 3
stop_tree "$started"

if [ ! -s "$out/page.png" ]; then
  echo "smoke: the app did not draw its page. Terminal output:" >&2
  tail -c 2000 "$out/terminal.log" | cat -v >&2
  exit 1
fi
echo "smoke: the page drew ($(wc -l <"$out/messages.jsonl" | tr -d ' ') messages replayed)"
