// Fullscreen ray-traced scene: glass tank of water on a worn concrete slab in front of a plaster wall.
// The ink volume is the 2D fluid field lifted procedurally into depth (no 3D grid anywhere).

export const sceneVert = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const sceneFrag = /* glsl */ `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uDye;
uniform sampler2D uDyeBlur;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform float uFovY;
uniform float uFrame;

// ---------- scene constants (world units ~ decimetres) ----------
const float WL = 2.20;                  // water level
const float FLOOR_IN = 0.06;            // inner glass bottom
const vec3  IN_MIN = vec3(-1.0, FLOOR_IN, -0.6);
const vec3  IN_MAX = vec3( 1.0, 2.62,     0.6);
const vec3  OUT_MIN = vec3(-1.04, 0.0, -0.64);
const vec3  OUT_MAX = vec3( 1.04, 2.62, 0.64);
const float GLASS_T = 0.04;
const float WALL_Z = -3.2;
const vec2  DOMAIN = vec2(2.0, 2.14);

const vec3 KEY_DIR = normalize(vec3(-0.35, 0.85, -0.42)); // light comes from behind-above-left
const vec3 KEY_COL = vec3(1.0, 0.93, 0.82) * 2.6;

// ---------- hashing / noise (original) ----------
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec2  h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h13(i), h13(i + vec3(1,0,0)), u.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), u.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
float fbm3o(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = r * p * 2.07 + 5.3; a *= 0.5; }
  return s;
}
// cellular distance (F1) for pits / aggregate / droplets
vec2 cell(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d = 9.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 o = h22(i + g);
    vec2 r = g + o - f;
    float dd = dot(r, r);
    if (dd < d) { d = dd; id = h12(i + g); }
  }
  return vec2(sqrt(d), id);
}

// ---------- ray / box ----------
vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
vec3 boxNormal(vec3 p, vec3 bmin, vec3 bmax) {
  vec3 c = (bmin + bmax) * 0.5, e = (bmax - bmin) * 0.5;
  vec3 d = (p - c) / e;
  vec3 a = abs(d);
  if (a.x > a.y && a.x > a.z) return vec3(sign(d.x), 0.0, 0.0);
  if (a.y > a.z) return vec3(0.0, sign(d.y), 0.0);
  return vec3(0.0, 0.0, sign(d.z));
}
float fresnel(float cosi, float f0) { return f0 + (1.0 - f0) * pow(1.0 - clamp(cosi, 0.0, 1.0), 5.0); }

// ---------- ink volume ----------
vec2 inkUV(vec3 p) { return vec2((p.x + 1.0) / DOMAIN.x, (p.y - FLOOR_IN) / DOMAIN.y); }

// returns (inkA, inkB) density at p
vec2 inkDensity(vec3 p) {
  vec2 uv = inkUV(p);
  vec2 bl = textureLod(uDyeBlur, uv, 0.0).rg;
  float bulk = clamp(bl.r + bl.g, 0.0, 1.5);
  float halfW = 0.05 + 0.42 * sqrt(bulk);              // plume half-thickness in z
  float zn = p.z / halfW;
  if (abs(zn) > 2.2) return vec2(0.0);
  // depth-dependent warp: each z slice sees a slightly different curl of the same sheet
  vec3 q = vec3(p.xy * 4.2, p.z * 3.5 + uTime * 0.05);
  vec2 w = vec2(vnoise3(q), vnoise3(q + 17.3)) - 0.5;
  w += 0.5 * (vec2(vnoise3(q * 2.3 + 5.1), vnoise3(q * 2.3 + 9.7)) - 0.5);
  vec2 d = textureLod(uDye, uv + w * 0.075 * zn + w * 0.006, 0.0).rg;
  float prof = exp(-zn * zn * 1.3);
  // thin ink frays into wisps; dense cores stay solid
  float er = vnoise3(vec3(p.xy * 11.0, p.z * 9.0 - uTime * 0.03));
  d *= mix(vec2(0.55 + 0.9 * er), vec2(1.0), smoothstep(vec2(0.05), vec2(0.6), d));
  return d * prof;
}
// cheap, blurred density for light shadowing
vec2 inkDensitySoft(vec3 p) {
  vec2 uv = inkUV(p);
  vec2 bl = textureLod(uDyeBlur, uv, 0.0).rg;
  float bulk = clamp(bl.r + bl.g, 0.0, 1.5);
  float halfW = 0.05 + 0.42 * sqrt(bulk);
  float zn = p.z / halfW;
  return bl * exp(-zn * zn * 1.3);
}

// absorption (per unit density, per unit length)
const vec3 SIG_A = vec3(5.6, 4.9, 2.5);   // indigo-black: lets a little blue through when thin
const vec3 SIG_B = vec3(1.5, 6.0, 4.8);   // carmine
const vec3 ALB_A = vec3(0.10, 0.14, 0.30);
const vec3 ALB_B = vec3(0.65, 0.10, 0.08);
const float INK_K = 4.2;

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

// march ink + water between ro and ro+rd*tLen; updates radiance L and throughput T
void marchWater(vec3 ro, vec3 rd, float tLen, int steps, float jit, inout vec3 L, inout vec3 T) {
  // clip to the ink slab in z and below the surface
  float dt = tLen / float(steps);
  float ph = mix(hg(dot(rd, KEY_DIR), 0.55), 1.0 / (4.0 * 3.14159), 0.35);
  vec3 amb = vec3(0.55, 0.6, 0.62);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * (dt * (float(i) + jit));
    vec2 d = inkDensity(p);
    float dsum = d.x + d.y;
    if (dsum > 1e-4) {
      vec3 sig = (d.x * SIG_A + d.y * SIG_B) * INK_K;
      vec3 alb = (d.x * ALB_A * SIG_A + d.y * ALB_B * SIG_B) / max(d.x * SIG_A + d.y * SIG_B, vec3(1e-4));
      // light transmittance toward the key light through soft ink
      vec2 acc = vec2(0.0);
      for (int k = 1; k <= 4; k++) acc += inkDensitySoft(p + KEY_DIR * 0.09 * float(k));
      vec3 Tl = exp(-(acc.x * SIG_A + acc.y * SIG_B) * INK_K * 0.09);
      // light also attenuates through water above
      vec3 Ls = KEY_COL * Tl * ph + amb * 0.35;
      vec3 stepT = exp(-sig * dt);
      L += T * alb * Ls * (1.0 - stepT);
      T *= stepT;
      if (max(T.r, max(T.g, T.b)) < 0.004) break;
    }
  }
  T *= exp(-vec3(0.05, 0.022, 0.018) * tLen); // water absorption
}

// ---------- environment ----------
vec3 studio(vec3 rd) {
  // room behind the camera: dim, with a big soft window high on the left and a dark bounce card
  float up = rd.y * 0.5 + 0.5;
  vec3 c = mix(vec3(0.020, 0.018, 0.017), vec3(0.09, 0.085, 0.08), smoothstep(0.2, 0.9, up));
  vec2 w = vec2(atan(rd.x, rd.z), rd.y);
  float win = smoothstep(0.35, 0.2, abs(w.x + 2.4)) * smoothstep(0.08, 0.2, w.y) * smoothstep(0.75, 0.6, w.y);
  float mull = smoothstep(0.012, 0.0, abs(fract(w.x * 3.0) - 0.5) - 0.47);
  c += vec3(1.0, 0.95, 0.88) * 2.0 * win * (1.0 - 0.8 * mull);
  float win2 = smoothstep(0.5, 0.3, abs(w.x - 2.6)) * smoothstep(0.0, 0.2, w.y) * smoothstep(0.6, 0.4, w.y);
  c += vec3(0.7, 0.75, 0.8) * 0.35 * win2;
  return c;
}

// shadow / caustic factor of the tank on the table along KEY_DIR
vec3 tankLightOnTable(vec3 p) {
  vec2 b = boxHit(p, KEY_DIR, IN_MIN, vec3(IN_MAX.xy, IN_MAX.z));
  if (b.y <= max(b.x, 0.0)) return vec3(1.0);
  float t0 = max(b.x, 0.0);
  float tw = (WL - p.y) / KEY_DIR.y; // where the light ray crosses the water surface
  float t1 = min(b.y, tw);
  vec3 T = vec3(0.82); // glass + water loss
  if (t1 > t0) {
    vec2 acc = vec2(0.0);
    for (int i = 0; i < 6; i++) acc += inkDensitySoft(p + KEY_DIR * mix(t0, t1, (float(i) + 0.5) / 6.0));
    acc *= (t1 - t0) / 6.0;
    T *= exp(-(acc.x * SIG_A + acc.y * SIG_B) * INK_K * 0.8);
    // caustics from the rippled surface
    vec3 s = p + KEY_DIR * tw;
    vec2 cp = s.xz * 3.2;
    vec2 wp = cp * 1.4 + vec2(fbm3o(cp + uTime * 0.2), fbm3o(cp.yx - uTime * 0.17)) * 1.5;
    float web = abs(fbm3o(wp) - 0.5) + abs(fbm3o(wp * 1.9 + 4.0) - 0.5) * 0.6;
    float caus = smoothstep(0.16, 0.0, web);
    T *= 0.75 + 0.8 * caus * caus;
  }
  return T;
}

vec3 shadeTable(vec3 p, vec3 rd, bool underTank) {
  vec2 q = p.xz;
  // worn cast concrete: mottled albedo, aggregate, pits, stains, scratches
  float m = fbm(q * 1.3);
  float m2 = fbm(q * 7.0 + 4.0);
  vec3 alb = mix(vec3(0.11, 0.10, 0.095), vec3(0.24, 0.22, 0.20), m);
  alb *= 0.85 + 0.3 * m2;
  vec2 ag = cell(q * 22.0);
  alb = mix(alb, alb * vec3(0.75, 0.73, 0.7), smoothstep(0.25, 0.1, ag.x) * step(0.6, ag.y));
  vec2 pit = cell(q * 40.0 + 7.0);
  float pits = smoothstep(0.12, 0.05, pit.x) * step(0.82, pit.y);
  alb *= 1.0 - 0.6 * pits;
  // old water ring stains + grime darkening
  float ring = smoothstep(0.03, 0.0, abs(length(q - vec2(1.85, 1.1)) - 0.42 - 0.02 * vnoise(q * 9.0)));
  ring += smoothstep(0.025, 0.0, abs(length(q - vec2(-2.1, 0.6)) - 0.33 - 0.03 * vnoise(q * 7.0))) * 0.7;
  alb *= 1.0 - 0.25 * ring;
  float grime = smoothstep(0.45, 0.75, fbm(q * 0.6 + 2.0));
  alb *= 1.0 - 0.3 * grime;
  // fine scratches
  vec2 sq = mat2(0.94, 0.34, -0.34, 0.94) * q;
  float scr = smoothstep(0.985, 1.0, vnoise(vec2(sq.x * 2.0, sq.y * 160.0))) * smoothstep(0.4, 0.7, vnoise(sq * 3.0));
  alb += 0.08 * scr;

  float rough = clamp(0.55 + 0.35 * (m2 - 0.5) - 0.3 * ring - 0.2 * grime * 0.0 + 0.3 * pits, 0.2, 0.95);

  // lighting: key light (through tank where applicable) + wall bounce + room fill
  vec3 n = vec3(0.0, 1.0, 0.0);
  // micro normal from the mottle
  float e = 0.004;
  float hC = fbm3o(q * 18.0);
  n = normalize(vec3(-(fbm3o((q + vec2(e, 0.0)) * 18.0) - hC) / e * 0.004, 1.0, -(fbm3o((q + vec2(0.0, e)) * 18.0) - hC) / e * 0.004));
  float ndl = max(dot(n, KEY_DIR), 0.0);
  vec3 lt = tankLightOnTable(p);
  vec3 col = alb * (KEY_COL * ndl * lt * 0.32 + vec3(0.12, 0.115, 0.11));
  // ambient occlusion near the tank footprint and toward the wall
  vec2 dq = max(abs(q - vec2(0.0, 0.0)) - vec2(1.04, 0.64), 0.0);
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.35, length(dq)));
  ao *= mix(0.7, 1.0, smoothstep(0.0, 1.2, p.z - WALL_Z));
  col *= ao;
  // glossy reflection of the bright wall / window, broken up by roughness
  vec3 r = reflect(rd, n);
  float f = fresnel(dot(-rd, n), 0.04);
  vec3 env = studio(r);
  if (r.z < 0.0) env = vec3(1.0, 0.94, 0.84) * (0.25 + 0.9 * exp(-pow((p.x + 0.4) * 0.5, 2.0))); // the lit wall
  col += env * f * (1.0 - rough) * (1.0 - rough) * 0.35;
  if (underTank) col *= vec3(0.55, 0.62, 0.6); // seen through the glass floor
  return col;
}

vec3 shadeWall(vec3 p) {
  vec2 q = p.xy;
  // lime plaster: trowel marks, stains, hairline cracks
  float m = fbm(q * 0.9 + 3.0);
  float tr = fbm(vec2(q.x * 2.2 + q.y * 0.8, q.y * 4.0 - q.x));
  vec3 alb = mix(vec3(0.70, 0.66, 0.60), vec3(0.80, 0.77, 0.71), m);
  alb *= 0.9 + 0.18 * tr;
  float streak = fbm(vec2(q.x * 3.0, q.y * 0.35 + 1.0));
  alb *= 1.0 - 0.18 * smoothstep(0.55, 0.8, streak) * smoothstep(3.2, 0.5, q.y);
  vec2 ck = q * 2.0 + vec2(fbm(q * 3.0), fbm(q * 3.0 + 9.0)) * 0.6;
  float crack = smoothstep(0.006, 0.0, abs(fbm3o(ck) - 0.5)) * smoothstep(0.6, 0.75, vnoise(q * 0.8));
  alb *= 1.0 - 0.18 * crack;
  float spk = step(0.93, h12(floor(q * 260.0))) * 0.05;
  alb -= spk;
  // a large soft pool of window light behind the tank
  vec2 c = q - vec2(-0.4, 1.7);
  float pool = exp(-dot(c * vec2(0.42, 0.55), c * vec2(0.42, 0.55)));
  vec3 E = vec3(0.05, 0.05, 0.055) + vec3(1.0, 0.94, 0.84) * (0.12 + 1.25 * pool);
  E *= mix(0.55, 1.0, smoothstep(-0.1, 1.0, q.y)); // contact darkening at the table
  // tank shadow on the wall (soft rectangle, offset by the light)
  return alb * E;
}

// background seen along a ray starting outside the tank (no tank re-entry)
vec3 background(vec3 ro, vec3 rd) {
  float tT = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float tW = rd.z < 0.0 ? (WALL_Z - ro.z) / rd.z : 1e9;
  if (tT < tW) {
    vec3 p = ro + rd * tT;
    bool under = all(lessThan(abs(p.xz), vec2(1.04, 0.64)));
    return shadeTable(p, rd, under);
  }
  if (tW < 1e8) return shadeWall(ro + rd * tW);
  return studio(rd);
}

// ---------- glass surface detail ----------
// grime in [0,1] on a tank face, given 2D face coordinates (u horizontal, y height)
float glassGrime(vec2 f, float side) {
  float g = 0.0;
  // wipe streaks: arcs left by a cloth
  vec2 a = f - vec2(0.3 + side, 1.2);
  float arc = sin(length(a) * 38.0 + vnoise(f * 3.0) * 4.0) * 0.5 + 0.5;
  g += 0.25 * arc * smoothstep(0.55, 0.85, fbm(f * 1.6 + side * 7.0));
  // fingerprints: a couple of ridged ellipses
  for (int i = 0; i < 3; i++) {
    vec2 c = vec2(-0.75 + 0.62 * float(i) + side * 0.3, 0.55 + 0.45 * fract(float(i) * 0.618 + side));
    vec2 d = (f - c) * vec2(1.0, 0.75) * 11.0;
    float r = length(d);
    float ridge = 0.5 + 0.5 * sin(r * 14.0 + vnoise(d * 2.0) * 3.0);
    g += 0.12 * ridge * smoothstep(1.0, 0.3, r) * step(0.35, fract(float(i) * 0.37 + side));
  }
  // dust specks
  vec2 cd = cell(f * 60.0 + side * 13.0);
  g += 0.6 * smoothstep(0.08, 0.02, cd.x) * step(0.9, cd.y);
  // limescale crust at and above the waterline
  float lime = smoothstep(0.03, 0.0, f.y - WL - 0.04 - 0.03 * fbm(f * 12.0)) * smoothstep(-0.02, 0.01, f.y - WL);
  g += 0.9 * lime * (0.6 + 0.4 * fbm(f * 40.0));
  // general haze
  g += 0.08 * fbm(f * 4.0 + side);
  return clamp(g, 0.0, 1.0);
}

// droplets left on the inside of the glass above the waterline
float droplets(vec2 f) {
  if (f.y < WL + 0.03 || f.y > 2.58) return 0.0;
  vec2 c = cell(f * vec2(26.0, 20.0));
  float fall = smoothstep(2.58, WL + 0.03, f.y);
  return smoothstep(0.32, 0.22, c.x) * step(1.0 - 0.55 * fall, c.y);
}

// ---------- main trace ----------
// Structured so that every expensive shading function is called exactly once (FXC inlines everything,
// so repeated calls explode compile times on ANGLE/D3D11). The final background ray is evaluated at the end.
vec3 trace(vec3 ro, vec3 rd, float jit) {
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  vec3 bgO = ro, bgD = rd;   // background ray evaluated once at the end, weighted by T
  vec3 cheapEnv = vec3(0.0);

  vec2 hb = boxHit(ro, rd, OUT_MIN, OUT_MAX);
  bool hitTank = hb.y > max(hb.x, 0.0);
  vec3 p = ro + rd * max(hb.x, 0.0);
  vec3 n = boxNormal(p, OUT_MIN, OUT_MAX);
  if (n.y > 0.5) hitTank = false;

  if (hitTank) {
    vec2 fc = abs(n.x) > 0.5 ? vec2(p.z, p.y) : vec2(p.x, p.y);
    vec2 faceHalf = abs(n.x) > 0.5 ? vec2(0.64, 1.31) : vec2(1.04, 1.31);
    float edgeD = min(faceHalf.x - abs(fc.x), min(p.y, OUT_MAX.y - p.y));

    float F = fresnel(dot(-rd, n), 0.045);
    float grime = glassGrime(fc, n.x + n.z * 2.0);
    vec3 envR = studio(reflect(rd, n));
    L += mix(envR, vec3(0.12, 0.115, 0.11), grime * 0.6) * F;
    T *= (1.0 - F);
    L += grime * vec3(0.16, 0.16, 0.15) * (0.7 + 0.6 * max(dot(n, KEY_DIR), 0.0));
    T *= 1.0 - 0.45 * grime;

    // thick glass edges: green-tinted, dark-cored bands
    float edge = smoothstep(GLASS_T * 1.25, GLASS_T * 0.75, edgeD);
    vec3 eg = vec3(0.07, 0.16, 0.13) * (0.7 + 0.3 * vnoise(fc * vec2(8.0, 2.0))) + envR * 0.25;
    L = mix(L, eg, edge);
    T *= (1.0 - edge * 0.9) * vec3(0.93, 0.97, 0.95);

    if (p.y > WL) {
      // above water: droplets on the inside face, then out through the back glass
      float dr = droplets(fc);
      L += T * dr * vec3(0.25, 0.26, 0.26) * (0.5 + 0.5 * vnoise(fc * 90.0));
      T *= 1.0 - 0.5 * dr;
      vec2 hb2 = boxHit(p, rd, IN_MIN, IN_MAX);
      bgO = p + rd * max(hb2.y, 0.0);
      T *= 0.92 * vec3(0.93, 0.97, 0.95);
    } else {
      vec3 d = refract(rd, n, 1.0 / 1.333);
      p += d * 0.002;
      int steps = 64;
      bool exited = false;
      for (int seg = 0; seg < 4; seg++) {
        vec2 hi = boxHit(p, d, IN_MIN, IN_MAX);
        float tBox = max(hi.y, 0.0);
        float tSurf = d.y > 0.0 ? (WL - p.y) / d.y : 1e9;
        float tEnd = min(tBox, tSurf);
        marchWater(p, d, tEnd, steps, jit, L, T);
        p += d * tEnd;
        steps = 20;
        if (max(T.r, max(T.g, T.b)) < 0.004) { T = vec3(0.0); exited = true; break; }

        if (tSurf < tBox) {
          // underside of the surface: mostly total internal reflection, gently rippled
          vec2 sq = p.xz * 6.0;
          vec3 sn = normalize(vec3((vnoise(sq + uTime * 0.6) - 0.5) * 0.06, -1.0, (vnoise(sq.yx - uTime * 0.5) - 0.5) * 0.06));
          vec3 rt = refract(d, sn, 1.333);
          float Fs = dot(rt, rt) < 1e-4 ? 1.0 : fresnel(dot(-d, sn), 0.02);
          L += T * (1.0 - Fs) * vec3(0.25, 0.24, 0.22);
          T *= Fs;
          d = reflect(d, sn);
          p += d * 0.002;
          continue;
        }

        vec3 nw = boxNormal(p, IN_MIN, IN_MAX);
        if (nw.y < -0.5) {
          // through the glass floor onto the table
          T *= vec3(0.80, 0.90, 0.87);
          bgO = p; bgD = d;
          exited = true;
          break;
        }
        vec3 ro2 = refract(d, -nw, 1.333);
        float Fo = dot(ro2, ro2) < 1e-4 ? 1.0 : fresnel(dot(d, nw), 0.045);
        if (Fo > 0.97) {
          // total internal reflection at a side wall: keep bouncing inside
          d = reflect(d, nw);
          p += d * 0.002;
          continue;
        }
        // leave through this wall: the remaining reflected part is folded into a dim fill
        cheapEnv = T * Fo * vec3(0.30, 0.30, 0.28);
        T *= (1.0 - Fo) * vec3(0.93, 0.97, 0.95);
        bgO = p + nw * GLASS_T; bgD = ro2;
        exited = true;
        break;
      }
      if (!exited) { L += T * vec3(0.2, 0.21, 0.2); T = vec3(0.0); }
      L += cheapEnv;
      // back-face glass grime (seen from inside, out of focus so keep it low-frequency)
      float g2 = smoothstep(0.5, 0.85, fbm3o(bgO.xy * 2.5 + bgO.z)) * 0.35;
      L += T * g2 * vec3(0.10);
      T *= 1.0 - 0.4 * g2;
    }
  }
  if (max(T.r, max(T.g, T.b)) > 0.0) L += T * background(bgO, bgD);
  return L;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 ndc = (px / uRes) * 2.0 - 1.0;
  float th = tan(uFovY * 0.5);
  vec3 rd = normalize(uCamRot * vec3(ndc.x * th * uRes.x / uRes.y, ndc.y * th, -1.0));
  // interleaved gradient noise for march jitter (stable per pixel)
  float jit = h12(px * 1.37 + vec2(uFrame * 17.31, uFrame * 7.13));
  vec3 col = trace(uCamPos, rd, jit);
  outColor = vec4(col, 1.0);
}`;

