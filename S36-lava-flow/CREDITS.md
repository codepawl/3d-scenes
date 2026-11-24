# Credits

Third-party code and techniques used in `S36-lava-flow`:

| What | Where used | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (renderer, ShaderMaterial, OrbitControls) | whole project | MIT | https://github.com/mrdoob/three.js |
| Vite 8.3.8 (dev server / build) | tooling | MIT | https://github.com/vitejs/vite |
| Playwright 1.65.1 (headless capture) | `source/scripts/capture.mjs` | Apache-2.0 | https://github.com/microsoft/playwright |
| 2D simplex noise, Ashima Arts / Stefan Gustavson (`webgl-noise`) | `source/src/shaders/common.js` | MIT | https://github.com/ashima/webgl-noise |
| "Hash without Sine", Dave Hoskins | `source/src/shaders/common.js` | MIT | https://www.shadertoy.com/view/4djSRW |
| Voronoi border-distance technique, Inigo Quilez ("Voronoi - distances"), reimplemented | `source/src/shaders/common.js` | MIT | https://www.shadertoy.com/view/ldl3W8 · https://iquilezles.org/articles/voronoilines/ |
| 13-tap downsample / tent upsample bloom, Jorge Jimenez (SIGGRAPH 2014), technique reimplemented | `source/src/shaders/post.js` | technique (presentation) | https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare |
| ACES filmic curve fit, Krzysztof Narkowicz | `source/src/shaders/post.js` | public blog formula | https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/ |
| GGX / Smith microfacet specular (Walter et al. 2007) | `source/src/shaders/terrain.js` | published technique | https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf |
| FFmpeg / libx264 (encoding only, not bundled) | capture | LGPL / GPL | https://ffmpeg.org |

No textures, HDRIs, models or other assets are used. Every surface is procedural GLSL.

Everything else is original work by CodePawl, 2026: scene design, height field, lava crust, crack
and toe model, temperature ramp, basalt material, sky, heat shimmer and the capture pipeline.
