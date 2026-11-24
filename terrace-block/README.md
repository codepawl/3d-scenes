# Terrace block

Interactive three.js page: a Mu Cang Chai style rice-terrace hillside as a block on black. Spec in `topic.md`.

## Run

    node tools/serve.mjs 5440      # serves web/ on http://127.0.0.1:5440/  (stop it with Ctrl+C)

Drag: tilt (springs back, max 25 degrees). Right-drag, or Shift/Ctrl/Alt-drag: orbit. Wheel: zoom.
Dock (bottom): season Mirror / Green / Golden, and the top channel open / closed.

No build step: three r186 is pinned in `web/vendor/`.

## Files

- `web/src/terrainField.js` hillside, terrace bands, bunds, notches, stream path, layout of houses and stacks
- `web/src/basins.js` per-paddy basins and spill lips derived from the field
- `web/src/waterSim.js` fixed-step basin / weir / slosh model and particles
- `web/src/terrainMesh.js` splatted terrain, soil-layer cut sides, roots, stones
- `web/src/waterMesh.js` paddy surfaces, cascades, stream, particles
- `web/src/vegetation.js` rice rows, grass tufts (its old blob-canopy forest is no longer used)
- `web/src/forest.js` instanced Poly Haven trees and shrubs, the water buffalo (cow rig plus crescent horns)
- `web/src/post.js` HDRI environment, water-free pass for screen-space reflections, GTAO, ACES, grade
- `web/src/props.js` houses, buffalo, haystacks, gate
- `web/src/main.js` scene, lights, controls, dock, renderAt
- `notes/review-1..4.md`, `shots/r1..r9` (final set: `shots/r9`)
- `tools/probe.mjs` prints water volumes, flowing lips and live particles for the tilt shot

## Credits

- Textures (CC0, Poly Haven, 2k): brown_mud_03, red_laterite_soil_stones, rocks_ground_02, leafy_grass,
  forest_ground_04, weathered_planks, thatch_roof_angled (https://polyhaven.com/a/<name>).
- HDRI (CC0, Poly Haven, 2k): kloofendal_48d_partly_cloudy_puresky (lighting and reflection).
- Trees and shrub (CC0, Poly Haven): jacaranda_tree, island_tree_02, shrub_02. Decimated in Blender (wood to about
  15-40k triangles, leaf geometry thinned into larger leaf patches, textures 1k) so each GLB is under 10 MB in
  `web/models/`; the Blender script is not kept in the repo (steps in `notes/review-4.md`).
- Water buffalo: "Cow" by Quaternius (CC0, https://poly.pizza/m/26zM1outCr), recoloured dark grey, original horns
  hidden and swept-back crescent horns added in code.
- three.js r186 pinned in `web/vendor/`; the postprocessing, loaders and shader add-ons beside it were copied from
  three 0.180 (`GTAOPass`, `EffectComposer`, `GLTFLoader`, `RGBELoader`).
About 100 MB in `web/` (textures, HDRI, models). Raw download folders: `_dl_raw/`, `_dl_buffalo/` (can be deleted).
Houses, haystacks, rice, grass and the stream are built in code.

