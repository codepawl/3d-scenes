// Rain on a fogged, grimy window pane, refracting the defocused street behind it.
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uSway;
uniform sampler2D tBg;     // defocused street, half res
uniform sampler2D tBlur1;  // 1/4 res blur
uniform sampler2D tBlur2;  // 1/8 res blur (through condensation)

in vec2 vUv;
out vec4 fragColor;

#include <common>

const float PI = 3.14159265;

float gAA;  // one pixel in glass units

struct Wet {
  vec2 off;    // refraction offset (glass units)
  float mask;  // water coverage
  float clear; // condensation wiped away
  float rim;   // dark Fresnel / total-internal-reflection rim
  vec3 n;      // surface normal
};

void addDrop(inout Wet w, vec2 dq, float r, float k, float stretch) {
  vec2 e = dq;
  e.y *= dq.y > 0.0 ? stretch : 1.04;   // teardrop: longer tail above
  float d = length(e) / r;
  float m = smoothstep(1.0, 1.0 - 1.6 * gAA / r, d);
  if (m <= 0.0) return;
  float hgt = sqrt(max(1.0 - d * d, 0.0));
  vec2 nxy = e / r;
  w.off = mix(w.off, -dq * (1.0 + k) - nxy * (0.10 + r * 0.8) * (1.0 - 0.4 * hgt) + vec2(0.0, 0.06) * hgt, m);
  w.n = normalize(mix(w.n, vec3(nxy, hgt + 0.15), m));
  w.rim = max(w.rim, m * smoothstep(0.78, 1.0, d));
  w.mask = max(w.mask, m);
}

// path of a sliding drop: x wobble as a function of height in the cell
float pathX(float y, vec3 hc) {
  return 0.5 + 0.11 * sin(y * 7.0 + hc.y * 6.28) + 0.06 * sin(y * 23.0 + hc.z * 6.28)
       + 0.025 * sin(y * 51.0 + hc.x * 6.28);
}

void slideLayer(inout Wet w, vec2 g, float scale, float t, float seed) {
  vec2 cs = vec2(1.0, 3.2) / scale;      // cell size in glass units
  vec2 s = g / cs;
  float colId = floor(s.x);
  s.y += hash11(colId * 7.31 + seed) * 5.0;
  vec2 id = floor(s);
  vec2 q = fract(s);
  vec3 h = hash32(id + seed * 91.0);
  float rate = 0.12 + 0.16 * h.x;
  float ph = t * rate + h.y;
  float cyc = floor(ph);
  float pf = fract(ph);
  vec3 hc = hash32(id * 1.7 + vec2(cyc * 3.1, seed * 5.0));
  if (hc.x > 0.72) return;
  // stick-slip: speed swings between nearly stopped and fast
  float prog = pf + 0.05 * sin(pf * PI * 6.0 + hc.y * 3.0) * smoothstep(0.0, 0.1, pf);
  float y = 0.95 - prog * 1.12;
  float x = pathX(y, hc);
  float r = (0.17 + 0.10 * hc.z) * cs.x;
  float life = smoothstep(0.0, 0.12, y) * smoothstep(0.95, 0.84, y);
  r *= life;
  if (r < gAA) return;

  vec2 dq = (q - vec2(x, y)) * cs;
  // trail: wiped condensation + a few beads, re-fogging with age
  float above = q.y - y;
  if (above > 0.0) {
    float tx = (q.x - pathX(q.y, hc)) * cs.x;
    float age = above * cs.y / (rate * cs.y);        // seconds since the drop passed
    float tw = r * mix(0.75, 0.35, smoothstep(0.0, 1.5, age));
    float tm = smoothstep(tw, tw * 0.35 - gAA, abs(tx)) * exp(-age * 0.35) * smoothstep(1.0, 0.8, q.y);
    w.clear = max(w.clear, tm);
    // thin water film in the trail refracts slightly
    w.off += vec2(-tx * 0.6, 0.0) * tm * 0.5;
    // beads left behind
    float nb = 26.0;
    float by = q.y * nb;
    float bi = floor(by);
    vec3 bh = hash32(vec2(bi, id.x * 13.0 + id.y * 7.0 + cyc));
    float bcy = (bi + 0.5 + (bh.y - 0.5) * 0.5) / nb;
    if (bh.x > 0.35 && bcy > y + 0.02) {
      float bx = pathX(bcy, hc) + (bh.z - 0.5) * 0.12;
      float br = r * (0.12 + 0.28 * bh.y * bh.x) * smoothstep(9.0, 2.0, age);
      if (br > gAA) addDrop(w, (q - vec2(bx, bcy)) * cs, br, 0.5, 0.95);
    }
  }
  addDrop(w, dq, r, 0.7, 0.72);
}

