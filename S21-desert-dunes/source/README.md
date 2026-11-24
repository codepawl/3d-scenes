# S21 — Desert Dunes

A shader piece in three.js: one full-screen triangle with a GLSL3 `RawShaderMaterial` that ray-marches a
procedural dune field, shades wind ripples on the slopes, and runs the sun from dawn through noon and sunset into
a starry night. No textures, no meshes, no stock materials.

## Run

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build in dist/
```

Requires a WebGL2 browser. Runs at 60 fps at 1280x720 on a mid-range GPU (about 7–11 ms/frame measured on an
RTX 3060). Add `?scale=0.75` to render at a lower internal resolution on slower GPUs.

## What you see

- **Dunes**: a heightfield built from an asymmetric dune cross-section (long windward ramp, steep slip face) along
  the wind axis, with crest lines bent by warped value noise, crest height varied by noise, a smaller oblique dune
  train and broad fbm undulation. Ray-marched with adaptive steps and secant refinement.
- **Wind ripples**: a normal-only ripple field perpendicular to the wind, strongest on windward slopes, erased on
  steep slip faces, faded by pixel footprint so it does not shimmer in the distance.
- **Light**: wrapped-diffuse sand with back-scatter, heightfield soft shadows, sky ambient and bounce, sparse
  quartz glitter.
- **Sky**: single-scattering Rayleigh + Mie atmosphere evaluated per pixel; the same model (with dusty air)
  provides aerial perspective, and a CPU copy gives the sun colour and sky ambient each frame. Auto exposure follows
  the sun. At night: twinkling hash-grid stars, a faint milky-way band, cool moonlight.
- ACES-fit tone mapping, manual sRGB, triangular dither against banding.

## Controls

| Input | Action |
|---|---|
| drag | look around |
| W / S (or arrows) | move forward / back |
| C | toggle auto-cruise |
| Space | pause the day cycle |
| [ / ] | scrub time of day |
| 1–5 | presets: dawn, morning, noon, sunset, night |
| R | reset view |
| H | hide the help/fps overlay |

## Capture

`?capture=1` drives time from a frame counter (1/30 s per frame) and exposes `window.renderFrame(n)`.
`npm run build && node capture.mjs` renders 180 frames in headless Chrome (GPU flags) at 2x resolution and
encodes `../render.mp4` with ffmpeg (lanczos downscale, libx264, yuv420p, crf 18). Wrap it with a GPU queue
script if you share the GPU: `bash "$GPU_LOCK" node capture.mjs`.

## Licence

MIT — original work by CodePawl, 2026. See `../CREDITS.md` for referenced techniques.
