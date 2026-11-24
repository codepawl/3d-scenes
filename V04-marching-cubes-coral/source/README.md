# Marching-Cubes Coral (three.js, WebGL2)

## Run
```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (needs ffmpeg on PATH and Playwright's Chromium: npx playwright install chromium)
```
Capture mode: open `?capture=1`. Time then comes from a frame counter (1/30 s per frame), and
`window.renderFrame(n)` draws frame n and resolves when it is done. `scripts/capture.mjs` drives it in headless
Chrome (`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`) and pipes PNG frames to ffmpeg (libx264, yuv420p,
crf 18). With `--soft` it uses SwiftShader instead, for quick preview stills without a GPU.

## What it shows
Several coral colonies grow on a rocky seabed by 3D lattice diffusion-limited aggregation:
- `src/dla.js`: the voxel grid (empty / rock / coral, plus attach order and colony id), an fBm seabed with
  boulders, and the DLA. Walkers are released on a sphere around each colony's centroid, random-walk with a slight
  sinking drift, treat rock as a wall (sometimes settling on it), and stick on 26-neighbour contact.
- `src/field.js`: voxels splat a smooth kernel into a float density field (coral is also tracked separately), and
  the 16³ chunks a splat touches are marked dirty.
- `src/mesher.js`: chunked marching cubes with shared vertices per chunk, gradient normals, a coral/rock weight,
  and ambient occlusion probed from the density field.
- `src/material.js`: MeshStandardMaterial with `onBeforeCompile`. Colour ramps by depth. Coral gets Worley polyp
  cups, septa ridges, grain, bleached wear and algal film; rock gets pits, algae on up-facing surfaces and pink
  coralline crust. Roughness varies with all of these. Caustics modulate the sun, and colour is absorbed and fogged
  with distance.
- `src/water.js`: the backdrop gradient with light shafts, and deterministic marine snow.

## Controls
- Drag to orbit, scroll to zoom, right-drag to pan (the camera auto-rotates).
- `Space`: pause growth
- `R`: regrow from the seeds
- `F`: jump to fully grown
- URL `?seed=N`: a different DLA run

## Licence
MIT. See ../CREDITS.md for third-party pieces.
