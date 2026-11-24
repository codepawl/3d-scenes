#!/usr/bin/env bash
# render_film.sh preview N   -> renders/previewN_tokyo_layers.mp4 (960x540, 1 subframe, CRF 27, < 30 MB)
# render_film.sh final       -> renders/final_tokyo_layers.mp4  (1920x1080, 6-subframe motion blur, CRF 16)
# GPU jobs go through gpu-lock at below-normal priority; check nvidia-smi first.
set -e
cd "$(dirname "$0")/.."
# Optional: pipe GPU jobs through a lock so parallel renders do not fight over VRAM.
# Set LOCK to your wrapper (an example is gpu-queue.sh in the same repo); leave unset to run plainly.
LOCK=${LOCK:-"${GPU_LOCK:-}"}
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null || true
if [ -n "$LOCK" ]; then bash "$LOCK" status --brief || true; fi
if [ "$1" = final ]; then
  OUT=renders/final; rm -rf $OUT
  GPU_LOCK_WEIGHT=heavy tools/lowprio.sh bash $LOCK node tools/record.mjs $OUT 1920 1080 6 png all 30
  GPU_LOCK_WEIGHT=heavy tools/lowprio.sh bash $LOCK ffmpeg -v error -y -framerate 30 -i $OUT/f_%05d.png -i renders/audio/soundtrack.wav \
    -map 0:v -map 1:a -vf scale=in_range=pc:out_range=tv,format=yuv420p -c:v libx264 -preset slow -crf 16 -profile:v high -level 4.0 -color_range tv -c:a aac -b:a 192k -shortest -movflags +faststart renders/final_tokyo_layers.mp4
  cp $OUT/f_00000.png renders/cover/cover_final_frame0.png
  ls -la renders/final_tokyo_layers.mp4
else
  N=${2:?preview number}; OUT=renders/preview$N; rm -rf $OUT
  tools/lowprio.sh bash $LOCK node tools/record.mjs $OUT 960 540 1 jpg all 30
  tools/lowprio.sh bash $LOCK ffmpeg -v error -y -framerate 30 -i $OUT/f_%05d.jpg -i renders/audio/soundtrack.wav \
    -map 0:v -map 1:a -vf scale=in_range=pc:out_range=tv,format=yuv420p -c:v libx264 -preset slow -crf 27 -profile:v high -level 4.0 -color_range tv -c:a aac -b:a 128k -shortest -movflags +faststart renders/preview${N}_tokyo_layers.mp4
  mkdir -p renders/review$N
  ffmpeg -v error -y -i renders/preview${N}_tokyo_layers.mp4 -vf "fps=1,scale=480:-1,tile=6x4" -frames:v 2 renders/review$N/sheet_%d.jpg
  ls -la renders/preview${N}_tokyo_layers.mp4
fi
