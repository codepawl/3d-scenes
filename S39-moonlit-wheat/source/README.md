# Moonlit Wheat (three.js shader piece)

A moonlit wheatfield: about 240k instanced stalks, bent in the vertex shader by rolling gusts, shaded entirely by
custom GLSL (no textures, no stock materials). WebGL2, three.js 0.187.0.

## Run
```
npm install
npm run dev        # opens the scene
npm run build      # production build in dist/
```

## What you see
- **Wheat**: three `InstancedBufferGeometry` LOD rings (14 / 10 / 5 segments) sharing one shader. Stalks bend along
  a length-preserving arc driven by `gustField()`, which combines scrolling fbm patches with warped wave fronts
  travelling down the wind. Each plant also has its own flutter and sway.
- **Shading**: backlit moon with wrap diffuse, translucency, rim and Kajiya–Kay sheen. Height AO darkens the canopy
  interior, and drifting cloud shadows cross the field. Procedural blotches, grime, fibres, spikelets and ripeness
  patches break up the surfaces.
- **Sky**: gradient, limb-darkened moon with maria, halo, twinkling stars, thin clouds, treeline silhouette. The fog
  uses the sky colour so the field melts into the horizon.

## Controls
- Drag: orbit (leaves the automatic camera). Wheel: zoom.
- `C`: return to the automatic camera drift.
- `Space`: pause time.
- `[` / `]`: weaker / stronger wind.

## Capture
`?capture=1` drives time from a frame counter (1/30 s per frame) and exposes `window.renderFrame(n)`, which renders
frame n and resolves with a PNG data URL. To re-record `../render.mp4` (needs ffmpeg on PATH):
```
npm run build
node scripts/capture.mjs 180 ../render.mp4
```
This uses Playwright's headless Chromium with `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` and
encodes with `libx264 -pix_fmt yuv420p -crf 18`. On a shared GPU machine, wrap the command with
`bash "$GPU_LOCK" ...`.

## Performance
About 3 M triangles per frame, one draw call per LOD ring, no post passes. Measured at a vsync-capped 60 fps at 1280×720 (headless Chrome, RTX 3060 class GPU).

## Licence
MIT. See `../CREDITS.md` for third-party attributions.
