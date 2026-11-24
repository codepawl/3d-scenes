# Credits

No third-party textures, HDRIs, models or shader files are used. Everything is procedural. The code below was
written from scratch, based on these published techniques:

| What | Source | Licence |
|---|---|---|
| `hash12/hash22/hash33` ("Hash without Sine" constants) | Dave Hoskins, https://www.shadertoy.com/view/4djSRW | MIT |
| Value noise with analytic derivatives, derivative-damped fbm | Inigo Quilez, https://iquilezles.org/articles/morenoise/ | technique (article); MIT for the reference code |
| Voronoi border distance (F1 cell, then edge pass) | Inigo Quilez, https://iquilezles.org/articles/voronoilines/ | technique (article); MIT for the reference code |
| ACES filmic tone-mapping curve fit | Krzysztof Narkowicz, https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ | public formula |
| Interleaved gradient noise (march jitter) | Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014 | public formula |
| three.js 0.187.0 | https://github.com/mrdoob/three.js | MIT |
| Vite 8.3.8 | https://github.com/vitejs/vite | MIT |
| Playwright 1.65.1 (capture only) | https://github.com/microsoft/playwright | Apache-2.0 |

Everything else (the aurora model, scene layout, terrain, ice shading, camera, capture pipeline) is original work
by CodePawl, 2026.
