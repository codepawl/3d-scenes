# Credits

| Source | Used for | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (core, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass) | rendering, post-processing | MIT | https://github.com/mrdoob/three.js |
| Vite | dev server / bundler | MIT | https://github.com/vitejs/vite |
| Playwright (playwright-core) | headless capture driver (dev only) | Apache-2.0 | https://github.com/microsoft/playwright |
| FFmpeg / libx264 | video encoding (external tool, not bundled) | LGPL/GPL | https://ffmpeg.org |
| Mikola Lysenko, "Meshing in a Minecraft Game" and "Ambient occlusion for Minecraft-like worlds" (0fps.net) | greedy meshing algorithm, per-vertex voxel AO, quad diagonal flip. The ideas come from these articles; the code here is my own reimplementation | article (no code copied) | https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/ , https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/ |
| Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020): pcg3d | per-window integer hash in the fragment shader | paper (algorithm published openly) | https://jcgt.org/published/0009/03/02/ |
| mulberry32 PRNG (Tommy Ettinger) | seeded city generation | public domain | https://gist.github.com/tommyettinger/46a874533244883189143505d203312c |

No textures, HDRIs or models are used. Everything is procedural.

Everything else (city generator, mesher, materials, sky shader, capture pipeline) is original work by CodePawl, 2026.
