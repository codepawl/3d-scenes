# Voxel Forge (V11-voxel-forge)

A hammer-and-anvil loop built entirely from voxels in three.js (WebGL2).

## Run

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build in dist/
npm run capture    # renders ../render.mp4 (needs ffmpeg on PATH and a Playwright Chromium: npx playwright install chromium)
```

## What it shows

A dark smithy: brick wall, a coal forge with flickering embers, a stump-mounted anvil and a quench barrel.
A hammer rises and falls on a hot billet four times per 6 s loop. Each blow edits the billet's voxel grid
(top voxels under the hammer face are squeezed out to the sides, so the bar visibly spreads and flattens),
throws a burst of instanced voxel sparks that bounce off the anvil and floor, and flashes the scene.
Over the loop the billet cools from white through yellow and orange to a dull red, then resets.

## Technique

- **Static world** (`src/world.js`): a `Uint8Array` voxel grid (room, window, tool rack, forge, anvil, barrel), meshed by my own face-culling mesher
  (`src/mesher.js`) with per-vertex ambient occlusion and per-voxel tints from value noise (soot, per-brick colour, rust and forge scale), split into matte / metal / emissive meshes.
- **Hammer**: a small voxel grid meshed the same way, animated on a pivot (raise, wind-up, accelerating swing, rebound).
- **Billet** (`src/billet.js`): the source of truth is a 48×8×16 occupancy grid plus a per-voxel temperature field.
  Fixed 1/120 s steps: conduction between occupied neighbours, radiative loss (T⁴) through exposed faces,
  contact loss into the anvil and hammer. Rendered as an `InstancedMesh` of surface voxels with a per-instance
  emissive attribute from an incandescence ramp (`src/heat.js`).
- **Sparks** (`src/sparks.js`): pooled particles, each drawn as a head voxel and two trailing voxels in one `InstancedMesh`.
- **Lighting/post**: billet point light (shadowed) whose colour and power follow the mean surface temperature, shadowed forge light from the coals, daylight through the window, hemisphere bounce,
  cool door fill; MSAA half-float target, UnrealBloom, ACES tone mapping,
  vignette and dither against banding.
- **Capture**: `?capture=1` drives time from a frame counter (1/30 s per frame) and exposes `window.renderFrame(n)`.

## Controls

Drag to orbit, scroll to zoom, `Space` pause, `R` restart the loop, `H` hide the HUD.

## Licence

MIT. Original work by CodePawl, 2026. three.js is MIT (see `../CREDITS.md`).
