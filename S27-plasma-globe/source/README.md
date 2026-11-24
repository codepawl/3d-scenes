# S27 — Plasma Globe

A plasma globe on a black pedestal in a dark studio. Violet filaments crawl from the glowing core electrode to the
glass; a fingertip orbits the globe, and when it touches the glass most filaments swing over and gather into a bright
bundle at the contact point, then scatter again when it lifts off.

## Run

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # static build in dist/
```

Requires a WebGL2 browser. Tuned for 60 fps at 1280x720 on a mid-range GPU.

## Controls

- Drag: orbit the camera · Scroll: zoom
- Space: pause time · H: hide the help text

## How it works (all shaders hand-written GLSL in `src/shaders.js`)

- **Filaments**: 16 arcs x 3 strands (trunk + 2 branches) of camera-facing ribbons. The vertex shader computes the
  whole path from a single endpoint direction: a sweep from the core to the glass, layered simplex-noise displacement
  with the radial component removed, an envelope pinning both ends, and branches that share the trunk noise and
  diverge past a split point. The fragment shader draws a hot core plus a violet halo with noise flicker.
- **Finger interaction**: JS moves only endpoints (deterministic drift on the sphere) and slerps them toward the finger
  contact direction with a per-arc pull weight; pulled arcs straighten slightly and brighten, free arcs dim.
- **Glass**: Fresnel reflection of a procedural studio environment, an analytic gas haze from the ray's chord length
  through the sphere, and glow spots where filaments and the fingertip meet the glass (front and back faces).
- **Finger / pedestal**: one lit shader with the plasma as a violet point light, wrap lighting and a red subsurface rim
  for skin, plus a procedural nail and crease mask.
- **Post**: HDR half-float MSAA target, 6-level 13-tap downsample / tent upsample bloom, ACES fit, vignette and
  interleaved-gradient-noise dither against banding.

## Capture

`?capture=1` drives time from a frame counter (1/30 s per frame) and exposes `window.renderFrame(n)`.
`npm run capture` serves the app, renders 180 frames in headless Chrome (system Chrome, or set `CHROME_PATH`) and
encodes `../render.mp4` with ffmpeg (must be on PATH). On a shared GPU machine run it as
`bash "$GPU_LOCK" npm run capture` when `GPU_LOCK` is set.

## Licence

MIT. See `../CREDITS.md` for third-party code.
