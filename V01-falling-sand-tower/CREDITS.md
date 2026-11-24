# Credits

| Source | Use | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (core, `OrbitControls`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`) | rendering, camera controls, bloom post-processing | MIT | https://github.com/mrdoob/three.js |
| Vite 8.3.8 | dev server / bundler | MIT | https://github.com/vitejs/vite |
| playwright-core 1.65.1 | headless Chrome driver for the video capture | Apache-2.0 | https://github.com/microsoft/playwright |
| FFmpeg / libx264 (external tool, not bundled) | H.264 encoding of `render.mp4` | LGPL/GPL | https://ffmpeg.org |
| Per-vertex voxel ambient occlusion technique (idea, re-implemented) | AO in the chunk mesher | public write-up | https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/ |

No textures, HDRIs, models, noise libraries or third-party shader snippets are used. Colours come from vertex
attributes and an integer hash written for this project.

Everything else (the cellular automaton, world generation, chunk mesher, shader patches, capture pipeline) is
original work by CodePawl, 2026.
