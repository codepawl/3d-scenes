# V16 Layer Printer (three.js, voxels)

## Run
```
npm install
npm run dev        # opens http://localhost:5173
npm run build      # static build in dist/
npm run capture    # writes ../render.mp4 (6 s, 1280x720, 30 fps); needs Chrome + ffmpeg on PATH
```
On a shared GPU machine: `bash "$GPU_LOCK" npm run capture`.

## What it shows
A Cartesian FDM printer prints a castle tower in time-compressed playback (about 4.2 s for 44 layers). After the last layer the head parks, and the part peels off the PEI bed and lifts. The loop restarts every 7.6 s.

- `src/grid.js`: the voxel grid (source of truth), the procedural target shape, the slicer (perimeters plus a serpentine raster of solid or diagonal sparse infill), and deposition scheduling with an ease-in time compression.
- `src/mesher.js`: a face-culling mesher with per-vertex AO, chunked in 4-layer slabs so only dirty slabs are remeshed. Also the PLA shader: per-voxel tint, extrusion grooves faded with `fwidth` to avoid moiré, dust, varying roughness, and a cooling glow on fresh deposits.
- `src/textures.js`: procedural canvas textures (PEI sheet, brushed aluminium, worn bench, plastic grain) with matching roughness maps.
- `src/printer.js`: the frame, bed, gantry and hot end.
- `?capture=1`: time comes from the frame counter (n/30 s), and `window.renderFrame(n)` draws frame n deterministically. The simulation uses fixed 1/240 s substeps.

## Controls
Drag to orbit, wheel to zoom. **C** returns to the cinematic camera, **Space** pauses, **R** restarts.

## Licence
MIT.
