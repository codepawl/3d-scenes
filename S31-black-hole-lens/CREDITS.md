# Credits

| Source | Used for | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 | WebGL2 renderer, render targets, RawShaderMaterial | MIT | https://github.com/mrdoob/three.js |
| Vite 8.3.8 | dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright 1.65.1 | headless Chrome frame capture | Apache-2.0 | https://github.com/microsoft/playwright |
| FFmpeg / libx264 (external tool, not bundled) | H.264 encoding of render.mp4 | LGPL/GPL | https://ffmpeg.org |
| `pcg3d` integer hash — M. Jarzynski & M. Olano, "Hash Functions for GPU Rendering", JCGT 9(3), 2020 | hashing in all shaders (re-typed from the paper's published algorithm) | published algorithm (paper, CC-BY-ND) | https://jcgt.org/published/0009/03/02/ |
| Dual-filter blur — M. Bjørge, "Bandwidth-Efficient Rendering", SIGGRAPH 2015 | bloom down/up-sample tap pattern (technique only, code written from scratch) | technique | https://community.arm.com/events/1155 |
| Filmic curve constants after K. Narkowicz, "ACES Filmic Tone Mapping Curve" (2016) | tonemap rational fit | blog post, constants | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |

No textures, HDRIs or models are used: the star field, galactic haze and accretion disk are all procedural.

Everything else (geodesic integrator, disk emission/Doppler model, star field, post-processing, capture pipeline)
is original work by CodePawl, 2026.
