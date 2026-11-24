# Ink in Water (S26)

A real-time three.js shader piece. Ink drops into a glass tank of water, and a GPU stable-fluids simulation drives a
dense, curling ink volume. Everything you see is GLSL: no textures, no stock materials.

## Run

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build into dist/
```

Needs a WebGL2 browser with half-float render targets (any current desktop browser).

## What it shows

- **Simulation** (`src/fluid.js`): a 288x308 velocity grid in the tank's vertical mid-plane, with RK2 semi-Lagrangian
  advection, vorticity confinement, negative buoyancy (ink is heavier than water), a faint drifting stir to break
  symmetry, divergence, 36 Jacobi pressure iterations and gradient subtraction. Two ink channels are advected on an
  864x924 dye grid.
- **Rendering** (`src/sceneShader.js`): one fullscreen fragment shader ray-traces the tank analytically. Glass reflects
  (Fresnel) and refracts (Snell), shows green thick-glass edges, wipe streaks, fingerprints, dust and a limescale line,
  plus droplets above the water. Under the surface you get total internal reflection. The ink volume is the 2D dye
  lifted into depth: thickness comes from a blurred copy of the dye, and 3D noise warps each z-slice. It is ray-marched
  with Beer-Lambert absorption, single scattering and a light-direction shadow march. The table is worn concrete
  (aggregate, pits, ring stains, scratches, varying roughness) with the ink's coloured shadow and caustics falling on
  it. The wall is lime plaster with trowel marks, streaks and hairline cracks.
- **Post**: 2x2 SSAA resolve (capture mode), ACES fit tonemap, light grade, vignette, grain and dither.

## Controls

- Click: drop ink at that horizontal position
- C: cycle ink colour (indigo, carmine, mixed)
- Space: pause, R: reset
- Mouse move: small camera parallax

URL options: `?ssaa=2` renders at 2x and downsamples (sharper, about 4x the cost). `?capture=1` turns on deterministic
capture mode.

## Capture

`?capture=1` drives time from a frame counter (1/30 s per frame, 2 fluid substeps) and exposes `window.renderFrame(n)`,
which returns a promise. `npm run capture` starts Vite, drives headless Chromium through `playwright-core` with
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`, reads each frame with `canvas.toDataURL` and pipes it to
`ffmpeg -c:v libx264 -pix_fmt yuv420p -crf 18`. It needs `ffmpeg` on PATH and a Playwright Chromium
(`npx playwright-core install chromium`). On a shared GPU machine with `GPU_LOCK` set, run
`bash "$GPU_LOCK" npm run capture`.

## Licence

MIT. Copyright (c) 2026 CodePawl.
