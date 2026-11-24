# Roach Glow (plan, 2026-10-29)

An's ask: 3D model + animation of insects in a gradient-glow ASCII/dither look. Start with one cockroach (close-up,
top-down, side), then walking, flying, then a swarm. Cut it into a video, post on X with a caption.

## Direction check (DIRECTION.md)

- The main feed is locked to playable system explainers in the Waferline look. A new look ships as its own season
  (2+ weeks, one look), told to An first. This series is that season, unless An says otherwise.
- The "model is never ASCII" showcase rule is for asset showcases. Here the ASCII body is the art, so it does not
  apply; one 1 s raw-render flash (the ascii-depths `T` toggle) proves it is real 3D underneath.
- One post, one thesis: "At top speed a cockroach stops being a six-legged animal." Checked 2026-10-29 in Full & Tu
  1991 (J Exp Biol 156:215, Periplaneta americana): alternating tripod from 0.44 to 1.0 m/s; at 1.0-1.5 m/s
  (about 50 body lengths/s) it switches to four- and then two-legged running, body pitched up, with aerial phases
  above about 1 m/s. Delcomyn: tripod at every speed above 5 cm/s. Wingbeat about 25-30 Hz (older physiology work,
  27 Hz in a locomotion paper). Mass 0.83 g. Body length is implied (1.5 m/s / 50 = 30 mm), not measured there.

## Look

- Reuse the ascii-depths post pass (`demos/ascii-depths/web/src`): brightness → glyph ramp, edge glyphs from depth
  and normals, mono font atlas.
- Add: glyph colour from a gradient map (depth or rim light → e.g. deep violet → magenta → amber), bloom on glyphs
  only, black ground, optional 2 px Bayer dither on the background haze. No other colours.
- Style frame first: one still of the close-up head, OK'd by An before any animation.

## Status (2026-10-29)

- Model chosen: "Asian Cockroach" by peternak3d (Sketchfab 5b837eb6, CC BY 4.0, via Objaverse), at
  `web/models/roach.glb`. Separate meshes for head, body, 6 legs, 2 antennae, 4 wing parts; no rig. Rejected: the
  extracrispi photogrammetry scan (dead pinned pose, curled legs), the rest lower quality.
- Style frame: `web/src/glow-ascii.js`, stills in `shots/style/` (`closeup-AB.png`, `sheet5.png`). Variant A colours
  by light only (`?sweep=0`), B adds a diagonal sweep (`?sweep=0.8`).
