# V07 Biome Ring

A voxel island ring split into three biomes (desert, tundra and wetland), each with its own weather made of moving voxels.

## Run
```
npm install
npm run dev        # opens the scene in the browser
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (needs ffmpeg on PATH and Playwright's Chromium)
```
Capture mode: open `?capture=1` and call `window.renderFrame(n)`. Time then comes from the frame counter (1/30 s per frame), not the clock.

## What it shows
- A 160×48×160 `Uint8Array` voxel grid is the source of truth. The ring is an annulus around a lagoon. Its three 120° sectors have noise-warped borders:
  - desert: dunes, banded mesas, cacti, dry bushes
  - tundra: snowy ridges, snow-dusted pines, boulders, ice sheets
  - wetland: pools, mud, moss, reeds, cattails, willows
- A hand-written chunk mesher (16×16 columns) builds the terrain. It does face culling, per-vertex ambient occlusion with quad flipping, per-voxel colour jitter and rock strata. Water is meshed from the grid's water cells.
- The surface detail is a MeshStandardMaterial shader patch. It adds:
  - an 8×8 texel grain on every voxel face and large-scale grime
  - cracks in rock and ice, ripples and glints on sand, sparkle on snow, wet patches on mud
  - roughness that changes per texel, and darker, glossier surfaces in the wetland
- Weather is instanced voxel cubes that collide against the grid:
  - Snow drifts down and writes snow voxels back into the grid (on rock, needles and ice first). The affected chunks are re-meshed live.
  - Rain streaks fall and splash. The wetland water shows impact rings.
  - Sand grains hop along the ring wind, and some of them pile up against rock.
- Voxel cloud puffs drift across the tundra and wetland and cast shadows.

## Controls
Drag to orbit, scroll to zoom. **A** toggles auto-rotate, **Space** pauses the weather, **R** resets the deposited snow and sand.

## Licence
MIT. Original work by CodePawl, 2026.
