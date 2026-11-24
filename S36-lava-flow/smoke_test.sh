#!/usr/bin/env bash
# Builds the project and validates render.mp4. Exits 0 only if everything passes.
set -u
cd "$(dirname "$0")"
fail=0

echo "== npm ci"
( cd source && (npm ci || npm install) ) || { echo "FAIL: npm install"; fail=1; }

echo "== npm run build"
( cd source && npm run build ) || { echo "FAIL: build"; fail=1; }

echo "== ffprobe render.mp4"
if [ ! -f render.mp4 ]; then
  echo "FAIL: render.mp4 missing"; fail=1
else
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
  width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
  height=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
  echo "codec=$codec size=${width}x${height} duration=$dur"
  [ "$codec" = "h264" ] || { echo "FAIL: codec is $codec"; fail=1; }
  { [ "$width" = "1280" ] && [ "$height" = "720" ]; } || { echo "FAIL: size ${width}x${height}"; fail=1; }
  awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || { echo "FAIL: duration $dur"; fail=1; }
fi

if [ $fail -eq 0 ]; then echo "SMOKE TEST: PASS"; else echo "SMOKE TEST: FAIL"; fi
exit $fail
