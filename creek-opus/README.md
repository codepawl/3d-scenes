# Aki's hollow

Aki's hollow is a real-time three.js scene of a shallow creek. The creek flows out of a stone culvert below a small timber cabin.
Blender Python scripts model every asset procedurally and export the assets as GLB files.
The web app loads the GLB files and adds the water, the grass, the lighting and the camera effects.

![Afternoon with depth of field](shots/afternoon-dof.png)

## Run the scene

You need Node.js (tested with 24.19) and a browser with WebGL 2.

1. Run `npm install` in this folder. It installs `three@0.170.0`, `http-server` and `playwright`.
2. Run `npm run serve`. The server listens on port 5199.
3. Open `http://localhost:5199` in the browser. The title "Aki's hollow" shows when the scene is ready.

The page loads three.js from `node_modules` through an import map, so any static server works.
The fonts come from Google Fonts. Without a network connection, the page uses system fonts.

## Controls

| Input | Action |
| --- | --- |
| Drag | Look around |
| Mouse wheel | Move up or down the creek |
| `W` `A` `S` `D` or arrow keys | Walk. Hold `Shift` to walk faster |
| `1` `2` `3` `4` | Afternoon, Golden, Blue, Night |
| `F` | Turn depth of field on or off |
| `C` | Turn the DSLR look on or off |

The DSLR look adds a vignette, film grain, a small chromatic aberration at the edges and a slow handheld sway.
Depth of field focuses automatically on the surface at the centre of the screen.

## How the assets were made

All assets come from `blender/build_assets.py`, which runs in Blender 5.2 without the user interface.

1. Run `npm run assets` in PowerShell. It starts Blender at below-normal priority and waits for it.
2. Read the last lines of the output. They list each file in `assets/` with its size.

You can also run Blender directly:

```text
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python blender/build_assets.py
```

A full build takes about 10 seconds on the CPU. The modules in `blender/lib/` do the work:

- `creek_layout.py` builds the creek centreline from a Catmull-Rom spline. It sets the water level with two small cascades, the channel width and the bed depth.
- The same module carves the bank heightfield. It adds a raised embankment over the culvert and a flat hill for the cabin.
- It places the props with dart throwing. The layout has 296 boulders, 1750 wall and toe stones, 1668 pebbles, 132 trees and 85 bushes.
- `shapes.py` makes the boulders from displaced, smoothed superellipsoids. Vertex colours hold baked occlusion, cavity shading and lichen.
- `asset_terrain.py` writes the 0.4 m terrain grid and a coarse outer meadow. Vertex colours hold horizon-based occlusion and contact shadows under props.
- `asset_culvert.py` builds the coursed headwall, the voussoir arch, the capstones and a dark barrel from rounded blocks.
- `asset_cabin.py` builds the cabin from lap siding planks on a stone plinth. It adds a porch, a balcony, shutters, flower boxes, a shingle roof, a chimney and lanterns.
- `asset_trees.py` grows trunks and branches as tubes with leaf cards. It paints the leaf atlas with numpy and embeds the atlas in the GLB.

The build writes these files:

| File | Contents | Size |
| --- | --- | --- |
| `terrain.glb` | Carved banks and the outer meadow, with a `_MASK` attribute for grass, bed and dirt | 5.7 MB |
| `rocks.glb` | 8 boulder, 6 wall stone and 4 pebble variants | 0.7 MB |
| `culvert.glb` | Headwall, arch and barrel | 0.4 MB |
| `cabin.glb` | Cabin body, window glass, lanterns and stone plinth | 1.1 MB |
| `trees.glb` | 4 tree and 2 bush variants with the leaf atlas | 1.2 MB |
| `layout.json` | Creek samples and the transform and tint of every prop instance | 0.35 MB |
| `field.bin` | Height, water level and masks on the terrain grid, as float32 planes | 1.7 MB |

The web app reads `layout.json` and draws each prop variant as one `InstancedMesh`.

## How the scene renders

`src/main.js` assembles the scene. `src/post.js` renders every frame in these passes:

1. The opaque pass draws the sky, terrain, props and grass into a 4x MSAA half-float target with a depth texture.
2. The water pass draws the creek surface into a second target. The water shader reads the opaque colour and depth.
3. The water shader gets the bed depth from the depth texture. It applies Beer-Lambert absorption, refraction, a short screen-space reflection, foam and sun glints.
4. A composite pass merges the two targets and stores the circle of confusion in the alpha channel.
5. A half-resolution bokeh pass gathers samples on a golden-angle spiral. A merge pass blends the blur back in.
6. An `UnrealBloomPass` adds glow to the glints and the windows. The final pass applies ACES tone mapping and the DSLR look.

The terrain, stone, bark and leaf materials are `MeshStandardMaterial` with shader patches in `src/materials.js`.
The patches add detail noise, wet stone near the waterline and animated caustics under water.
The leaf patches add wind and back-lit translucency.
The grass is 320,000 instanced blades in `src/grass.js`, and each blade bends in the wind.
Each time-of-day preset in `src/presets.js` sets the sun, sky, fog, exposure, cabin glow, water tint and fireflies.
A preset change blends all of these values over 1.8 seconds.

## Check the scene

Start the server with `npm run serve` before you run these tools. Each tool drives headless Chromium on the GPU.

1. Run `node tools/shoot.mjs`. It writes the eight preset screenshots to `shots/`. Add `--views` for four more camera angles.
2. Run `node tools/ui-check.mjs`. It prints PASS or FAIL for the controls, the toolbar and the phone layout.
3. Run `node tools/perf.mjs`. It prints the GPU-synchronised frame time at 1920x1080.
4. Run `node tools/flythrough.mjs`. It writes `shots/flythrough.mp4` and needs `ffmpeg` on the `PATH`.

The page supports two URL parameters. Use `?capture=1` for a fixed time step without the animation loop. Use `?grass=150000` to change the blade count.

## Results

These numbers come from an RTX 3060 with headless Chromium on ANGLE D3D11.

- The full pipeline takes about 10 ms for each frame at 1920x1080 with depth of field on.
- The live page holds 60 frames each second, which is the display limit.
- The assets total 11.2 MB, and the GLB files total 9.1 MB.

The screenshots are in `shots/`, named `<preset>-dof.png` and `<preset>-nodof.png`. The video is `shots/flythrough.mp4`.

## Known gaps

- The reference has more and rounder cream boulders, stacked on the banks. Here the boulders are flatter and fewer.
- The water has no real waterfall geometry. The two cascades are a sloped surface with foam streaks.
- The terrain grid is 0.4 m. Behind each wall, the bank rises as a smooth slope.
- The trees use one leaf atlas with four tiles. Up close, the leaf cards show as flat clusters.
- Depth of field is a screen-space gather. Thin grass in front of a bright background can show a soft halo.
