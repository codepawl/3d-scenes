# S28 — Aurora Tundra

A fully procedural night scene rendered by one GLSL fragment shader (three.js `RawShaderMaterial`, WebGL2):
ray-marched aurora curtains over a snowy tundra, a star field with a faint milky band, and a frozen lake whose
black ice mirrors the aurora. There are no textures or stock materials; every surface comes from shader code.

## Run
```
npm install
npm run dev        # opens the scene in the browser
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (6 s, 1280x720, 30 fps) via headless Chrome + ffmpeg
```
`npm run capture` needs ffmpeg on PATH and a Playwright Chromium (`npx playwright install chromium`).
Options: `--frames 180 --ss 2 --out ../render.mp4`, or `--stills <dir> --at 0,90,179` for PNG stills.
On a shared GPU machine: `bash "$GPU_LOCK" npm run capture`.

## What you see
- **Aurora**: a slab between 110 and 400 units altitude, ray-marched with jittered steps. The curtains are the zero
  level set of a domain-warped noise field (two folding east-west arcs). Ray striations come from noise in xz only,
  so they stay vertical. Colour depends on altitude: a bright green lower edge, a magenta/red upper tail, and a pink
  fringe where the curtain is most intense.
- **Stars**: hashed cells over view direction, drawn as gaussians one pixel wide (anti-aliased), with colour
  temperature, twinkle, horizon extinction and a faint dusty milky band.
- **Tundra**: height-field ray march. Rolling hills use derivative-damped fbm, with ridged mountains in the distance.
  Snow thins on slopes and wind-scoured crests, so rock and dwarf scrub show through. The snow has grime, wind
  ripples and sparse glints up close.
- **Frozen lake**: clear black ice (Fresnel mirror, F0 ≈ 0.018), frosted patches, wind-streaked snow drifts, Voronoi
  cracks at two scales, and air bubbles seen with parallax through the ice. Roughness varies across the surface and
  scatters or dims the reflection. The reflected ray is marched against the terrain and the aurora.
- Tone mapping (ACES fit), vignette and triangular dither (against banding) are all applied in the shader.

## Controls
- Drag: look around · `R`: reset view
- `Space`: pause · `+` / `-`: change time speed
- URL params: `?steps=48` sets aurora march steps (default 32), `?pr=1.5` sets the max pixel ratio (default 1)
- `?capture=1&w=1280&h=720`: deterministic capture mode. Time comes from a frame counter (1/30 s per frame), and
  `window.renderFrame(n)` draws frame n and resolves when it is done.

## Performance
About 9 ms per frame at 1280x720 on an RTX 3060 with default settings, so it holds 60 fps on a mid-range GPU.

## Licence
MIT. Original work by CodePawl, 2026. See `../CREDITS.md` for the techniques referenced.
