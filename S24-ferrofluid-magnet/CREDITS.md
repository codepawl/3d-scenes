# Credits

| Source | Used for | Licence | Link |
| --- | --- | --- | --- |
| three.js | WebGL2 renderer, fullscreen quad | MIT | https://github.com/mrdoob/three.js |
| Vite | dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright (playwright-core) | headless capture driver | Apache-2.0 | https://github.com/microsoft/playwright |
| Inigo Quilez — exact cone SDF, polynomial smooth-min, SDF soft shadows / AO techniques | `sdCone`, `smin`, `softShadow`, `calcAO`, tetrahedral normal | MIT (snippets as published) | https://iquilezles.org/articles/distfunctions/ , https://iquilezles.org/articles/smin/ |
| Hexagonal grid nearest-centre trick (two offset rectangular grids), as popularised on Shadertoy | `hexCenter` | public technique | https://www.redblobgames.com/grids/hexagons/ |
| Dave Hoskins — "Hash without Sine" | `hash12` | MIT | https://www.shadertoy.com/view/4djSRW |
| Krzysztof Narkowicz — ACES filmic tone-mapping curve fit | `aces` | public (blog, CC0-style) | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |

No textures, HDRIs or models are used; the studio environment is procedural.

Everything else (scene design, field model, spike lattice, shading, capture pipeline) is original work by
CodePawl, 2026.
