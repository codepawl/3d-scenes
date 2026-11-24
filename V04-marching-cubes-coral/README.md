# V04: Marching-Cubes Coral

A reef grows on a rocky seabed under drifting marine snow. Each colony is grown by 3D diffusion-limited aggregation
on a 128 x 96 x 128 voxel grid. Random walkers are released around a colony, drift and sink slightly, and freeze
when they touch coral, so the tips catch most of them and the colony branches. The grid is the source of truth.
Coral voxels are revealed in the order they attached. Each one splats a smooth kernel into a density field (older
voxels splat wider, so trunks are thicker than tips). Dirty 16³ chunks are re-meshed every frame by a hand-written
marching-cubes mesher with gradient normals and per-vertex ambient occlusion sampled from the field. Colour comes
from water depth: violet at the base, coral pink in the middle, orange and pale tips near the light. A procedural
shader adds polyp cups, grain, bleached wear, algal film, roughness that varies across the surface, and animated
caustics.

Run it: `cd source && npm install && npm run dev`. To re-render the video:
`npm run capture` (or `bash "$GPU_LOCK" npm run capture` on a shared GPU). Check the build and the video with
`bash smoke_test.sh`.
