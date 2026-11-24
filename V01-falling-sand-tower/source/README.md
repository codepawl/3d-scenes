# Falling Sand Tower (three.js voxels)

## Run

```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build into dist/
npm run capture    # renders ../render.mp4 (6 s, 1280x720, 30 fps); needs Chrome (or Edge) and ffmpeg on PATH
```

Requires a WebGL2 browser. Targets 60 fps at 1280×720 on a mid-range GPU.

## What it shows

A 128³ voxel grid simulated as a falling-sand automaton. A nozzle orbits above a rock tower and cycles through
sand → water → lava (3 s each).

- **Sand** falls, slides diagonally and piles up; it sinks through water.
- **Water** falls, slides, then spreads sideways; lone resting droplets slowly evaporate so pools settle flat.
- **Lava** is a slow liquid; any lava cell touching water turns to **basalt** (stone) and the water boils off.

How it works:
- `src/sim.js`: the grid (`Uint8Array`, index `x + z·128 + y·128²`), world generation and the automaton. Each tick sweeps
  bottom-up but only through 16³ chunks marked active, using a per-cell stamp so nothing moves twice per tick.
  Seeded xorshift RNG, fixed 60 ticks/s.
- `src/mesher.js`: per-chunk mesher that emits only exposed faces, with per-vertex AO and a hashed tint per voxel.
  Water goes into a separate translucent mesh.
- `src/main.js`: three.js scene, remeshing of dirty chunks (time-sliced in live mode), lava glow through an emissive
  vertex attribute plus bloom, 4× MSAA render target, capture mode.

## Controls

| Input | Action |
|---|---|
| Drag / wheel | orbit / zoom (auto-rotates otherwise) |
| `1` `2` `3` | lock nozzle to sand / water / lava |
| `0` | back to cycling |
| Space | pause |
| `R` | reset the world |
| `H` | hide the HUD |

`?capture=1` hides the HUD, fixes the canvas to 1280×720, drives time from a frame counter (1/30 s per frame) and
exposes `window.renderFrame(n)`.

## Licence

MIT. See `../CREDITS.md` for third-party components.
