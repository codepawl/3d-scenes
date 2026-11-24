#!/usr/bin/env bash
# Smoke test: install + build the Vite project, then validate render.mp4 (H.264, 1280x720, 5-8 s).
set -u
cd "$(dirname "$0")"
fail=0
( cd source && (npm ci || npm install) ) || { echo "FAIL: npm install"; fail=1; }
( cd source && npm run build ) || { echo "FAIL: npm run build"; fail=1; }
if [ ! -f render.mp4 ]; then echo "FAIL: render.mp4 missing"; exit 1; fi
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
echo "render.mp4: codec=$codec size=${w}x${h} duration=${dur}s"
[ "$codec" = "h264" ] || { echo "FAIL: codec $codec"; fail=1; }
[ "$w" = "1280" ] && [ "$h" = "720" ] || { echo "FAIL: size ${w}x${h}"; fail=1; }
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || { echo "FAIL: duration $dur"; fail=1; }
if [ $fail -eq 0 ]; then echo "SMOKE TEST PASSED"; else echo "SMOKE TEST FAILED"; fi
exit $fail
