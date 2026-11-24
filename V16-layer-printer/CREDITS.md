# Credits

- **three.js** 0.187.0 (MIT): https://github.com/mrdoob/three.js. Includes the `OrbitControls` and `RoomEnvironment` addons that ship with it.
- **Vite** (MIT): https://github.com/vitejs/vite
- **playwright-core** (Apache-2.0): https://github.com/microsoft/playwright. Used only by the capture script.
- **FFmpeg / libx264** (LGPL/GPL): https://ffmpeg.org. External tool, only used to encode the video.
- The shader hash `h13` follows the widely used "hash without sine" pattern by Dave Hoskins (MIT): https://www.shadertoy.com/view/4djSRW
- The per-vertex voxel AO rule follows Mikola Lysenko's write-up "Ambient occlusion for Minecraft-like worlds" (0fps.net, 2013): https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/. Description only, no code copied.

No textures, HDRIs or models are downloaded. All textures are generated procedurally at startup.

Everything else (the voxel shape and slicer, the mesher, the shaders, the procedural textures, the printer model and the capture pipeline) is original work by CodePawl, 2026.
