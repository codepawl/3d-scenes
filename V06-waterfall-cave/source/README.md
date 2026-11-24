# V06 — Waterfall Cave (voxels)

Cellular water flows over stepped voxel terrain into a cave pool. You can see foam voxels at each lip, mist rising from instanced cubes, and a sun shaft through a skylight.

## Run

```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (6 s, 1280x720, 30 fps) with headless Chrome + ffmpeg
```

`npm run capture` needs `ffmpeg` on PATH and a Playwright Chromium (`npx playwright install chromium`).
To get one still per frame instead of a video: `node capture.mjs --stills 0,90,179` (PNG files go to `.frames/`).

## What it shows / how it works

- **Grid as source of truth.** A 48×48×64 `Uint8Array` of materials (air / rock / gravel) is generated from value noise. It holds a cave, a back tunnel open to daylight, three undercut terraces with a carved channel, a deep pool, a skylight and an outflow tunnel.
- **Water** is a parallel `Float32Array` of mass per cell. A mass-based cellular automaton updates it at 60 steps/s: water flows down (with slight compression), spreads to 4 neighbours and pushes excess pressure up. The grid is double buffered, so cell order does not matter. A source sits in the back tunnel. A sink in the outflow tunnel and a gentle surface drain keep the pool level.
- **Meshers (written for this project).** Rock uses a face-culled mesher with per-vertex ambient occlusion and a quad-flip fix. It is built once after warm-up, so wetness and moss come from where the water actually ended up. Water is re-meshed every frame: culled faces, per-cell heights, corner-smoothed surfaces on resting water, and fall/foam attributes.
- **Surfaces.** A CPU-generated tileable rock texture (fbm + cellular cracks) drives albedo, roughness and bump. On top of that come per-voxel colour jitter, strata, iron staining, grout seams with chipped edges, world-space grime and streaks, wet darkening with gloss, and moss on damp top faces.
- **Foam voxels** (instanced cubes) spawn at lip and impact cells found from the water's flux. **Mist** is about 1800 instanced translucent cubes that rise from impact zones. They brighten inside the analytic sun-shaft volume.
- **Capture mode** (`?capture=1`): time comes from the frame counter at 1/30 s per frame (2 sim steps). `window.renderFrame(n)` renders frame n.

## Controls

- Mouse: orbit / zoom / pan (OrbitControls)
- `Space`: pause / resume the simulation
- `C`: toggle the 6-second cinematic camera

## Licence

MIT, © 2026 CodePawl.
