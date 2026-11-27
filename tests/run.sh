#!/usr/bin/env bash
# Runs unit + end-to-end tests in headless Chrome. Usage: tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
[ -n "$CHROME" ] || { echo "Chrome not found (set CHROME=/path/to/chrome)"; exit 1; }
PORT=8765
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
status=0
for page in tests/ tests/e2e.html; do
  profile=$(mktemp -d)
  out=$("$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" --window-size=1440,900 --virtual-time-budget=60000 --dump-dom "http://127.0.0.1:$PORT/$page" 2>/dev/null)
  rm -rf "$profile"
  echo "── $page"
  echo "$out" | sed -n '/<pre id="out">/,/<\/pre>/p' | sed 's/<[^>]*>//g' | grep -vE '^ok ' || true
  echo "$out" | grep -q '<title>PASS</title>' || status=1
done
exit $status
