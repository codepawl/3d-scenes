# S36 — Lava Flow

Pahoehoe lava creeping down a basalt slope at dusk. The dark glassy crust is broken into plates that drift
downslope with the flow. Cracks between the plates open as the crust travels and show glowing lava. The flow
front buds into inflating toes with glowing breakouts, and hot air above the flow makes the view shimmer.

Everything on screen comes from hand-written GLSL (`ShaderMaterial`): no textures, no stock materials.

## Run

```
npm install
npm run dev        # opens the scene in the browser
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (needs ffmpeg on PATH and Playwright Chromium: npx playwright install chromium)
```

Needs WebGL2. The shader compiles in a few seconds on first load (about 5 s on ANGLE/D3D11). Measured at about
125 fps uncapped at 1280x720 on an RTX 3060.

## Controls

- Left drag: orbit · right drag: pan · wheel: zoom
- `Space`: pause / resume time
- `R`: reset the camera

## Capture mode

`?capture=1` fixes the canvas at 1280x720 and drives time from a frame counter (1/30 s per frame). It exposes
`window.renderFrame(n)`, which draws frame `n` and resolves once the GPU has finished. `scripts/capture.mjs` runs it
in headless Chrome (`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`), reads each frame with
`canvas.toDataURL` and encodes with ffmpeg (`libx264`, `yuv420p`, CRF 18).

## How it works

- `src/shaders/common.js`: noise, Voronoi, and the analytic world (slope, billowy old pahoehoe, channel, toes).
  The same height function displaces the mesh in the vertex shader and runs again per pixel for normals. The
  lava/levee boundary is an exact intersection (`max(rock, lava)`) with no second surface, so no z-fighting.
- `src/shaders/terrain.js`: the crust model. Warped Voronoi plates move in channel-aligned coordinates, with
  per-edge crack opening, hairline cracks, ropy folds and toe skins. A temperature field maps to blackbody-style HDR
  emission. The basalt has vesicles, fractures, ash in hollows, oxidation and varying roughness. Lighting is GGX,
  plus lava light on nearby rock and lava-lit haze. A two-phase flow map (16 s period, 1 s crossfade) stops the
  flow from shearing the pattern apart over time.
- `src/shaders/post.js`: dusk sky dome, mip-chain bloom and heat shimmer. The scene's alpha channel carries a heat
  mask, and each pixel is displaced by heat sampled *below* it, since hot air rises. Then ACES tonemapping, plus
  grain and dither against banding.

## Licence

MIT. See `../CREDITS.md` for third-party code.
