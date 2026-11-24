#!/usr/bin/env bash
# Builds the project and validates render.mp4. Exits 0 only if every check passes.
set -u
cd "$(dirname "$0")"
fail=0
( cd source && (npm ci || npm install) && npm run build ) || { echo "FAIL: install/build"; fail=1; }
if [ ! -f render.mp4 ]; then echo "FAIL: render.mp4 missing"; exit 1; fi
codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 render.mp4 | tr -d '\r')
size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 render.mp4 | tr -d '\r')
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 render.mp4 | tr -d '\r')
[ "$codec" = "h264" ] && echo "ok: codec h264" || { echo "FAIL: codec=$codec"; fail=1; }
[ "$size" = "1280x720" ] && echo "ok: size 1280x720" || { echo "FAIL: size=$size"; fail=1; }
if awk -v d="$dur" 'BEGIN{exit !(d>=5 && d<=8)}'; then echo "ok: duration ${dur}s"; else echo "FAIL: duration=$dur"; fail=1; fi
[ $fail -eq 0 ] && echo "SMOKE TEST PASSED" || echo "SMOKE TEST FAILED"
exit $fail
