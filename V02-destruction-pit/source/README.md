# V02 — Destruction Pit

A ruined brick wall made of 64 x 40 x 5 voxels (0.18 m each) is hit from behind by two heavy iron balls.
Voxels break off in connected chunks found by flood fill, then fall, tumble and settle as simple custom rigid bodies.

## Run

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build in dist/
npm run capture    # re-renders ../render.mp4 (needs Google Chrome + ffmpeg on PATH)
```

`?capture=1` switches to deterministic capture mode: time advances 1/30 s per frame and
`window.renderFrame(n)` draws frame n. `scripts/capture.mjs` drives it with Playwright (system Chrome,
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`) and encodes with ffmpeg (libx264, yuv420p, crf 18).

## What it shows / how it works

- **The grid is the source of truth.** Occupancy plus three "broken bond" arrays (x, y and z neighbours).
  All voxels draw as one `InstancedMesh`. A per-instance `aGrid` attribute (the voxel's original grid
  cell) lets the shader paint bricks, mortar, soot, damp, salt bloom and roughness/bump in grid space, so the
  texture stays on each brick as its chunk tumbles. Freshly broken interior faces render cleaner and more orange than the weathered skin.
- **Fracture.** Voxels near the ball are crushed into small Voronoi clusters. A damage ring is split into
  larger Voronoi cells; some detach and the rest stay but get cracked boundaries. Radial cracks plus
  two long structural cracks break bonds through the wall's thickness. A BFS flood fill from the ground row
  then marks every component no longer connected to the ground. Each of those becomes a rigid chunk. A shear rule snaps
  thin ledges that would hold up a big loose chunk.
- **Rigid bodies (own code, `src/physics.js`).** Centre of mass, full inertia tensor from the voxel boxes,
  quaternion integration and sequential impulses (normal plus two friction directions with accumulated clamping).
  Contacts are chunk corners vs the ground, surface-voxel spheres vs the standing grid, chunk vs chunk through a spatial hash,
  and the ball sphere vs everything. Bodies sleep when at rest, and sleeping bodies act as static. Fixed 120 Hz step, seeded RNG, so the run is deterministic.
- Dust puffs, PCF shadows, ACES tone mapping and a room-environment PMREM for the iron's reflections.

## Controls

- Drag to orbit. Use the wheel to zoom.
- Click the wall to fire a ball through that point.
- `R` replays the scripted sequence.

## Licence

MIT. Original work by CodePawl, 2026. three.js is MIT (see ../CREDITS.md).
