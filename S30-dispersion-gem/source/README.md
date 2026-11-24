# S30 Dispersion Gem (three.js, WebGL2)

## Run
```
npm install
npm run dev        # opens the scene
npm run build      # production build into dist/
npm run capture    # needs a build; renders ../render.mp4 (6 s, 1280x720, 30 fps) via headless Chrome + ffmpeg
```
`capture` needs `ffmpeg` on PATH and a Chromium for Playwright (`npx playwright install chromium`, or an installed
Google Chrome is used as a fallback). Stills: `node scripts/capture.mjs --stills 0,90,179 --outdir ../stills`.

URL parameters: `?capture=1` (deterministic frame-counter time at 1/30 s, exposes `window.renderFrame(n)`, renders at
2x internally), `?ss=2` (internal supersampling in interactive mode, for a strong GPU).

## What it shows
A procedurally built brilliant-cut diamond spinning on a brass pin above a honed dark stone plinth. All looks come
from hand-written GLSL (`src/shaders/`):

- `gem.frag` — analytic ray tracing inside the convex gem (facet planes as a uniform array), exact dielectric Fresnel,
  total internal reflection, 6 bounces, 7 jittered wavelengths with per-wavelength IOR (Cauchy, diamond, dispersion
  x3) mapped to RGB. Surface wear: fingerprint haze, polishing scratches, dust motes, frosted girdle.
- `common.glsl` — noise and a procedural studio environment (softboxes, rim strips, tiny spark lights) with analytic
  roughness widening and an analytic irradiance term shared by all materials.
- `plinth.frag` — stone with veins, speckle, top dust, wipe marks, worn/chipped edges with faked bevel normals, drip
  grime, varying roughness, gem shadow and a spinning dispersive caustic.
- `pin.frag` — brushed, tarnished brass. `composite.frag` — bloom, ACES, vignette, grain + dither.

Runs at 60 fps at 1280x720 on a mid-range GPU (tested on an RTX 3060-class card).

## Controls
- Drag: orbit · Wheel: zoom
- Space: pause / resume the spin
- D: cycle dispersion 3x / 1x (real diamond) / off
- H: hide the help line

## Licence
MIT. Copyright (c) 2026 CodePawl. Third-party credits in `../CREDITS.md`.
