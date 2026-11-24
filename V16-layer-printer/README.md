# V16 — Layer Printer

A desktop FDM printer builds a voxel castle tower layer by layer in time-compressed playback, then the finished part peels off the textured PEI bed and rises. The voxel grid (36×44×36 cells) is the source of truth: a small slicer turns the target shape into a per-layer toolpath (outer perimeter, inner perimeter, serpentine solid/sparse infill), a time-compressed clock walks that toolpath and flips cells from *planned* to *printed*, and a hand-written face-culling mesher with per-vertex ambient occlusion rebuilds only the 4-layer slabs that changed. The print head follows the toolpath through a critically damped spring; fresh deposits glow and cool in the shader, and PLA, bed, aluminium and bench surfaces get procedural grain, layer-line grooves, scratches and grime.

Run it: `cd source && npm install && npm run dev`. Capture the video with `npm run capture` (needs Chrome and ffmpeg). Check the deliverables with `bash smoke_test.sh`.
