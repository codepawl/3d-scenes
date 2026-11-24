# V20 — Paint Drip Wall

Three pairs of paint streams pour onto the coping of a weathered voxel brick wall and sweep towards each other. The
paint runs down the face in wandering drips, and where the drips meet their colours blend cleanly: blue + yellow →
green, yellow + magenta → orange, magenta + blue → violet. They run over the faded drips of older pours. The source of truth is a 260×112 grid of cells on
the wall's front face. Each cell holds wet paint mass, pigment stored as absorbance (−ln reflectance) and a porous
holding capacity. A gravity cellular automaton moves the mass that exceeds capacity into one of the three cells below,
biased towards wetter cells so rivulets merge. Mixing is mass-weighted in absorbance space, a subtractive-looking
mix. The grid is drawn with instanced voxels: one box per wall cell (brick and mortar relief, eroded cells, rain
streaks, salt bloom) and one per painted cell (thickness quantised to 1/8 voxel, wet paint glossy, dry paint matte). Every surface variation is texel-matched to the grid, one texel per voxel,
so wall and paint share one scale. Running paint gets a clearcoat gloss that fades as it settles.

Run it: `cd source && npm install && npm run dev`. To re-render the video: `npm run build && node capture.mjs`
(prefix it with `bash "$GPU_LOCK"` on a shared GPU machine). To check everything: `bash smoke_test.sh`.
