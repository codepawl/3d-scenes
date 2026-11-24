# V05 — Tide Island

A voxel island sits on a 160×160×48 grid, generated from a seeded heightmap: beach terraces, grassy hills, a
rocky peak, voxel trees and rock stacks in the shallows. The tide rises and falls. Sand the water has reached
turns dark and glossy, dries back slowly as the water pulls away, and foam collects along the swash line while
foam bands roll in toward the shore. The voxel grid is the source of truth. A hand-written face-culling mesher with
per-vertex AO builds the terrain mesh from it. A per-column simulation stepped next to the grid tracks wet height,
foam and BFS shore distance, and uploads that state as a texture each frame. The terrain shader (a patched
MeshStandardMaterial with procedural grain, grime and varying roughness) and the depth-tinted water plane both
read that texture. To run it: `cd source && npm install && npm run dev`. `npm run capture` re-renders
`render.mp4`, and `bash smoke_test.sh` checks the build and the video.
