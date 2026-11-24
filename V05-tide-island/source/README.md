# Tide Island (V05)

A voxel island on a 160 × 160 × 48 grid. The tide rises and falls; sand the water has touched stays dark
and glossy until it dries, and foam gathers along the swash line.

## Run

```
npm install
npm run dev        # opens the scene in your browser
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (needs ffmpeg on PATH and Playwright's Chromium: npx playwright install chromium)
```

`?capture=1` turns on capture mode. Time comes from a frame counter (1/30 s per frame) and
`window.renderFrame(n)` draws frame n. In capture mode one full tide cycle takes 6 s, starting at high tide.

## What it shows / how it works

- **The grid is the source of truth.** A `Uint8Array` voxel grid is filled from a seeded fbm heightmap with an
  island mask. It holds seabed, sand, gravel, dirt, grass, rock, rock stacks in the shallows, and voxel trees.
- **Mesher.** A hand-written face-culling mesher emits one quad per exposed face, with per-vertex ambient
  occlusion and the quad diagonal flipped to avoid AO seams (about 40k quads, one draw call).
- **Tide simulation.** Per-column state is stepped on a fixed dt next to the grid:
  - *wet height*: jumps up to the water level plus wave run-up, then sinks slowly as the sand dries;
  - *foam*: set where the surface meets the waterline next to open water, then decays;
  - *shore distance*: a BFS from dry land each step.
  This state is uploaded each frame as a float texture.
- **Terrain shading.** A `MeshStandardMaterial` patched with `onBeforeCompile` adds per-voxel tint, texel grain
  that fades with screen footprint, wear blotches, grime in AO creases, moss on rock tops, sand specks and ripples,
  and roughness that varies across each surface. A voxel below its column's wet height turns to wet sand: darker,
  lower roughness, with puddle sheen. Foam speckles sit on the waterline, and terrain below the water gets caustics.
- **Water.** A flat plane at the tide level. Its colour comes from depth over the grid heights, plus wave normals,
  fresnel sky reflection, sun glint, and foam bands that roll toward the shore along the BFS distance field.
  The plane's height is kept off exact integers so it never z-fights a voxel top face.

## Controls

- Drag: orbit (this stops the auto-orbit). Scroll: zoom.
- `Space`: pause the tide. `[` / `]`: halve / double the tide speed. `O`: toggle auto-orbit.

## Licence

MIT. Original work by CodePawl, 2026. Third-party sources are listed in `../CREDITS.md`.
