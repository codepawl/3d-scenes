#!/usr/bin/env bash
# Build the project and validate render.mp4. Exits 0 only if everything passes.
set -u
cd "$(dirname "$0")"
fail() { echo "FAIL: $*"; exit 1; }

( cd source && npm ci --no-audit --no-fund ) || fail "npm ci"
( cd source && npm run build ) || fail "npm run build"

[ -f render.mp4 ] || fail "render.mp4 missing"
command -v ffprobe >/dev/null || fail "ffprobe not found"
probe() { ffprobe -v error "$@" -of default=nw=1:nk=1 render.mp4 | tr -d '\r'; }
codec=$(probe -select_streams v:0 -show_entries stream=codec_name)
w=$(probe -select_streams v:0 -show_entries stream=width)
h=$(probe -select_streams v:0 -show_entries stream=height)
dur=$(probe -show_entries format=duration)
echo "render.mp4: codec=$codec ${w}x${h} duration=${dur}s"
[ "$codec" = "h264" ] || fail "codec is $codec, expected h264"
[ "$w" = "1280" ] && [ "$h" = "720" ] || fail "resolution ${w}x${h}, expected 1280x720"
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || fail "duration $dur not in 5..8 s"
echo "PASS"
