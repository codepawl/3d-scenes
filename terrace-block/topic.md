# Terrace block

An isometric block of a mountainside of rice terraces (in the style of Mù Cang Chải, Yên Bái) floating on black.
The viewer drags to tilt the block. Water runs from the top paddy over notches in the bunds, terrace by terrace,
sloshes to the low side when tilted and spills off the block's edges as streams and spray.
Reference for the shape of the post: @chetanankola's basalt island block (2026-10-26), a block tilted live in
Blender with water pouring off its edges. Ours is an original subject and an interactive three.js page, not a copy.

## The real thing (inferred from general sources unless marked)

- Hmong and Thái terraces cut into slopes at about 1,000 to 1,200 m, built over generations (often said 300+ years).
- Each paddy is a flat, curved shelf following the contour. Riser 1 to 2 m, shelf 2 to 10 m wide.
- A bund (earth ridge) about 30 cm high and 30 to 40 cm wide holds 5 to 10 cm of water in each paddy.
- Water comes from a forest stream at the top, led by a small channel or bamboo pipe into the top paddy. Each bund has
  a low notch; when a paddy fills, water pours through the notch into the paddy below. Farmers open and close notches.
- Seasons: "mùa nước đổ" (May to June, flooded mirror paddies reflecting the sky), green rice (July to August), golden
  rice (late September to early October, harvest).
- Around them: stilt or ground houses of wood with thatched or wooden roofs, a forest cap on the summit, a stream, a
  water buffalo, small haystacks after harvest, morning cloud sitting in the valley.

## What the viewer can do

1. Drag to tilt the block (up to about 25 degrees, springs back on release). Water in every paddy sloshes to the low
   side, overflows the low bund or notch and cascades down; at the block edge it falls off as streams and spray.
2. Season switch: water pouring (mirror), green, golden. The rice height and colour change; in water season the paddies
   are mirrors of the sky.
3. Open or close the top channel: water flows in from the stream and fills paddies one by one from the top.
4. Orbit and zoom. A close look must stay sharp (bunds, rice rows, ripples), since viewers asked for a close-up tour on
   the reference post.

## Water model

Each paddy is a basin with a water level. Flow out through each bund notch and over the bund crest follows the paddy's
water height above the lip under the current tilt (gravity projected on the block). Overflow at a block edge emits
particles (stream plus spray). Water surface is a mesh per paddy, tilted level with gravity, with ripples and reflection.
Every frame is a function of a fixed-step simulation clock so the film renders the same each time.

## Look

Photoreal miniature on black like the reference: soft key light from the upper left, a warm rim, ambient occlusion,
depth of field only in the film. The block's cut sides show soil layers, rock and roots. Materials: wet mud, grass
bunds, rice clumps (instanced), clear water with a sky reflection, wood and thatch.

## Film (about 20 s, 16:9, for X)

1. 0-3 s: slow orbit of the still block in golden season, cloud in the valley.
2. 3-7 s: switch to water season, the top channel opens, water fills paddy after paddy down the slope.
3. 7-13 s: a hand-feel tilt left then right; the water sloshes and pours off the edges as falls and spray.
4. 13-17 s: close pass along one terrace: bund notch pouring, rice rows, ripples, buffalo.
5. 17-20 s: settle back level, green season, pull out to the whole block.

Sound: real CC0 recordings only: trickling and pouring water, small cascades, birds, a buffalo bell, wind. One sound
per action, no chimes or "magic" stingers.
