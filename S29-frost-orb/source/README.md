# S29 — Frost Orb

A solid glass orb on a worn wooden table in a dim room lit by a window. Frost nucleates at one point on the
orb and spreads across it: fern-like dendrites grow away from the seed, small hexagonal stars fill the gaps,
and a granular rime haze thickens behind the growth front. Frosted glass turns rough and milky, so the view
through the orb blurs where the ice is, and the caustic on the table spreads and dims as the orb frosts over.

## Run

```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # static build in dist/
```

Requires a WebGL2 browser. Runs well above 60 fps at 1280x720 on a mid-range GPU (RTX 3060 class).

## Controls

- drag: orbit, wheel: zoom (the camera also slowly auto-rotates)
- Space: pause / resume frost growth
- R: restart the frost
- H: hide the help text

Live mode loops: about 12 s of growth, then the frost melts back over 4 s.

## Capture

`?capture=1` switches to deterministic time (frame n = n/30 s) and exposes `window.renderFrame(n)`, which
averages 16 sub-pixel-jittered sub-frames per video frame. `npm run capture` drives this with Playwright in
headless Chrome (`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`) and pipes PNG frames to ffmpeg
(`libx264 -pix_fmt yuv420p -crf 18`), writing `../render.mp4`. Options: `--frames 180 --sub 16`,
`--stills 0,90,179 --stillsDir stills` for single frames. `node scripts/fps.mjs` measures live frame rate.

## How it works

Everything is drawn by one fullscreen GLSL3 `RawShaderMaterial` (`src/trace.frag.glsl`); three.js provides the
camera, the half-float accumulation targets and the loop. Per pixel:

- **Glass**: analytic ray/sphere hit, Fresnel-weighted reflection plus refraction into the solid sphere with up to
  three internal events (TIR handled) and Beer absorption. **Rough transmission**: microfacet normals are
  jittered by a roughness map at both the entry and exit surfaces; the rest of the blur is done analytically by
  widening the procedural environment's features (`envMap(dir, blur)`), so few samples are needed.
- **Frost growth**: a growth front (geodesic angle from the seed, roughened by noise) sweeps the sphere. A 3D cell
  lattice provides nucleation sites projected onto the sphere; when the front reaches a site, a crystal starts
  growing there: ferns (stem pointing away from the seed, 60° side branches) and six-armed stars, built from
  segment distance fields with pixel-footprint anti-aliasing. Frost raises roughness, scatters light white,
  perturbs the normal and throws glints; frost on the far side is seen through the glass.
- **Wear**: smudges, a fingerprint, hairline scratches, dust specks and a grime band near the contact point
  vary the glass roughness. The table has wood grain, pores, scratches, grime, a water ring and varying gloss.
- **Display**: running average (EMA live, exact average in capture), mip-chain bloom, ACES, vignette, dither.

## Licence

MIT. See `../CREDITS.md` for third-party snippets.
