# Credits

| Source | Used for | Licence | Link |
|---|---|---|---|
| three.js 0.187.0 (incl. `OrbitControls`, `RoomEnvironment` addons) | Rendering, camera controls, environment for reflections | MIT | https://github.com/mrdoob/three.js |
| Vite 8.3.8 | Dev server / build | MIT | https://github.com/vitejs/vite |
| Playwright 1.65.1 | Headless capture | Apache-2.0 | https://github.com/microsoft/playwright |
| Dave Hoskins, "Hash without Sine" (`hash13`) | GLSL hash under the value noise in the rock, water and shaft shaders | MIT | https://www.shadertoy.com/view/4djSRW |
| Janis Elsts, "Simple Fluid Simulation With Cellular Automata" (w-shadow.com) | Idea only: mass-based compressible CA water, splitting stable mass between a cell and the one below. This 3D implementation is new code | Idea, no code copied | https://w-shadow.com/blog/2009/09/01/simple-fluid-simulation/ |
| FFmpeg / libx264 | Video encoding (external tool, not bundled) | LGPL/GPL | https://ffmpeg.org |

No textures, HDRIs or models are used. All textures and terrain are generated procedurally at runtime.

Everything else (world generation, water automaton, meshers, textures, particle systems, shaders, capture script) is original work by CodePawl, 2026.
