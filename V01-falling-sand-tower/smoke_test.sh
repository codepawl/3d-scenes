#!/usr/bin/env bash
# Builds the project and validates render.mp4 (H.264, 1280x720, 5-8 s). Exits 0 only if everything passes.
set -u
cd "$(dirname "$0")"
fail() { echo "FAIL: $*"; exit 1; }

( cd source && (npm ci || npm install) ) || fail "npm install"
( cd source && npm run build ) || fail "npm run build"

[ -f render.mp4 ] || fail "render.mp4 missing"
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
height=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
echo "render.mp4: codec=$codec ${width}x${height} duration=${dur}s"
[ "$codec" = "h264" ] || fail "codec is $codec, expected h264"
[ "$width" = "1280" ] && [ "$height" = "720" ] || fail "resolution ${width}x${height}"
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || fail "duration $dur not in 5-8 s"
echo "PASS"
