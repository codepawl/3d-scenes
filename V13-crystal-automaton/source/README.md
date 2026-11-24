# Crystal Automaton (V13)

A 3D cellular automaton grows a voxel crystal from a small seed. Each voxel is coloured by its age:
newborn cells are ice-cyan and glow while alive, then cool through aqua and cobalt to violet and deep plum.
A quarter wedge is cut out of the render so the growth rings inside are visible.

## Run

```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # static build in dist/
```

URL options: `?seed=7` picks the starting seed, `?cut=0` turns off the cutaway, `?capture=1` turns on the
deterministic capture mode (time = frame/30 s, `window.renderFrame(n)` draws frame n and returns a promise).

## What it simulates

- Grid: 128³ voxels (`Uint8Array`, states: empty / live / frozen crystal), Moore neighbourhood (26 cells).
- Rule **S4-5 / B5**: an empty cell with exactly 5 occupied neighbours is born; a live cell survives with 4 or 5.
- A live cell that fails survival does not vanish; it freezes into inert crystal. Neighbour counts include frozen
  cells, so they only ever go up. That keeps the crystal growing (pure binary 4-5/5 dies out from every seed we
  tried) and makes the step incremental: only neighbours of the last generation's births can be born.
- Seed: a random, mirror-symmetric (8-fold) cluster in a 5³ box. The first seed that keeps growing is used.
- 120 generations (~200k voxels) are simulated at load in about 150 ms. For every voxel the grid records the
  generation it was born, the generation it froze, and the generation all 6 face neighbours filled in (after that
  it can't be seen).

## Rendering

One instanced draw of a unit cube (three.js `InstancedBufferGeometry`), with per-instance position and those
three generation numbers. A `MeshStandardMaterial` patched with `onBeforeCompile` scales voxels in as they are born,
drops buried ones, colours by age, adds glow to live cells and draws antialiased edge lines. Instances are
sorted by burial generation, so the voxels that are already enclosed get dropped by lowering `instanceCount`.
The crystal sits above a matte plinth with a thin cyan rim. A soft-edged spotlight from above casts its shadow,
and a navy-to-black gradient dome frames it. The pipeline adds a RoomEnvironment reflection map, 4× MSAA, a very
faint bloom that only touches the live cells (so voxel edges stay crisp), ACES tone mapping and a dither pass
that stops banding.

## Controls

| Input | Action |
|---|---|
| drag / wheel | orbit / zoom (turns off auto-framing) |
| F | turn auto-framing back on |
| Space | pause / resume growth |
| ← / → | scrub generations |
| + / − | growth speed |
| R | new seed |
| C | toggle cutaway wedge |
| H | toggle HUD |

## Licence

MIT. See `../CREDITS.md`.
