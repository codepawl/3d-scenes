# Credits

| What | Author | Licence | Link |
|---|---|---|---|
| three.js (renderer, WebGL2 plumbing) | three.js authors | MIT | https://github.com/mrdoob/three.js |
| Vite (dev server / bundler) | Vite contributors | MIT | https://github.com/vitejs/vite |
| Playwright (headless capture) | Microsoft | Apache-2.0 | https://github.com/microsoft/playwright |
| "Hash without Sine" (`hash12`, `hash13`) | Dave Hoskins | MIT | https://www.shadertoy.com/view/4djSRW |
| Interleaved gradient noise (ray jitter) | Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (SIGGRAPH 2014) | formula from published talk | https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare |
| ACES filmic tonemap curve fit | Krzysztof Narkowicz | formula from public blog post (CC0-style, "feel free to use") | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |
| Multiple-scattering octave approximation (technique) | Magnus Wrenninge et al., "Oz: The Great and Volumetric" (SIGGRAPH 2013 talk) | technique, re-implemented | https://dl.acm.org/doi/10.1145/2504459.2504518 |
| Energy-conserving scattering integration, Beer-powder idea (techniques) | Sébastien Hillaire (2015); Andrew Schneider, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn" (2015) | techniques, re-implemented | https://www.guerrilla-games.com/read/the-real-time-volumetric-cloudscapes-of-horizon-zero-dawn |
| Relative air mass formula | F. Kasten & A. T. Young (1989), Applied Optics 28(22) | published formula | https://doi.org/10.1364/AO.28.004735 |
| Henyey–Greenstein phase function | L. G. Henyey & J. L. Greenstein (1941) | published formula | https://doi.org/10.1086/144246 |

No textures, HDRIs, models or other assets are used: every pixel is computed by the shaders in `source/src/shaders/`.

Everything else (shader code, scene design, capture tooling) is original work by CodePawl, 2026.
