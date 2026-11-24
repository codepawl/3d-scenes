#!/usr/bin/env bash
# Builds the project and validates render.mp4. Exits 0 only when every check passes.
set -u
cd "$(dirname "$0")"
fail=0
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

( cd source && npm ci --no-audit --no-fund ) && ok "npm ci" || bad "npm ci"
( cd source && npm run build ) && ok "npm run build" || bad "npm run build"

if [ ! -f render.mp4 ]; then
  bad "render.mp4 missing"
else
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 render.mp4 | tr -d '\r')
  size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 render.mp4 | tr -d '\r')
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 render.mp4 | tr -d '\r')
  [ "$codec" = "h264" ] && ok "codec $codec" || bad "codec '$codec' (want h264)"
  [ "$size" = "1280x720" ] && ok "size $size" || bad "size '$size' (want 1280x720)"
  if awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }'; then ok "duration ${dur}s"; else bad "duration '${dur}' (want 5-8 s)"; fi
fi

[ $fail -eq 0 ] && echo "SMOKE TEST PASSED" || echo "SMOKE TEST FAILED"
exit $fail
