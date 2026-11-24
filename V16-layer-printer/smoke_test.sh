#!/usr/bin/env bash
# Build the project and validate render.mp4. Exits 0 only if everything passes.
set -u
cd "$(dirname "$0")"
fail() { echo "FAIL: $*"; exit 1; }
( cd source && (npm ci || npm install) ) || fail "npm install"
( cd source && npm run build ) || fail "npm run build"
[ -f render.mp4 ] || fail "render.mp4 missing"
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 render.mp4)
size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 render.mp4)
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 render.mp4)
echo "codec=$codec size=$size duration=$dur"
[ "$codec" = "h264" ] || fail "codec is $codec"
[ "$size" = "1280x720" ] || fail "size is $size"
awk -v d="$dur" 'BEGIN { exit !(d >= 5 && d <= 8) }' || fail "duration $dur"
echo "PASS"
