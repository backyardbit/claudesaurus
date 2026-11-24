#!/bin/bash
# Measures what a replayed conversation costs while idle, working, streaming and typing:
# KB/s sent over Tailscale to the machine showing the pane, and CPU% of the app.
#
#   PEER=my-mac scripts/bench.sh LABEL MESSAGES_JSONL [ENV=VALUE...]
#
# Run it from a Rex pane. PEER is the start of the Tailscale host name of the machine running the
# Rex app. MESSAGES_JSONL is a messages.jsonl recorded with CLAUDESAURUS_DEBUG_DIR. Anything else
# drawing in Rex at the same time is counted too, so compare runs against the "base" figure.
cd "$(dirname "$0")/.." || exit 1
label=$1 replay=$(realpath "$2"); shift 2
sent() {
  tailscale status --json | python3 -I -c "
import json, sys
peers = json.load(sys.stdin)['Peer'].values()
print(sum(p['TxBytes'] for p in peers if p['HostName'].lower().startswith('${PEER:?set PEER}'.lower())))"
}
ticks() { cat $(printf '/proc/%s/stat ' "$@") 2>/dev/null | awk '{s+=$14+$15} END{print s+0}'; }
measure() {
  local a b c d
  a=$(sent); c=$(ticks $pids); sleep "$1"; b=$(sent); d=$(ticks $pids)
  echo "$(( (b-a)/$1/1000 )) KB/s, app $(( (d-c)/$1 ))% cpu"
}
pids=""; base=$(measure 5)
before=$(pgrep -f 'electron/dist/pixel' | sort)
block=$(rex split -b "$REX_BLOCK" --split right --label bench --focus=false --json -- \
  env CLAUDESAURUS_REPLAY="$replay" "$@" "$PWD/bin/claudesaurus.mjs" | grep -o 'block:[0-9a-f-]*' | sed -n 2p)
sleep 9
pids=$(comm -13 <(echo "$before") <(pgrep -f 'electron/dist/pixel' | sort) | tr '\n' ' ')
idle=$(measure 5)
rex send --block "$block" "wait"; rex send-key --block "$block" enter; sleep 1
working=$(measure 6)
rex send-key --block "$block" escape; sleep 1
rex send --block "$block" "go"; rex send-key --block "$block" enter
stream=$(measure 7)
sleep 2
(for _ in $(seq 1 40); do rex send --block "$block" "x"; sleep 0.1; done) &
typing=$(measure 4); wait
rex block close "$block" >/dev/null 2>&1
printf '%s\n  base (before the pane opened): %s\n  idle:    %s\n  working: %s\n  stream:  %s\n  typing:  %s\n' \
  "$label" "$base" "$idle" "$working" "$stream" "$typing"