void beadLayer(inout Wet w, vec2 g, float scale, float t, float seed, float density) {
  vec2 s = g * scale;
  vec2 id = floor(s);
  vec2 q = fract(s) - 0.5;
  vec3 h = hash32(id + seed * 37.0);
  if (h.z > density) return;
  vec2 c = (h.xy - 0.5) * 0.55;
  // beads slowly grow, then reset (new condensation)
  float life = fract(t * 0.03 * (0.6 + h.x) + h.y);
  float r = (0.10 + 0.22 * h.x * h.y) * mix(0.55, 1.0, sqrt(life)) / scale;
  r *= 1.0 - smoothstep(0.92, 1.0, life);
  if (r < gAA * 0.7) return;
  addDrop(w, (q - c) / scale, r, 0.6, 0.92);
}

// --- grime --------------------------------------------------------------------
float scratches(vec2 g) {
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = 0.4 + float(i) * 1.1;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 r = R * g * vec2(1.0, 60.0);
    float ln = abs(fract(r.y) - 0.5);
    float gate = step(0.88, hash12(vec2(floor(r.y), float(i)))) *
                 smoothstep(0.3, 0.7, vnoise(vec2(r.x * 3.0, floor(r.y))));
    s += smoothstep(0.06, 0.0, ln) * gate;
  }
  return s;
}

float waterMarks(vec2 g) {
  vec2 s = g * 7.0;
  vec2 id = floor(s);
  vec3 h = hash32(id + 400.0);
  vec2 q = fract(s) - 0.5 - (h.xy - 0.5) * 0.4;
  float r = 0.12 + 0.2 * h.z;
  float d = length(q * vec2(1.0, 0.85)) + 0.03 * vnoise(q * 30.0);
  float ring = smoothstep(0.02, 0.0, abs(d - r)) * step(0.8, h.x) * smoothstep(0.3, 0.7, vnoise(q * 9.0 + h.yz * 20.0));
  return ring;
}

