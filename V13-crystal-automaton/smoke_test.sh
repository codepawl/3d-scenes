#!/usr/bin/env bash
# Builds the project and validates render.mp4. Exits 0 only if every check passes.
set -u
cd "$(dirname "$0")"
fail=0
pass() { echo "PASS: $*"; }
bad()  { echo "FAIL: $*"; fail=1; }

( cd source && (npm ci || npm install) ) && pass "npm install" || bad "npm install"
( cd source && npm run build ) && pass "npm run build" || bad "npm run build"

if [ ! -f render.mp4 ]; then
  bad "render.mp4 missing"
elif ! command -v ffprobe >/dev/null 2>&1; then
  bad "ffprobe not found"
else
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
  size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 render.mp4 | tr -d '\r')
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
  [ "$codec" = "h264" ] && pass "codec $codec" || bad "codec is '$codec', expected h264"
  [ "$size" = "1280x720" ] && pass "size $size" || bad "size is '$size', expected 1280x720"
  if awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }'; then pass "duration ${dur}s"; else bad "duration '${dur}' not in 5-8 s"; fi
fi

if [ $fail -eq 0 ]; then echo "SMOKE TEST: PASS"; else echo "SMOKE TEST: FAIL"; fi
exit $fail
