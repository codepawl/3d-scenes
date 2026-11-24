# S31 — Black Hole Lens

A real-time Schwarzschild black hole rendered entirely in a fragment shader (three.js `RawShaderMaterial`, WebGL2).

## Run

```bash
npm install
npm run dev      # opens the scene in the browser
npm run build    # production build into dist/
```

## What it shows

- **Gravitational lensing.** Each pixel traces a light ray backwards through Schwarzschild spacetime (units r_s = 1) with the
  photon orbit equation written as `x'' = -1.5 h² x / r⁵` (h = |x × v|), integrated with a symplectic step proportional to r.
  The black shadow (radius ≈ 2.6 r_s), the thin photon ring, the Einstein ring of the star field and the lensed far side
  of the disk arching over and under the hole all come out of the integration; nothing is faked.
- **Accretion disk.** A thin disk from 2.6 to 12.5 r_s, sampled wherever a ray crosses the equatorial plane (so secondary
  images are included). Emissivity follows a thin-disk `r⁻³(1-√(r_in/r))` profile; structure is procedural fbm filaments,
  large clumps, dust lanes and gaps, advected with Keplerian differential rotation (two-phase flow to keep shear bounded).
  Optical depth scales with 1/|cos θ| so edge-on regions thicken.
- **Doppler beaming.** Each disk sample gets `g = sqrt(1-1/r) / (γ(1 + β·v̂))` from its orbital speed β = √(0.5/(r-1)).
  Intensity scales as g³ and colour is a Planck spectrum at temperature g·T(r): the approaching (near, right) side is
  brighter and bluer, the receding side dimmer and redder.
- **Sky.** Procedural star field (cube-face grid, flux-conserving widening when lensing compresses the sky) and a faint
  dusty galactic band.
- **Post.** HDR half-float target → 6-level dual-filter bloom → filmic tonemap → luminance-weighted grain + triangular
  dither (no banding in the dark gradients).

## Controls

| Input | Action |
|---|---|
| drag | orbit camera |
| wheel | zoom |
| Space | pause time |
| B | toggle Doppler beaming (compare with g⁰) |
| R | reset view |

## Capture

`?capture=1` switches to deterministic time (frame n → t = n/30 s), renders 1280×720 with `spp` jittered sub-samples per
frame (default 6; AA + short motion blur) and exposes `window.renderFrame(n)`.

```bash
npm run build
node capture.mjs --frames 180 --spp 8 --out ../render.mp4   # needs ffmpeg on PATH
node capture.mjs --bench                                    # ms/frame at 1 spp
node capture.mjs --stills 0,90,179                          # PNG stills
```

## Licence

MIT. See ../CREDITS.md for third-party sources.
