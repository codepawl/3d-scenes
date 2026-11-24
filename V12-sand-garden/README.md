# V12-sand-garden

A low-sun Zen garden built entirely from voxels: a voxel rake drags across a leveled strip of granite sand,
cutting grooves row by row next to older patterns (rings around the moss-islanded rocks, straight lines
elsewhere), while the rocks throw long soft shadows over the ridges. The source of truth is an integer height grid
with a material per cell. The rake simulation stamps a tine profile into it each sub-step, so grooves persist, and
only the dirty 32x32 chunks are re-meshed by a hand-written column mesher with per-corner AO. Rocks, walls, trees and
the rake are dense 3D voxel volumes meshed by a face-culling mesher. Everything renders with three.js (WebGL2):
a directional sun with PCF shadows, procedural per-voxel colour and wear, and sub-voxel grain and roughness noise in
the shader. To run it: `cd source && npm install && npm run dev`. `render.mp4` was captured with
`npm run capture` (`?capture=1` mode, headless Chrome, ffmpeg). `bash smoke_test.sh` builds the project and checks
the video.
