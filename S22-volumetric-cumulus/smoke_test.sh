#!/usr/bin/env bash
# Smoke test: install + build the Vite project, then validate render.mp4 with ffprobe.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail() { echo "FAIL: $*"; exit 1; }

cd "$HERE/source" || fail "no source/ directory"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund || fail "npm ci"; else npm install --no-audit --no-fund || fail "npm install"; fi
NODE_OPTIONS="--max-old-space-size=1536" npm run build || fail "npm run build"
[ -f dist/index.html ] || fail "dist/index.html missing"

cd "$HERE"
[ -f render.mp4 ] || fail "render.mp4 missing"
command -v ffprobe >/dev/null || fail "ffprobe not found"
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4 | tr -d '\r')
echo "render.mp4: codec=$codec ${w}x${h} duration=${dur}s"
[ "$codec" = "h264" ] || fail "codec is $codec, expected h264"
[ "$w" = "1280" ] && [ "$h" = "720" ] || fail "resolution ${w}x${h}, expected 1280x720"
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || fail "duration $dur not in 5..8 s"
echo "PASS"
exit 0
