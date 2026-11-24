# Credits

| Source | Use | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (incl. OrbitControls, PMREMGenerator, tone-mapping/colour-space shader chunks) | rendering | MIT | https://github.com/mrdoob/three.js |
| Vite 8.3.8 | dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright 1.65.1 | headless capture of render.mp4 | Apache-2.0 | https://github.com/microsoft/playwright |
| FFmpeg / libx264 (external tool, not bundled) | video encoding | LGPL/GPL | https://ffmpeg.org |
| mulberry32 PRNG (public-domain snippet by Tommy Ettinger) | seeded generation | Public domain | https://gist.github.com/tommyettinger/46a874533244883189143505d203312c |
| "Hash without Sine" style fract hashes (adapted, Dave Hoskins) | GLSL hash functions | MIT | https://www.shadertoy.com/view/4djSRW |

No textures, HDRIs or models are used. Every surface is procedural.

Everything else (voxel generator, mesher, tide simulation, terrain and water shaders, capture pipeline) is
original work by CodePawl, 2026.