- **Locked: B** (An, 2026-10-29: "Lock B"). Sweep 0.8 is the season default; every shot and insect uses it.
- Rig: `web/models/roach-rigged.glb` (53 bones, notes in `notes/rig.md`, script `tools/rig_roach.py`).
- Idle: `web/src/idle.js` on `web/src/rig.js`; preview `shots/idle/idle-preview.mp4` (close-up is now a low 3/4
  profile; a front close-up put the lens inside the antennae's sweep). Walk/sprint drafted in `web/src/walk.js`,
  not wired or checked yet; it must move onto the joint springs too.
- Motion v2 (An, 2026-10-29: "its a little rigid, make it more insect movement, feel the physics in every
  joints"): `web/src/physics.js` springs per joint, idle darts and holds. Check curves with
  `node tools/plot_joints.mjs <out.png> 8`. Clips: `node tools/clip.mjs <out.mp4> <shot> <start> <seconds>` with the server up.
- Run: `node tools/serve.mjs` (port 5470, launch config `roach-glow`), stills with `node tools/shoot.mjs <out> closeup top`.
- Swarm (2026-10-29): `?plan=swarm&shot=swarm-top|swarm-low`, 8000 roaches (`&n=` to change), one instanced draw.
  `tools/decimate_swarm.py` makes `web/models/roach-swarm.glb` (1,386 triangles, same 53 bones); `swarm-bake.js` bakes walk and sprint
  vertex animations from RoachMotion into float textures; `swarm-sim.js` flocks on a grid, `swarm-beam.js` scripts the flashlight.
  Scatter log: `node tools/dump_swarm_events.mjs notes/swarm-events.json`. Clips: `PLAN=swarm node tools/clip.mjs shots/swarm/swarm-top.mp4 swarm-top 0 10`.

- Film draft 1 (2026-10-30): `film/roach-film.mp4` (55 s, captions burned, SFX + music). Cuts in `tools/cuts.mjs`;
  `node tools/film.mjs` renders missing clips and joins them; `node tools/sound_events.mjs` builds `sound/events.json`
  from the motion logs; `tools/place_foley.py` places fixed recordings per action (the library search picked wrong
  sounds); `sound/mix.json` mixes with "SCP-x2x" (Kevin MacLeod, CC BY, credit in `sound/CREDITS.txt`).
  New scenes: `?plan=squeeze&shot=squeeze-side`, `?plan=headless&shot=headless`, `?plan=radiation&shot=radiation|radiation-beetle`,
  `?shot=specimen`. Draft 2 (An: "after the swarm theres still missing something"): the light clicks off, 1 s of
  black with the swarm still heard, then `?plan=approach&shot=approach` (one roach walks up to the lens) and the
  closing line "still my worst enemy"; music stops at the light-off. 62 s. Caption draft: `post/caption.txt`. Not posted, not in 3d-builds yet.

## Model

- Source: a free cockroach model (Objaverse Sketchfab mirror via `minus-zero/tools`, Sketchfab CC0/CC BY, Smithsonian
  3D). Skip NC. Credit line in SOURCES.md.
- Blender by script: clean up, separate the 6 legs (coxa/femur/tibia/tarsus), antennae, tegmina (forewings) and
  hindwings so three.js can drive them. Scale to ~35 mm body.

## Animation (procedural in three.js, not baked)

- Idle (An, 2026-10-29: "dont forget the idle animation"): slow antenna sweeps out of phase, maxillary palps
  twitching, abdomen pumping (breathing), small weight shifts on single legs, and now and then the grooming move:
  a foreleg bends an antenna down and the mouthparts pull it through, base to tip. Seeded randomness so it never
  loops visibly. The close-up and specimen shots use it.
- Walk: alternating tripod (L1 R2 L3 vs R1 L2 R3), leg IK to the ground, body sway, antennae sweep. Slow-mo pass with
  the two tripods in two gradient ends so the gait is readable.
- Sprint: speed ramps up, the front of the body pitches up, front legs leave the ground (4 legs, then 2), short
  aerial phases. This is the peak of the walking beat.
- Fly: tegmina lift, hindwings unfold, wingbeat blur as glyph streaks, takeoff arc.
- Swarm: InstancedMesh, 5k-20k roaches, boids + flee from light (they are negatively phototactic). The cursor is a
  flashlight: they scatter from it. LOD: far roaches use a cheap gait.

## Film: "my worst lifetime enemy" (~55 s, 1080x1350)

An, 2026-10-29: "make a video story about the most resilient insects in the worlds", on top of the caption hook
"creating my worst lifetime enemy in 3D ascii". Story: why the cockroach is so hard to get rid of, one ability per
beat, each shown by the model doing it, ending on the swarm. Honest ending beat: the nuclear-proof legend is busted.
On-screen text is one short line per beat, set in the ASCII font, typed on with key SFX.

1. 0-4 s   Cold open, idle close-up: antennae sweep, palps tap. Line: "my worst lifetime enemy".
2. 4-9 s   Specimen views, top then side. Line: "its relatives were running 320 million years ago".
3. 9-18 s  Front walk into the sprint, rearing up onto two legs. Line: "1.5 m/s. about 50 body lengths a second".
4. 18-25 s Takeoff and flight (wings as membranes). Line: "and yes, it flies".
5. 25-32 s Squeeze: it flattens under a slab into a 3 mm gap and keeps running. Line: "fits through 3 mm.
           takes 900x its weight without injury". New scene (plan `squeeze`): body bones compress 40-60%, legs splay.
6. 32-38 s Headless: the head's glyphs dissolve, the body keeps standing and grooming. Line: "no head? it can live
           for weeks". Stylised, no gore.
7. 38-44 s Radiation: a glow pulse over the idle roach, then a flour beetle silhouette. Line: "nuclear-proof? no.
           a flour beetle beat it".
8. 44-55 s Pull back to the swarm, flashlight sweeps, they scatter. Line: "and there's never just one".

Facts and their sources (all in SOURCES.md):
- 320 million years: earliest roachoid fossils, Carboniferous (stem relatives, not modern roaches; say "relatives").
- 1.5 m/s, about 50 body lengths/s, two-legged at top speed: Full & Tu 1991, as quoted by citing pages.
- 3 mm crevice (a quarter of a 12.5 mm standing height), body compressed 40-60%, 300x body weight in the gap and
  up to nearly 900x without injury, 20 body lengths/s in confined spaces: Jayaram & Full 2016, PNAS 113:E950,
  read at PMC4776529.
- Headless for weeks; breathing not run by the brain; necks clot; dies of infection or predators: Scientific
  American, "Fact or Fiction?: A Cockroach Can Live without Its Head", 2007-03-15 (Kunkel, UMass Amherst; Tipping).
- Radiation: MythBusters episode 97 (2008-01-30) exposed German cockroaches to 1,000 / 10,000 / 100,000 rads and
  watched 30 days; the verdict was busted, flour beetles were the only insects to survive the top dose (Wikipedia,
  2008 season page). No survival percentages verified, so the film states none. 450 rads may kill half of exposed
  humans (secondary).
- Not used (unverified): "holds its breath 40 minutes".

- Sound (An, 2026-10-29: "make sure creating sfx plus music for this video, sfx is the most important when its
  corresponding to the cockroach's actions"): SFX first, every cue on the frame of the action that makes it, from
  the motion controller's event log (footfalls per leg and speed, leg taps, antenna flicks, palp taps, grooming
  scrubs, wing open, takeoff, wingbeat, swarm density). Real recordings layered per the action-mode sound rules,
  found and checked with the design-sound skill. Music under it, low, never masking the SFX.
- Also ship the swarm as a live page (flashlight toy) and record a real 15-20 s interaction for a follow-up post.

## Post

- Caption hook is An's (2026-10-29): "creating my worst lifetime enemy in 3D ASCII", because the cockroach is An's
  worst enemy. Lead with that personal line; the gait facts below become the second sentence or the first reply.
- Earlier science-led draft (finish with write-clear-prose, check numbers first):
  "A cockroach walks on three legs at a time. At 1.5 m/s, about 50 body lengths a second, it rears up and runs on
  two. Built one in three.js and rendered every frame as ASCII: idle close-up, the gait slowed down, the sprint,
  flight, then 10,000 of them running from a flashlight."
- Reply under it: how it was built (model source, Blender rig, ASCII pass) + link to the live swarm page. No link in
  the caption.
- Time: pick from audience hours (schedule-by-audience-hours), around 16-19 UTC.

## Series after this

Firefly (natural glow), dragonfly (four-wing flight), mantis (strike in slow-mo), ant colony (a running system,
the bridge back to the main feed's promise), bee hive.

## Order of work

1. Research numbers + fetch model (half day).
2. Style frame, An's OK.
3. Rig + walk + fly.
4. Swarm + live page.
5. Film shots, sound, render, self-review frames.
6. Caption, post, reply chain.
