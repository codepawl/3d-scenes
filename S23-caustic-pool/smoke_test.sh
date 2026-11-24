#!/usr/bin/env bash
# Smoke test: clean install + production build of source/, then validate render.mp4 with ffprobe.
set -u
cd "$(dirname "$0")"
fail() { echo "FAIL: $*"; exit 1; }

( cd source && npm ci --no-audit --no-fund ) || fail "npm ci"
( cd source && npm run build ) || fail "npm run build"

[ -f render.mp4 ] || fail "render.mp4 missing"
command -v ffprobe >/dev/null 2>&1 || fail "ffprobe not found"
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
echo "render.mp4: codec=$codec size=${w}x${h} duration=${dur}s"
[ "$codec" = "h264" ] || fail "codec is $codec, expected h264"
[ "$w" = "1280" ] && [ "$h" = "720" ] || fail "size ${w}x${h}, expected 1280x720"
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || fail "duration $dur not in 5..8 s"
echo "PASS"
exit 0
