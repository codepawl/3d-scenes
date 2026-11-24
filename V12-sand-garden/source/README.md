# V12 Sand Garden

A voxel Zen garden at low sun. A voxel rake works a leveled strip of sand row by row; every pass stamps grooves
into an integer height grid, and the grooves stay there. Moss-islanded granite rocks sit in concentric ring
patterns and cast long soft shadows across the ridges.

## Run
```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # static build in dist/
npm run capture    # writes ../render.mp4 (needs Chrome + ffmpeg on PATH)
```
`?capture=1` switches to deterministic capture mode: fixed 1280x720, time = T0 + n/30 s, and
`window.renderFrame(n)` draws frame n.

## Controls
- Drag: orbit (leaves the cinematic camera), wheel: zoom
- `C`: toggle the cinematic camera
- `Space`: pause the rake
- `R`: level the strip and start raking again (the garden also resets when the rake finishes its path)

## How it works
- `src/garden.js`: the 352x256 height grid (3.75 cm cubic voxels) with a material per cell (sand, moss, timber
  edging, gravel, soil). The rake path is a serpentine of rows and U-turn arcs. Every 0.35 cell the rake stamps a
  4-cell tine profile (groove / flat / ridge / flat) across its width. Only the 32x32 chunks it touched are re-meshed
  by a column mesher (top faces + exposed sides, per-corner AO, per-cell colour from noise, wear and grime).
- `src/voxmesh.js`: face-culled mesher for dense 3D volumes with standard voxel AO, used for rocks, walls, trees and
  the rake. Rock faces buried under the sand are dropped.
- `src/main.js`: low warm directional sun with soft shadows (a 25-tap tent PCF replaces three's 5-tap filter, and the
  shadow camera is fitted to the low sun), hemisphere fill, a dithered gradient sky, ACES tone mapping. All voxel
  materials get sub-voxel grain and roughness variation injected into `MeshStandardMaterial`.
- Groove filtering: each sand vertex also carries a groove-free colour. Based on the pixel footprint on the ground
  plane, the shader blends colour and normal toward the groove average and lifts far shadow lookups above the ridges,
  so grooves stay crisp up close and distant sand stays calm (no moire).

## Licence
MIT. Original work by CodePawl, 2026.
