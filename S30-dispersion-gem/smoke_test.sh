#!/usr/bin/env bash
# Smoke test: install + build the Vite project, then validate render.mp4 with ffprobe.
set -u
cd "$(dirname "$0")"
fail=0
( cd source && (npm ci || npm install) ) || { echo "FAIL: npm install"; fail=1; }
( cd source && npm run build ) || { echo "FAIL: npm run build"; fail=1; }
if [ ! -f render.mp4 ]; then
  echo "FAIL: render.mp4 missing"; exit 1
fi
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 render.mp4)
size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 render.mp4)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 render.mp4)
echo "render.mp4: codec=$codec size=$size duration=$dur"
[ "$codec" = "h264" ] || { echo "FAIL: codec $codec"; fail=1; }
[ "$size" = "1280x720" ] || { echo "FAIL: size $size"; fail=1; }
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || { echo "FAIL: duration $dur"; fail=1; }
if [ $fail -eq 0 ]; then echo "SMOKE TEST PASSED"; else echo "SMOKE TEST FAILED"; fi
exit $fail
