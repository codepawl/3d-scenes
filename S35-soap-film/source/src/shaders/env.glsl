// ---- analytic environment: dim room, big window behind the camera, warm lamp, bokeh on back wall ----
// blur in [0,1]: 0 = sharp mirror lookup, 1 = roughly irradiance
uniform float uTime;

vec3 windowLight(vec3 d, float blur) {
  vec3 wc = normalize(vec3(-0.12, 0.02, 1.0));
  vec3 wr = normalize(cross(vec3(0, 1, 0), wc));
  vec3 wu = cross(wc, wr);
  float c = dot(d, wc);
  if (c <= 0.05) return vec3(0.0);
  vec2 uv = vec2(dot(d, wr), dot(d, wu)) / c;
  // large, soft-edged opening (no glazing bars: they read as dark lines across the film)
  float w = 0.25 + blur * 0.9;
  vec2 hs = vec2(2.0, 1.45);
  vec2 e = smoothstep(hs + w, hs - w, abs(uv));
  float inside = e.x * e.y;
  // outside: bright overcast sky on top, sunlit garden on the bottom, soft horizon
  float detail = 1.0 - smoothstep(0.0, 0.3, blur);
  float hz = 0.1 + 0.1 * (fbm2(vec2(uv.x * 2.0, 1.0)) - 0.5);
  float sky = smoothstep(hz - 0.25 - w * 0.5, hz + 0.25 + w * 0.5, uv.y);
  vec3 skyCol = mix(vec3(2.3, 2.55, 2.95), vec3(3.3, 3.4, 3.55), smoothstep(0.0, 1.0, uv.y));
  float leaves = fbm2(uv * vec2(3.0, 5.0) + vec2(0.0, uTime * 0.03));
  vec3 folCol = mix(vec3(0.55, 0.75, 0.40), vec3(1.25, 1.45, 0.85), leaves * detail + 0.5 * (1.0 - detail));
  vec3 col = mix(folCol, skyCol, sky);
  // overcast window: brightest in the middle, falling off toward the reveal
  col *= 0.12 + 0.88 * exp(-dot(uv * vec2(0.8, 1.0), uv * vec2(0.8, 1.0)) * 1.1);
  return col * inside * 1.9;
}

vec3 envColor(vec3 d, float blur) {
  d = normalize(d);
  // room shell: warm dark plaster, lighter toward ceiling, darker floor
  float up = d.y;
  vec3 room = mix(vec3(0.032, 0.026, 0.021), vec3(0.075, 0.066, 0.056), smoothstep(-0.2, 0.8, up));
  room = mix(vec3(0.010, 0.008, 0.007), room, smoothstep(-0.45, -0.05, up));
  // plaster mottling and grime (fades with blur)
  float m = fbm3(d * 6.0) * 0.6 + fbm3(d * 23.0) * 0.4;
  room *= mix(1.0, 0.65 + 0.7 * m, 1.0 - blur * 0.8);
  // light spill from the window onto the room
  room += vec3(0.05, 0.055, 0.06) * pow(max(dot(d, normalize(vec3(0.2, 0.1, 1.0))), 0.0), 3.0);
  // back wall bokeh (out-of-focus warm bulbs and a shelf of jars)
  if (d.z < 0.0) {
    for (int i = 0; i < 22; i++) {
      float fi = float(i);
      float h1 = fract(sin(fi * 12.9898) * 43758.5453);
      float h2 = fract(sin(fi * 78.233) * 24634.6345);
      float h3 = fract(sin(fi * 37.719) * 9631.21);
      vec3 c = normalize(vec3(-1.25 + 2.5 * h1, -0.25 + 0.75 * h2, -1.0));
      float r = 0.02 + 0.06 * h3 * h3;           // size variation (near/far bulbs)
      float dd = acos(clamp(dot(d, c), -1.0, 1.0));
      float soft = r * (0.3 + 0.4 * h2) + blur * 0.3;
      float disc = smoothstep(r + soft, r - soft, dd);
      // slightly brighter rim + faint lens "onion ring" texture inside the disc
      float x = dd / r;
      float body = 0.9 + 0.12 * smoothstep(0.6, 1.0, x) + 0.02 * sin(x * 14.0 + fi);
      body *= 0.92 + 0.16 * vnoise2((d.xy - c.xy) / r * 3.0 + fi * 7.0);
      vec3 bc = mix(vec3(1.0, 0.52, 0.2), vec3(1.0, 0.8, 0.5), h1);
      if (h2 > 0.82) bc = vec3(0.5, 0.65, 0.95);
      float bright = 0.06 + 0.5 * h1 * h3 + 0.12 * fract(fi * 0.73);
      // smaller = farther = more concentrated
      bright *= mix(1.6, 0.7, h3);
      room += bc * disc * body * bright * (1.0 - blur * 0.7);
    }
  }
  vec3 col = room + windowLight(d, blur);
  // warm tungsten lamp, upper left
  vec3 lc = normalize(vec3(-0.75, 0.55, 0.35));
  float s = 0.05 + blur * 0.5;
  float ld = 1.0 - dot(d, lc);
  col += vec3(9.0, 5.5, 2.6) * exp(-ld / (s * s * 0.5)) * (0.0025 / (s * s * 0.5 + 0.0025)) * 3.0;
  return col;
}
