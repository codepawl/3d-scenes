# S23 Caustic Pool (three.js / WebGL2)

## Run
```
npm install
npm run dev        # opens the scene in the browser
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (needs ffmpeg on PATH and Playwright's Chromium: npx playwright install chromium)
```

## What it shows
An underwater camera dollies slowly along a mosaic-tiled pool. Sunlight refracts through a moving wave field and
gathers into caustic networks on the floor and walls, with faint chromatic fringes, sun glints on the glazed tiles,
fresnel sheen on each slightly tilted tile, light shafts in the water, and the rippled surface overhead showing total
internal reflection. Everything is procedural GLSL in `src/shaders.js`; there are no textures.

## Controls
- Drag: look around (offset from the dolly direction)
- Mouse wheel: dolly / wave speed
- Space: pause
- H: hide the help text

## Capture mode
`?capture=1` fixes the canvas at 1280x720, drives time from a frame counter (1/30 s per frame) and exposes
`window.renderFrame(n)`, which draws frame *n* and resolves once the GPU is done. `scripts/capture.mjs` drives it with
headless Chrome (`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`) and encodes with ffmpeg
(`libx264, yuv420p, crf 18`). `--stills 0,90,179` writes only those frames to `frames/`.

## Licence
MIT. Original work by CodePawl, 2026. See ../CREDITS.md for third-party sources.