// Downsample (SSAA resolve) + tonemap + grade + dither
export const postFrag = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
uniform float uScale;
uniform float uFrame;

vec3 aces(vec3 x) { // Narkowicz fit
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec3 c = vec3(0.0);
  if (uScale > 1.5) {
    // 2x2 box resolve (the target is exactly 2x the output)
    c += texture(uSrc, vUv + uSrcTexel * vec2(-0.5, -0.5)).rgb;
    c += texture(uSrc, vUv + uSrcTexel * vec2( 0.5, -0.5)).rgb;
    c += texture(uSrc, vUv + uSrcTexel * vec2(-0.5,  0.5)).rgb;
    c += texture(uSrc, vUv + uSrcTexel * vec2( 0.5,  0.5)).rgb;
    c *= 0.25;
  } else {
    c = texture(uSrc, vUv).rgb;
  }
  c *= 0.95;
  c = aces(c);
  // gentle grade: cool shadows, warm highlights
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c * vec3(0.96, 0.99, 1.03), c * vec3(1.02, 1.0, 0.97), smoothstep(0.2, 0.8, l));
  vec2 v = vUv - 0.5;
  c *= 1.0 - 0.35 * dot(v, v) * 1.6;
  c = pow(c, vec3(1.0 / 2.2));
  // film grain + dither to kill banding
  float g = h12(gl_FragCoord.xy + fract(uFrame * 0.618) * 517.0) + h12(gl_FragCoord.yx * 1.37 + uFrame) - 1.0;
  c += g * (1.5 / 255.0);
  outColor = vec4(c, 1.0);
}`;
