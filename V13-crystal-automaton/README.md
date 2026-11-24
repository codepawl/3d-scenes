# V13 — Crystal Automaton

A voxel crystal grows from a small mirror-symmetric seed under a 3D cellular automaton (Moore neighbourhood,
survival 4–5, birth 5). Cells that fail survival freeze into inert crystal instead of dying, so the structure keeps
growing outward. A wedge is cut away so you can see the age rings inside: ice-cyan at the living, glowing frontier,
cooling through cobalt and violet to plum at the core. The grid is the source of truth. A 128³ `Uint8Array` is
stepped incrementally (only neighbours of new births are candidates). For each voxel it records the generations
when it was born, froze and was buried, and a single instanced cube draw renders straight from those, with a
patched `MeshStandardMaterial` handling grow-in, age colour and burial culling. A spotlit plinth under a dark gradient
dome frames the crystal; MSAA, a very faint bloom and a dither pass finish it. Run it with `cd source && npm install && npm run dev`. To re-capture the video, run
`cd capture && npm install && cd .. && node capture/capture.mjs` (wrap it in `bash "$GPU_LOCK"` if that is set).
`bash smoke_test.sh` builds the project and checks `render.mp4`.
