# Credits

Third-party code and sources used in S29-frost-orb:

| What | Where used | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (renderer, camera, OrbitControls, render targets) | whole project | MIT | https://github.com/mrdoob/three.js |
| Vite 8 (dev server / bundler) | build tooling | MIT | https://github.com/vitejs/vite |
| Playwright (headless Chrome driver for frame capture) | `source/scripts/` | Apache-2.0 | https://github.com/microsoft/playwright |
| "Hash without Sine" — `hash13`, `hash33`, `h12` by Dave Hoskins | `trace.frag.glsl`, `display.frag.glsl` | MIT | https://www.shadertoy.com/view/4djSRW |
| ACES filmic tone-mapping curve fit by Krzysztof Narkowicz | `display.frag.glsl` | public domain (blog snippet, free to use) | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |
| PCG integer hash (Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020) | per-pixel RNG in `trace.frag.glsl` | algorithm from published paper (CC BY-ND article), reimplemented | https://jcgt.org/published/0009/03/02/ |
| FFmpeg / libx264 (video encode, not distributed) | capture step | LGPL/GPL | https://ffmpeg.org |

No textures, HDRIs, models or sounds are used: the environment, table, glass wear and frost are all procedural.

Everything else — the glass sphere tracer, rough transmission sampling, analytic environment blur, the frost
growth field (nucleation, fern and hex-star dendrites, rime), wood/wear patterns, caustic approximation and the
capture pipeline — is original work by CodePawl, 2026.
