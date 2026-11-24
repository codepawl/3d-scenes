#!/usr/bin/env bash
# Smoke test: install + build the Vite project, then validate render.mp4 with ffprobe.
set -u
cd "$(dirname "$0")"
fail() { echo "FAIL: $*"; exit 1; }

( cd source && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci ) || fail "npm ci"
( cd source && npm run build ) || fail "npm run build"

[ -f render.mp4 ] || fail "render.mp4 missing"
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4)
size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 render.mp4)
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4)
echo "codec=$codec size=$size duration=$dur"
[ "$codec" = "h264" ] || fail "codec is $codec, expected h264"
[ "$size" = "1280x720" ] || fail "size is $size, expected 1280x720"
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || fail "duration $dur not in 5..8 s"
echo "PASS"
