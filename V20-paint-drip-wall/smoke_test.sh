#!/usr/bin/env bash
# Smoke test: install + production build of source/, then validate render.mp4 with ffprobe.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
fail=0

echo "== npm ci"
( cd "$here/source" && npm ci --no-audit --no-fund ) || { echo "FAIL: npm ci"; fail=1; }

echo "== npm run build"
( cd "$here/source" && NODE_OPTIONS=--max-old-space-size=1536 npm run build ) || { echo "FAIL: build"; fail=1; }

echo "== ffprobe render.mp4"
vid="$here/render.mp4"
if [ ! -f "$vid" ]; then
  echo "FAIL: render.mp4 missing"; fail=1
else
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$vid")
  w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 "$vid")
  h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 "$vid")
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$vid")
  echo "codec=$codec size=${w}x${h} duration=$dur"
  [ "$codec" = "h264" ] || { echo "FAIL: codec $codec"; fail=1; }
  { [ "$w" = "1280" ] && [ "$h" = "720" ]; } || { echo "FAIL: size ${w}x${h}"; fail=1; }
  awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || { echo "FAIL: duration $dur"; fail=1; }
fi

if [ "$fail" -eq 0 ]; then echo "SMOKE TEST: PASS"; else echo "SMOKE TEST: FAIL"; fi
exit "$fail"
