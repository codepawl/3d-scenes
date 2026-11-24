# V02-destruction-pit

A weathered, ruined brick wall built from about 11,000 voxels takes two hits from heavy iron balls. The first punches a hole and
drops the column above it. The second brings down a big slab that topples flat onto the rubble. The voxel grid is the
source of truth. Each impact edits it: it crushes voxels into small Voronoi clusters, splits a damage ring into Voronoi
cells, and breaks bonds along radial cracks. A flood fill from the ground then finds every connected component that lost
support, and each one becomes a hand-written rigid body. The bodies have an inertia tensor, use sequential-impulse contacts with
friction, and sleep when they settle. Everything is drawn with one `InstancedMesh`. Its shader paints bricks, mortar and grime in
grid space, so the texture travels with the falling chunks. To run it: `cd source && npm install && npm run dev`. To
re-render `render.mp4`: `npm run capture`. To verify: `bash smoke_test.sh`.