// --- window frame ---------------------------------------------------------------
vec4 frame(vec2 g, vec2 lim, vec3 glow) {
  // lim: inner edges of frame (x left, y bottom) in glass units
  float fx = lim.x - g.x;        // >0 inside left stile
  float fy = lim.y - g.y;        // >0 inside bottom rail
  float f = max(fx, fy);
  if (f < -0.03) return vec4(0.0);
  bool rail = fy > fx;
  vec2 along = rail ? vec2(g.x * 3.0, g.y * 60.0) : vec2(g.y * 3.0, g.x * 60.0);
  // wood grain + paint
  float grain = fbm(along * vec2(1.0, 0.35) + 3.0);
  float edgeWear = smoothstep(0.03, 0.0, abs(f - 0.01));
  float chips = smoothstep(0.66 - 0.12 * edgeWear, 0.69 - 0.12 * edgeWear, fbm(g * 48.0 + 7.0) + 0.15 * vnoise(g * 200.0));
  float dirt = fbm(g * 9.0);
  vec3 paint = vec3(0.026, 0.025, 0.023) * (0.7 + 0.5 * dirt) * (0.85 + 0.3 * grain);
  vec3 wood = vec3(0.014, 0.009, 0.006) * (0.6 + 0.8 * grain);
  vec3 c = mix(paint, wood, chips);
  c *= 0.85 + 0.3 * vnoise(g * 140.0);
  // bevel highlight along the inner edge, lit by the street
  float bevel = smoothstep(0.010, 0.0, abs(f - 0.006));
  c += glow * bevel * (0.12 + 0.18 * (1.0 - chips)) * (0.6 + 0.8 * vnoise(along * 4.0));
  // glazing putty line, cracked
  float putty = smoothstep(0.0, 0.004, f) * smoothstep(0.016, 0.010, f);
  c = mix(c, vec3(0.022, 0.021, 0.02) * (0.6 + 0.6 * vnoise(along * 8.0)), putty * 0.8);
  // condensation pooled on the sill
  if (rail) {
    float pool = smoothstep(0.0, 0.003, fy) * smoothstep(0.022, 0.012, fy);
    c += glow * pool * 0.25 * (0.6 + 0.4 * sin(g.x * 90.0 + vnoise(g * 40.0) * 6.0));
  }
  return vec4(c, smoothstep(-gAA, gAA, f));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 g = (vUv - 0.5) * vec2(aspect, 1.0) + uSway;
  gAA = 1.0 / uRes.y;
  float t = uTime;

  Wet w = Wet(vec2(0.0), 0.0, 0.0, 0.0, vec3(0.0, 0.0, 1.0));
  slideLayer(w, g, 5.0, t, 1.0);
  slideLayer(w, g + vec2(0.37, 0.0), 8.0, t * 0.9, 2.0);
  slideLayer(w, g + vec2(0.11, 0.0), 13.0, t * 0.8, 3.0);
  float wiped = w.clear;
  Wet b = Wet(vec2(0.0), 0.0, 0.0, 0.0, vec3(0.0, 0.0, 1.0));
  beadLayer(b, g, 22.0, t, 4.0, 0.9);
  beadLayer(b, g + 0.13, 41.0, t, 5.0, 0.85);
  beadLayer(b, g + 0.29, 80.0, t, 6.0, 0.7);
  // condensation beads are removed where a drop has wiped the glass
  float keep = 1.0 - smoothstep(0.1, 0.6, wiped);
  if (b.mask * keep > w.mask) {
    float m = b.mask * keep;
    w.off = mix(w.off, b.off, m);
    w.n = normalize(mix(w.n, b.n, m));
    w.rim = max(w.rim * (1.0 - m), b.rim * keep);
    w.mask = max(w.mask, m);
  }

  // ---- glass condition
  float fogN = fbm(g * 2.2 + 5.0);
  float smear = fbm(vec2(g.x * 4.0 + fbm(g * 3.0) * 1.5, g.y * 1.2));    // old wipe marks
  float streak = fbm(vec2(g.x * 55.0, g.y * 1.6 + 2.0));                 // dirty run-off streaks
  float marks = waterMarks(g);
  float fog = smoothstep(0.0, 1.0, clamp(0.42 + 1.1 * (fogN - 0.5) + 0.6 * (smear - 0.5) + 0.15 * marks, 0.0, 1.0));
  fog *= 1.0 - wiped;
  float dust = step(0.985, hash12(floor(g * 520.0))) * (0.4 + 0.6 * hash12(floor(g * 520.0) + 9.0));
  float scr = scratches(g * 1.3);

  // ---- sample the street
  vec2 toUv = vec2(1.0 / aspect, 1.0);
  vec2 uvR = vUv + w.off * toUv;
  vec3 sharp = texture(tBg, uvR).rgb;
  vec3 mid = texture(tBlur1, uvR).rgb;
  vec3 far = texture(tBlur2, vUv + w.off * toUv * 0.3).rgb;
  vec3 farWide = texture(tBlur2, vUv + vec2(0.0, 0.01)).rgb;

  vec3 clearView = mix(sharp, mid, 0.18 + 0.25 * streak * 0.5);
  // fogged glass: diffused, milky lifted blacks, darker overall
  float lum = dot(farWide, vec3(0.299, 0.587, 0.114));
  vec3 fogView = far * 0.55 + farWide * 0.18 + vec3(0.010, 0.011, 0.014) + lum * vec3(0.10, 0.09, 0.08);
  vec3 col = mix(clearView, fogView, fog);

  // ---- water drops: lens view, dark rims, glints, focused caustic
  vec3 dropView = mix(sharp, mid, 0.35) * 1.1 + far * 0.3 + vec3(0.006, 0.007, 0.01);
  dropView *= 1.0 - 0.6 * w.rim;
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L1 = normalize(vec3(0.35, 0.55, 0.75));     // street lamp, upper right
  vec3 L2 = normalize(vec3(-0.5, 0.2, 0.85));      // cooler shop light, left
  vec3 n = w.n;
  float s1 = pow(max(dot(n, normalize(L1 + V)), 0.0), 140.0);
  float s2 = pow(max(dot(n, normalize(L2 + V)), 0.0), 220.0);
  dropView += vec3(1.0, 0.72, 0.42) * s1 * 0.9 + vec3(0.6, 0.8, 1.0) * s2 * 0.4;
  // caustic: light gathered at the lower edge of each drop
  float caus = smoothstep(0.2, 0.9, -n.y) * smoothstep(0.1, 0.6, length(n.xy));
  dropView += lum * caus * vec3(0.9, 0.7, 0.5) * 0.35;
  col = mix(col, dropView, w.mask);

  // ---- grime layered on top
  vec3 film = vec3(0.020, 0.018, 0.016);
  col = mix(col, col * 0.85 + film, streak * 0.35 * (1.0 - w.mask));
  col += vec3(0.05, 0.04, 0.03) * dust * (0.4 + lum * 4.0) * (1.0 - w.mask);
  col += vec3(0.10, 0.08, 0.06) * scr * (0.05 + lum * 1.5) * (1.0 - w.mask);
  col += vec3(0.008) * marks;

  // ---- window frame (left stile + bottom rail)
  vec2 lim = vec2(-0.5 * aspect + 0.075, -0.5 + 0.085) + uSway;
  float fx = lim.x - g.x, fy = lim.y - g.y, f = max(fx, fy);
  col *= mix(0.55, 1.0, smoothstep(0.0, 0.05, -f));   // shade near the frame
  vec4 fr = frame(g, lim, vec3(0.35, 0.22, 0.12));
  col = mix(col, fr.rgb, clamp(fr.a, 0.0, 1.0));

  // ---- camera: vignette, tonemap, grain, dither
  vec2 vq = vUv - 0.5;
  col *= 1.0 - 0.55 * dot(vq, vq) * 1.6;
  col *= 1.35;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  float gr = hash12(gl_FragCoord.xy + fract(t * 7.0) * 1000.0) - 0.5;
  col += gr * 0.025;
  col += (hash12(gl_FragCoord.xy * 1.37 + 91.0) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
