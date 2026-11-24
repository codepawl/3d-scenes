# Greedy Mesher City (three.js, voxels)

## Run
```
npm install
npm run dev        # opens the scene in your browser
npm run build      # production build into dist/
npm run capture    # re-renders ../render.mp4 (6 s, 1280x720, 30 fps); needs Google Chrome + ffmpeg on PATH
```
`capture` starts a Vite server, opens `?capture=1` in headless Chrome
(`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`), calls `window.renderFrame(n)` for each frame
(time = n/30 s), reads the canvas with `toDataURL`, and pipes the PNGs to ffmpeg (libx264, yuv420p, crf 18).
To use a different Chrome binary, set `CHROME_PATH`. Pass `--stills 0,90,179` to dump single PNG frames.

## What it shows
A seeded voxel city (192x96x192 grid) at dusk. Over time the sun sinks, the sky turns from golden hour to
blue hour, stars fade in, street lamps come on, and windows light up room by room.

- `src/city.js`: the voxel grid and the procedural generator (the grid is the source of truth).
- `src/mesher.js`: chunked greedy mesher with per-vertex AO. Faces merge only when type and all
  four AO corner values match; the quad diagonal is flipped to keep AO isotropic.
- `src/cityMaterial.js`: Lambert material patch. Window, lamp and beacon glow is picked per voxel cell
  in the fragment shader (pcg3d hash of the voxel coordinate), and pane frames are fwidth-antialiased.
- `src/sky.js`: gradient dusk sky with sun glow, stars and dithering.
- `src/main.js`: renderer, shadows, fog, bloom and MSAA composer, camera path, capture mode.

## Controls
- Drag: orbit (leaves the cinematic camera). Wheel: zoom.
- `C`: toggle the cinematic camera. `R`: restart the dusk. `Space`: pause the dusk. `H`: hide the HUD.

## Licence
MIT. See ../CREDITS.md for third-party sources.
