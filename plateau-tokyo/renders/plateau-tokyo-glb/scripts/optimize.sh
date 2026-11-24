#!/usr/bin/env bash
# optimize.sh IN.glb OUT.glb [texsize]  -> weld + meshopt (quantized) + WebP textures
set -e
GT="node $(dirname "$0")/node_modules/@gltf-transform/cli/bin/cli.js"
T=$(mktemp -u).glb
$GT weld "$1" "$T" >/dev/null
if [ -n "$3" ]; then $GT resize "$T" "$T" --width "$3" --height "$3" >/dev/null; fi
$GT webp "$T" "$T" --quality 82 >/dev/null 2>&1 || true
$GT meshopt "$T" "$2" --level medium >/dev/null
rm -f "$T"
