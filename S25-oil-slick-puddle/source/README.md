# Oil Slick Puddle (three.js shader scene)

Thin-film interference on an oily rain puddle. Raindrops send rings that push the film around and shift the colour bands.

## Run

```
npm install
npm run dev        # opens the scene in your browser
npm run build      # production build into dist/
```

Requires Node 18+ and a WebGL2 browser. It targets 60 fps at 1280x720 on a mid-range GPU; an RTX 3060 measures about 550 fps uncapped.

## What it shows

- **Oil film**: Airy thin-film reflectance (air / oil n=1.47 / water n=1.333, s+p polarisation) at 16 wavelengths (400-700 nm), converted to RGB with the Wyman et al. 2013 CIE fit. Thickness (about 70-640 nm) is domain-warped fbm that slowly rotates and drifts.
- **Rain rings**: 22 deterministic drop slots, each an analytic dispersive wave packet with a trailing ring and an impact splash. The rings stretch the film outward (it thins inside the ring and is compressed at the crest) and punch a short-lived clear hole, which visibly shifts the interference bands.
- **Puddle**: a heightfield (hollow plus noise plus stone micro-height) against a water level, so stones poke through the shallows. Shallow water shows the refracted asphalt bed, which darkens to silt with depth.
- **Asphalt**: procedural aggregate and sand, binder, cracks, tar stains, dust, a worn and chipped paint line, and wetness-dependent roughness. The pits hold water.
- **Lighting**: an analytic dusk environment (clouds, skyline, lit windows, sodium street lamp), GGX lamp highlights, ACES tonemap, vignette and dither.

## Controls

| Input | Action |
|---|---|
| Left drag | orbit |
| Right drag | pan |
| Wheel | zoom |
| `Space` | pause time |
| `R` | stop / start rain (rings and streaks fade) |
| `C` | reset camera |

URL options: `?ss=2` sets 2x internal supersampling. `?capture=1` turns on deterministic capture mode: time comes from the frame number at 1/30 s per frame, and `window.renderFrame(n)` draws frame n.

## Capture

```
npm run capture    # writes ../render.mp4 (180 frames, 1280x720, 30 fps, H.264)
node scripts/capture.mjs --stills 0,90,179   # PNG stills into frames/
node scripts/fps.mjs                         # live-mode frame-rate probe
```

The capture runs headless Chrome via Playwright with `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`, renders at 2x supersampling, and encodes with ffmpeg (`libx264`, `yuv420p`, CRF 18). On a shared machine, run it through the GPU queue: `bash "$GPU_LOCK" npm run capture`.

## Licence

MIT. Third-party sources are listed in `../CREDITS.md`.
