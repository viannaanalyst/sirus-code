#!/usr/bin/env bash
# Measures Switchyard launch timing, idle CPU and memory on macOS.
# Usage: scripts/perf/measure-idle.sh [path/to/Switchyard.app] [settle-seconds] [sample-seconds] [focused|background]
# "background" activates Finder after launch, so the app is measured without window focus.
# Attribution: the app process by bundle path; WebKit helpers are the WebContent/GPU/Networking
# processes that appear after launch (a launch-diff heuristic, documented in docs/PERFORMANCE.md).
set -euo pipefail
APP="${1:-src-tauri/target/debug/bundle/macos/Switchyard.app}"
SETTLE="${2:-20}"
SAMPLE="${3:-60}"
MODE="${4:-focused}"
BIN="$APP/Contents/MacOS/switchyard"
helpers() { pgrep -f 'com.apple.WebKit.(WebContent|GPU|Networking).xpc' | sort || true; }
if pgrep -f "$BIN" >/dev/null; then echo "Switchyard is already running; quit it first." >&2; exit 1; fi
before=$(helpers)
t0=$(python3 -c 'import time; print(time.time())')
open -n "$APP"
app=""; for _ in $(seq 1 300); do app=$(pgrep -f "$BIN" | head -1 || true); [ -n "$app" ] && break; sleep 0.05; done
t_proc=$(python3 -c "import time; print(round(time.time()-$t0,2))")
web=""; for _ in $(seq 1 300); do web=$(comm -13 <(echo "$before") <(helpers) | tr '\n' ' '); [[ "$web" == *[0-9]* ]] && break; sleep 0.05; done
t_web=$(python3 -c "import time; print(round(time.time()-$t0,2))")
echo "launch: process after ${t_proc}s, WebKit helpers after ${t_web}s"
sleep "$SETTLE"
if [ "$MODE" = background ]; then osascript -e 'tell application "Finder" to activate' >/dev/null; sleep 3; fi
echo "mode: $MODE"
web=$(comm -13 <(echo "$before") <(helpers) | tr '\n' ' ')
pids="$app $web"
echo "pids: app=$app helpers=$web"
# CPU: cumulative CPU time per process over the sample window, as % of one core.
# (top's per-sample %CPU proved unreliable when several -pid filters are combined.)
cputime() { ps -o time= -p "$1" 2>/dev/null | awk '{n=split($1,a,":"); s=0; for(i=1;i<=n;i++) s=s*60+a[i]; printf "%.3f", s}'; }
# macOS ships bash 3.2 (no associative arrays): keep "pid=seconds" pairs.
starts=""; for p in $pids; do starts="$starts $p=$(cputime "$p")"; done
sleep "$SAMPLE"
total=0
for pair in $starts; do
  p=${pair%%=*}
  used=$(python3 -c "print(round(($(cputime "$p") - ${pair#*=}) * 100 / $SAMPLE, 2))")
  total=$(python3 -c "print(round($total + $used, 2))")
  printf "  cpu avg %-7s %6s%%  %s\n" "$p" "$used" "$(ps -o comm= -p "$p" | awk -F/ '{print $NF}')"
done
printf "  cpu avg total   %6s%%\n" "$total"
echo "memory (physical footprint):"
for p in $pids; do
  fp=$(footprint -p "$p" 2>/dev/null | awk '/phys_footprint:/{print $2,$3; exit}')
  rss=$(ps -o rss= -p "$p" | awk '{printf "%.1f MB", $1/1024}')
  printf "  %-7s footprint=%-12s rss=%s  %s\n" "$p" "${fp:-n/a}" "$rss" "$(ps -o comm= -p "$p" | awk -F/ '{print $NF}')"
done
