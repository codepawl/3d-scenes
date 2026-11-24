# Credits

| Source | Use | Licence | Link |
| --- | --- | --- | --- |
| three.js 0.187.0 (incl. `OrbitControls`, `RoomEnvironment` addons) | rendering, camera controls, env lighting | MIT | https://github.com/mrdoob/three.js |
| Vite | dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright (playwright-core) | headless capture driver | Apache-2.0 | https://github.com/microsoft/playwright |
| FFmpeg / libx264 (external tool, not bundled) | video encoding | LGPL/GPL | https://ffmpeg.org |

Techniques referenced (my own implementations, no code copied):
- Bump mapping from screen-space height derivatives: M. Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU" (2010).
- xorshift32 PRNG: G. Marsaglia, "Xorshift RNGs" (2003).
- The `fract(sin(dot(...)))` lattice hash is a widely used public-domain idiom.

No external textures, HDRIs, models or shader snippets are used. All surfaces are procedural.

Everything else (voxel fracture, flood fill, rigid-body solver, shaders, dust, capture pipeline) is original work
by CodePawl, 2026.
