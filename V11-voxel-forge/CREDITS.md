# Credits

| Source | Use | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (core, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, RoomEnvironment) | rendering, post-processing | MIT | https://github.com/mrdoob/three.js |
| Vite | dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright | headless capture | Apache-2.0 | https://github.com/microsoft/playwright |
| mulberry32 PRNG (Tommy Ettinger), public-domain idiom | deterministic randomness in `heat.js` | Public domain | https://gist.github.com/tommyettinger/46a874533244883189143505d203312c |
| Voxel ambient-occlusion rule (side/side/corner) after Mikola Lysenko, "Ambient occlusion for Minecraft-like worlds" | technique reference for the mesher (code written from scratch) | — (article) | https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/ |
| Value noise / fBm (classic technique, my own implementation) | surface tints in `world.js` | original code | — |
| `fract(sin(dot(...)) * 43758.5453)` hash | dither noise in the final pass | widely used idiom, public domain | — |
| FFmpeg / libx264 | video encoding (tool, not shipped) | LGPL/GPL | https://ffmpeg.org |

No textures, HDRIs, models or audio from third parties are used.

Everything else — the voxel scene, mesher, billet heat/deformation simulation, spark system, incandescence ramp,
animation and capture pipeline — is original work by CodePawl, 2026.
