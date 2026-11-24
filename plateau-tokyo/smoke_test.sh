#!/usr/bin/env bash
# Clean-clone smoke test for the plateau-tokyo package.
#
# What this checks:
#   1. CREDITS.md and README.md exist
#   2. Final film MP4 is a readable H.264 stream
#   3. The three.js page loads (start a static server, fetch /, check HTTP 200)
#   4. The GLB pack is consistent (tiles.json references files that exist)
#   5. Node deps for the tools package install cleanly in a temp folder
#
# Exits non-zero on the first failure. Prints PASS at the end on success.

set -eu
set -o pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

echo "[1] metadata files"
test -s README.md
test -s CREDITS.md

echo "[2] final film"
test -s renders/final_tokyo_layers.mp4
if command -v ffprobe > /dev/null; then
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height \
    -of default=noprint_wrappers=1 renders/final_tokyo_layers.mp4 > /tmp/ffprobe.$$
  grep -q "^codec_name=h264$" /tmp/ffprobe.$$ || { echo "codec is not h264"; exit 1; }
  width=$(awk -F= '/^width=/{print $2}' /tmp/ffprobe.$$)
  height=$(awk -F= '/^height=/{print $2}' /tmp/ffprobe.$$)
  rm /tmp/ffprobe.$$
  [ "$width" -ge 640 ] && [ "$height" -ge 360 ] || { echo "stream too small: ${width}x${height}"; exit 1; }
  echo "    stream OK (${width}x${height}, h264)"
else
  echo "    ffprobe not installed; skipping stream shape check"
fi

echo "[3] three.js page loads"
cd source/film
python3 -m http.server 0 > /tmp/serve.$$ 2>&1 &
pid=$!
sleep 1
port=$(awk -F'[ :]' '/Serving HTTP on/ {print $NF}' /tmp/serve.$$ 2>/dev/null | tr -d '[:space:]')
if [ -z "$port" ]; then
  port=$(awk '/port/ {print $NF}' /tmp/serve.$$ | head -1)
fi
if [ -z "$port" ]; then
  # fallback: bind to a fixed port
  kill $pid 2>/dev/null || true
  python3 -m http.server 8731 > /tmp/serve.$$ 2>&1 &
  pid=$!
  sleep 1
  port=8731
fi
status=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/index.html")
kill $pid 2>/dev/null || true
rm -f /tmp/serve.$$
cd "$HERE"
[ "$status" = "200" ] || { echo "page HTTP ${status}"; exit 1; }

echo "[4] GLB pack consistency"
if [ -d renders/plateau-tokyo-glb ]; then
  python3 - <<PY
import json, os, sys
root = "renders/plateau-tokyo-glb"
with open(os.path.join(root, "tiles.json")) as f:
  data = json.load(f)
missing = 0
for tile in data.get("tiles", []):
  for key in ("glb", "thumb"):
    rel = tile.get(key)
    if rel and not os.path.exists(os.path.join(root, rel)):
      missing += 1
if missing:
  sys.exit(f"{missing} tile files missing")
PY
else
  echo "    GLB pack not shipped in this bundle; skipping"
fi

echo "[5] Node tools install"
tmp=$(mktemp -d)
cp source/tools/package.json "$tmp/"
( cd "$tmp" && npm install --silent --no-audit --no-fund --no-progress --no-package-lock > /dev/null )
rm -rf "$tmp"

echo "PASS"
