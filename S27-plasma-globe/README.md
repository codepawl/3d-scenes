# S27 — Plasma Globe

A glass plasma globe glows in a dark studio: noise-driven violet filaments crawl from the core electrode to the glass,
and a fingertip orbits the globe; when it touches the glass, most filaments swing across and gather into one hot
bundle at the contact point, then scatter again as it lifts away. The look comes entirely from hand-written GLSL in
three.js ShaderMaterials: the filaments are camera-facing ribbons whose full path is built in the vertex shader from
layered simplex noise around an endpoint that JS slerps toward the finger. The glass combines Fresnel studio
reflections, an analytic chord-length gas haze and contact glow spots, and a custom HDR bloom + ACES + dither pass
finishes the image. Run it with `cd source && npm install && npm run dev`; `npm run capture` re-renders `render.mp4`.
