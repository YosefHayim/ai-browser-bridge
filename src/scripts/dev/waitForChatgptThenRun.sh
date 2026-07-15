#!/usr/bin/env bash
# ChatGPT's backend was returning 502/504 gateway errors on both accounts. Poll-reload
# both debug-port tabs until the signed-in composer (#prompt-textarea) returns on BOTH,
# then auto-run the v8 shonen teaser batch (2 variations). Logs each round so progress
# is visible. Exits 2 if still down after the round budget.
set -u
DEV=/Users/yosefhayimsabag/Desktop/Code/ai-browser-bridge/src/scripts/dev
V8=/Users/yosefhayimsabag/Desktop/Code/the-ascendars/collections-of-images/v8
LOG="$V8/recover-and-run.log"
ROUNDS="${1:-14}"
: > "$LOG"

composer_of() {
  node "$DEV/reloadChatgpt.mjs" "$1" 1 12000 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("composer"))' 2>/dev/null
}

for r in $(seq 1 "$ROUNDS"); do
  a=$(composer_of 9222); b=$(composer_of 9223)
  echo "[$(date +%H:%M:%S)] round $r/$ROUNDS: 9222 composer=$a  9223 composer=$b" >> "$LOG"
  if [ "$a" = "True" ] && [ "$b" = "True" ]; then
    echo "[$(date +%H:%M:%S)] READY — both composers back, launching teaser batch" >> "$LOG"
    bash "$V8/teaser-parallel.sh" >> "$LOG" 2>&1
    echo "[$(date +%H:%M:%S)] BATCH CHAIN DONE" >> "$LOG"
    exit 0
  fi
  sleep 50
done
echo "[$(date +%H:%M:%S)] STILL_DOWN after $ROUNDS rounds — ChatGPT gateway still erroring" >> "$LOG"
exit 2
