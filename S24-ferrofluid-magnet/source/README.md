# S24 — Ferrofluid Magnet

A pool of ferrofluid sits on a glass plate. A nickel-plated magnet slides underneath; as it passes, the
fluid heaps into a mound and erupts into a lattice of glossy black spikes (the Rosensweig instability),
which follow the magnet and collapse again behind it.

Everything you see is one GLSL fragment shader (`src/ferrofluid.frag`) sphere-tracing a signed distance
field; three.js only provides the WebGL2 context, the fullscreen quad and the capture hooks.

## Run

```bash
npm install
npm run dev        # opens the scene in the browser
npm run build      # production build into dist/
```

## Controls

| Input | Action |
| --- | --- |
| drag | orbit the camera |
| wheel | zoom |
| M | magnet follows the mouse x position (toggle) |
| space | pause |
| H | hide the help line |

## Technique

- **Fluid SDF**: a height-field pool (with a mound raised by a dipole-like field falloff) smooth-unioned
  with exact cones placed on a hexagonal lattice. Each spike's height comes from the field at its cell
  centre, read with a short time lag so the spikes rise and fall after the magnet. The point's own cell
  and the two neighbouring cells that bracket it are evaluated, so the smooth blends never crease at
  cell borders. The lattice is partly dragged by the magnet.
- **Shading**: near-black dielectric (F0 ≈ 0.07, Schlick Fresnel) reflecting a procedural studio
  (softbox panels whose edge softness stands in for roughness) plus a secondary SDF march for
  spike-to-spike reflections; SDF ambient occlusion and soft shadows.
- **Under the glass**: analytic glass plane with Fresnel reflection, analytic cylinder magnet
  (nickel, lathe rings), floor with the fluid's soft shadow and the magnet's cast shadow.
- ACES tone map, sRGB, vignette, per-frame dither against banding.

Performance: about 4.5 ms/frame at 1280×720 on the development GPU (single sample), leaving
headroom for 60 fps on mid-range hardware.

## Capture

`?capture=1` fixes the canvas at 1280×720, renders at 3× resolution and box-filters down, drives time
from the frame number (1/30 s per frame) and exposes `window.renderFrame(n)`.

```bash
npm run build
node scripts/capture.mjs ../render.mp4 180    # needs ffmpeg on PATH and Google Chrome (or CHROME_PATH)
```

## Licence

MIT. Original work by CodePawl, 2026. See `../CREDITS.md` for the formulas it builds on.
