// S29 frost orb — analytic glass sphere with rough transmission and procedurally grown frost.
// Original work (CodePawl, 2026) except hash13/hash33 (Dave Hoskins, "Hash without Sine", MIT).
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrev;
uniform float uAlpha;
uniform vec2 uRes;
uniform vec2 uJitter;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uPixelAngle;
uniform int uFrame;
uniform int uSpp;
uniform float uFront;   // frost growth front, geodesic angle around seed (rad)
uniform float uCover;   // 0..1 overall frost coverage (dims caustic)
uniform vec3 uSeed;     // frost nucleation point (unit vector from orb centre)
uniform float uTime;

const float PI = 3.14159265;
const vec3 C = vec3(0.0, 1.0, 0.0);   // orb centre
const float R = 1.0;                  // orb radius
const float IOR = 1.5;
const vec3 LDIR = normalize(vec3(-0.52, 0.62, -0.58)); // towards the window
const vec3 WIN_COL = vec3(5.2, 5.6, 6.3);

// ------------------------------------------------------------------ hashing / noise
// Hash without Sine — Dave Hoskins (MIT) https://www.shadertoy.com/view/4djSRW
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
// per-pixel RNG (PCG-style integer hash)
uint rngState;
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rnd() { rngState = pcg(rngState); return float(rngState) * (1.0 / 4294967296.0); }
vec3 rndSphere() {
  float z = rnd() * 2.0 - 1.0, a = rnd() * 2.0 * PI, r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(a), r * sin(a), z) * pow(rnd(), 0.333);
}
vec3 rndDir() {
  float z = rnd() * 2.0 - 1.0, a = rnd() * 2.0 * PI, r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(a), r * sin(a), z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= 0.5; }
  return s;
}

// ------------------------------------------------------------------ environment (studio room)
vec3 envMap(vec3 d, float bl) {
  bl = clamp(bl, 0.0, 1.0);
  float up = d.y;
  // dim warm room, cooler ceiling
  vec3 col = mix(vec3(0.030, 0.024, 0.020), vec3(0.075, 0.080, 0.092), smoothstep(-0.3, 0.9, up));
  // faint wall panelling so reflections are not flat
  float az = atan(d.z, d.x);
  col *= 0.85 + 0.15 * smoothstep(0.3, 0.7, fract(az * 4.0 / PI));

  // big window behind-left, with mullions and a sky gradient
  vec3 wz = LDIR, wx = normalize(cross(vec3(0, 1, 0), wz)), wy = cross(wz, wx);
  float dz = dot(d, wz);
  if (dz > 0.0) {
    vec2 uv = vec2(dot(d, wx), dot(d, wy)) / dz;
    vec2 e = abs(uv) - vec2(0.48, 0.62);
    float win = 1.0 - smoothstep(-0.02 - bl * 0.6, 0.01 + bl * 0.6, max(e.x, e.y));
    float bars = smoothstep(0.012, 0.022 + bl * 0.3, abs(uv.x)) * smoothstep(0.012, 0.022 + bl * 0.3, abs(uv.y - 0.12));
    bars = mix(bars, 0.93, smoothstep(0.0, 0.25, bl));
    float sky = 0.75 + 0.35 * uv.y - 0.25 * smoothstep(-0.2, -0.62, uv.y); // brighter top, darker low trees
    float tree = smoothstep(-0.25 + bl, -0.5 - bl, uv.y + (0.08 * sin(uv.x * 23.0) + 0.05 * sin(uv.x * 51.0)) * (1.0 - bl));
    vec3 outside = WIN_COL * sky * mix(vec3(1.0), vec3(0.18, 0.22, 0.16), tree);
    col = mix(col, outside * (1.0 - 0.45 * bl), win * bars);
    // light spill around the window frame onto the wall
    col += vec3(0.25, 0.27, 0.3) * exp(-6.0 * max(max(e.x, e.y), 0.0)) * 0.35;
  }
  // warm practical lamp, right side
  vec3 l2 = normalize(vec3(0.95, 0.42, 0.35));
  float c2 = dot(d, l2);
  float lw = bl * 0.25;
  col += vec3(4.0, 2.3, 1.1) * smoothstep(0.9965 - lw, 0.9985, c2) * (0.0035 / (0.0035 + lw * 1.5));
  col += vec3(0.30, 0.17, 0.08) * pow(max(c2, 0.0), 24.0);
  // soft overhead bounce card
  col += vec3(0.20, 0.21, 0.23) * smoothstep(0.75, 0.98, up) * 1.2;
  return col;
}

// ------------------------------------------------------------------ table (worn dark wood)
const float TABLE_R = 7.0;

struct TableSurf { vec3 albedo; float rough; vec3 n; };

TableSurf tableSurf(vec3 p) {
  vec2 w = p.xz;
  float warp = fbm3(vec3(w * vec2(0.5, 2.0), 0.0));
  float grain = fbm(vec3(w.x * 0.45, w.y * 11.0 + warp * 3.0, 1.3));
  float rings = 0.5 + 0.5 * sin(w.y * 26.0 + warp * 9.0 + grain * 6.0);
  float pores = vnoise(vec3(w.x * 6.0, w.y * 160.0, 0.0));
  vec3 dark = vec3(0.050, 0.026, 0.013), mid = vec3(0.19, 0.10, 0.048);
  vec3 alb = mix(dark, mid, smoothstep(0.25, 0.75, grain) * 0.75 + rings * 0.25);
  alb *= 0.8 + 0.2 * pores;
  // grime blotches and water rings
  float grime = smoothstep(0.55, 0.78, fbm3(vec3(w * 1.3, 4.0)));
  alb *= 1.0 - 0.45 * grime;
  float ring = smoothstep(0.03, 0.0, abs(length(w - vec2(1.6, 1.1)) - 0.42)) * (0.5 + 0.5 * vnoise(vec3(w * 9.0, 2.0)));
  alb *= 1.0 - 0.35 * ring;
  // fine scratches (two directions)
  float s1 = smoothstep(0.012, 0.0, abs(vnoise(vec3(w.x * 2.0 + w.y * 0.4, w.y * 90.0, 7.0)) - 0.5));
  float s2 = smoothstep(0.010, 0.0, abs(vnoise(vec3(w.x * 70.0, w.y * 3.0 - w.x * 0.6, 9.0)) - 0.5));
  float scr = max(s1, s2 * 0.7) * smoothstep(0.35, 0.65, vnoise(vec3(w * 2.5, 3.0)));
  alb = mix(alb, vec3(0.30, 0.22, 0.16), scr * 0.35);
  // dust
  float dust = step(0.996, hash13(floor(vec3(w * 260.0, 1.0))));
  alb += dust * 0.08;
  float rough = 0.38 + 0.3 * grain + 0.3 * grime + 0.25 * scr - 0.12 * ring;
  // micro normal from grain
  vec3 n = normalize(vec3((pores - 0.5) * 0.04 + (grain - 0.5) * 0.05, 1.0, (rings - 0.5) * 0.03));
  return TableSurf(alb, clamp(rough, 0.18, 0.9), n);
}

bool hitSphere(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 oc = ro - C;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - R * R;
  float h = b * b - c;
  if (h < 0.0) return false;
  h = sqrt(h);
  t0 = -b - h; t1 = -b + h;
  return t1 > 0.0;
}

// light reaching the table from the window, through/around the glass orb
vec3 tableLight(vec3 p) {
  vec3 oc = p - C;
  float b = dot(oc, LDIR);
  float d = length(oc - LDIR * b);        // distance of the light ray from orb centre
  float inShadow = b < 0.0 ? 1.0 - smoothstep(R * 0.86, R * 1.06, d) : 0.0;
  // glass shadow: dark rim, lighter centre
  float trans = mix(0.75, 0.12, smoothstep(0.35, 0.95, d / R));
  trans = mix(trans, 0.25, uCover * 0.8);
  float light = mix(1.0, trans, inShadow);
  // caustic focus: rays converge ~1.5R past the centre
  vec3 cp = C - LDIR * (C.y / LDIR.y);
  vec2 q = p.xz - cp.xz;
  vec2 ld = normalize(LDIR.xz);
  vec2 qq = vec2(dot(q, ld) * LDIR.y, dot(q, vec2(-ld.y, ld.x)));
  float spread = mix(0.07, 0.30, uCover);
  float caustic = exp(-dot(qq, qq) / (spread * spread)) * mix(7.0, 0.6, uCover);
  // caustic ring flare
  caustic += exp(-pow((length(qq) - spread * 1.6) / (spread * 0.4), 2.0)) * mix(0.8, 0.1, uCover);
  return WIN_COL * 0.30 * (light + caustic * inShadow) * vec3(1.0, 0.98, 0.95);
}

vec3 shadeTable(vec3 p, vec3 rd, float bl) {
  TableSurf s = tableSurf(p);
  float ndl = max(dot(s.n, LDIR), 0.0);
  vec3 direct = tableLight(p) * ndl;
  // ambient from the room + contact occlusion under the orb
  float r2 = length(p.xz - C.xz);
  float ao = mix(0.25, 1.0, smoothstep(0.0, 1.4, r2));
  vec3 amb = vec3(0.08, 0.075, 0.07) * ao + vec3(0.06, 0.035, 0.018) * pow(max(dot(normalize(vec3(0.95, 0.42, 0.35)), s.n), 0.0), 2.0);
  vec3 col = s.albedo * (direct + amb);
  // rough env reflection (one stochastic lobe sample)
  vec3 rr = reflect(rd, s.n);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, s.n), 0.0), 5.0);
  vec3 spec = rr.y > 0.0 ? envMap(rr, s.rough * 1.2 + bl) : vec3(0.02);
  // orb occludes the reflection
  float a, b;
  if (hitSphere(p, rr, a, b)) spec *= 0.35;
  col += spec * fres * (1.0 - s.rough * 0.85) * ao * 0.45;
  // fade into the dark room at the table edge
  float edge = smoothstep(TABLE_R, TABLE_R * 0.6, length(p.xz));
  return mix(envMap(rd, 0.0) * 0.6, col, edge);
}

vec3 shadeBg(vec3 ro, vec3 rd, float bl) {
  if (rd.y < -1e-4) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    if (length(p.xz) < TABLE_R) return shadeTable(p, rd, bl);
  }
  return envMap(rd, bl);
}

// ------------------------------------------------------------------ frost growth field
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// one dendrite arm along +x of length L, with 60-degree side branches; p.y >= 0 (mirror-folded)
float dendriteArm(vec2 p, float L, float w, float sp, float brLen) {
  float d = sdSeg(p, vec2(0.0), vec2(L, 0.0)) - w * (1.0 - 0.65 * clamp(p.x / max(L, 1e-3), 0.0, 1.0));
  const vec2 dir = vec2(0.5, 0.8660254);
  float kb = floor((p.x - p.y * 0.57735) / sp);
  for (int j = 0; j < 2; j++) {
    float k = kb + float(j);
    float xb = k * sp;
    if (xb <= 0.0 || xb >= L) continue;
    float len = brLen * (L - xb) * smoothstep(0.0, sp * 1.5, xb);
    if (len <= 0.0) continue;
    d = min(d, sdSeg(p, vec2(xb, 0.0), vec2(xb, 0.0) + dir * len) - w * 0.55);
  }
  return d;
}

// fern: stem pointing away from the seed (mirror symmetric)
float fern(vec2 q, float L, float w) {
  q.x += 0.1 * L;
  return dendriteArm(vec2(q.x, abs(q.y)), L, w, 0.1, 0.45);
}
// six-armed hexagonal plate/star
float hexStar(vec2 q, float L, float w) {
  float a = atan(q.y, q.x), r = length(q);
  const float S = PI / 3.0;
  a = abs(mod(a + S * 0.5, S) - S * 0.5);
  vec2 p = r * vec2(cos(a), sin(a));
  return dendriteArm(p, L, w, 0.09, 0.33);
}

// crystals nucleate on cells as the front passes them, then keep growing.
// returns (coverage, height)
vec2 crystalLayer(vec3 p, float scale, float front, float pxw, float kind) {
  vec3 g = p * scale;
  vec3 gi = floor(g);
  float cov = 0.0, hgt = 0.0;
  float aa = pxw * scale;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 cid = gi + vec3(x, y, z);
    vec3 h = hash33(cid + kind * 31.7);
    if (h.y > (kind < 0.5 ? 0.45 : 0.35)) continue;          // sparse nucleation
    vec3 cp = normalize((cid + h) / scale);
    vec3 dv = p - cp;
    if (dot(dv, dv) > 4.0 / (scale * scale)) continue;
    float ang = acos(clamp(dot(cp, uSeed), -1.0, 1.0));
    float arrive = ang * (1.0 + 0.25 * (h.x - 0.5)) + 0.18 * (fbm3(cp * 3.0) - 0.5);
    float age = front - arrive;
    if (age <= 0.0) continue;
    vec3 away = cp * dot(uSeed, cp) - uSeed;
    float al = length(away);
    away = al > 1e-4 ? away / al : normalize(cross(cp, vec3(0.3, 1.0, 0.1)));
    vec3 bt = cross(cp, away);
    vec2 q = vec2(dot(dv, away), dot(dv, bt)) * scale;
    float rot = (h.z - 0.5) * (kind < 0.5 ? 0.9 : 6.28);
    float cr = cos(rot), sr = sin(rot);
    q = mat2(cr, sr, -sr, cr) * q;
    float sd;
    if (kind < 0.5) {
      float L = min(age * 5.0, 0.8 + 0.5 * h.x);
      sd = fern(q, L, 0.028 + 0.02 * h.z);
    } else {
      float L = min(age * 3.5, 0.35 + 0.3 * h.x);
      sd = hexStar(q, L, 0.04);
    }
    float c = 1.0 - smoothstep(-aa, aa, sd);
    float o = 0.65 + 0.35 * h.x;
    cov = max(cov, c * o);
    hgt = max(hgt, clamp(-sd * 8.0 + 0.5, 0.0, 1.0) * c);
  }
  return vec2(cov, hgt);
}

// x: coverage, y: height (for bump), z: sparkle id, w: rime haze
vec4 frostField(vec3 p, float pxw) {
  if (uFront <= 0.0) return vec4(0.0);
  float ang = acos(clamp(dot(p, uSeed), -1.0, 1.0));
  float ragged = ang + 0.35 * (fbm(p * 4.0) - 0.5) + 0.08 * (vnoise(p * 30.0) - 0.5);
  float behind = uFront - ragged;
  if (behind < -0.4) return vec4(0.0);
  vec2 ferns = crystalLayer(p, 7.0, uFront, pxw, 0.0);
  vec2 stars = crystalLayer(p, 19.0, uFront - 0.05, pxw, 1.0);
  // rime: granular haze that thickens behind the front, densest at the nucleation point
  float grainy = vnoise(p * 220.0) * 0.6 + vnoise(p * 70.0) * 0.4;
  float haze = smoothstep(0.0, 0.5, behind) * (0.25 + 0.55 * fbm3(p * 14.0)) * (0.7 + 0.3 * grainy);
  haze += smoothstep(0.08, 0.0, abs(behind - 0.03)) * 0.25 * grainy; // leading edge
  haze *= 0.75 + 0.25 * smoothstep(1.2, 0.0, ang);
  float cov = max(max(ferns.x, stars.x * 0.8), haze * 0.38);
  float hgt = max(ferns.y, stars.y * 0.7) + haze * 0.3;
  float sparkle = hash13(floor(p * 260.0));
  return vec4(clamp(cov, 0.0, 1.0), hgt, sparkle, haze);
}

// ------------------------------------------------------------------ glass wear (roughness map)
float glassWear(vec3 p, out float dust, out float grime) {
  float smudge = smoothstep(0.48, 0.78, fbm(p * 3.2 + 2.0));
  // fingerprint: curved ridges in a small oval patch
  vec3 fpC = normalize(vec3(0.55, 0.15, 0.82));
  vec3 fx = normalize(cross(fpC, vec3(0, 1, 0))), fy = cross(fx, fpC);
  vec2 q = vec2(dot(p - fpC, fx), dot(p - fpC, fy));
  float fr = length(q * vec2(1.0, 1.35));
  float ridges = 0.5 + 0.5 * sin(fr * 190.0 + 5.0 * vnoise(p * 25.0));
  float fp = ridges * smoothstep(0.17, 0.06, fr);
  // hairline scratches
  float s1 = smoothstep(0.015, 0.0, abs(vnoise(vec3(p.x * 3.0, p.y * 120.0 + p.z * 40.0, p.z * 3.0)) - 0.5));
  float s2 = smoothstep(0.012, 0.0, abs(vnoise(vec3(p.x * 110.0 + p.y * 30.0, p.y * 2.0, p.z * 4.0 + 11.0)) - 0.5));
  float scr = max(s1, s2) * smoothstep(0.5, 0.75, vnoise(p * 5.0 + 7.0));
  dust = step(0.9975, hash13(floor(p * 320.0))) * (0.5 + 0.5 * smoothstep(0.0, 1.0, p.y));
  grime = smoothstep(-0.55, -0.95, p.y) * (0.6 + 0.4 * fbm3(p * 9.0));
  return 0.018 + 0.10 * smudge + 0.07 * fp + 0.12 * scr + 0.25 * grime;
}

// ------------------------------------------------------------------ main
vec3 camRay(vec2 pix) {
  vec2 ndc = (pix / uRes) * 2.0 - 1.0;
  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dirV = normalize(v.xyz / v.w);
  return normalize((uCamWorld * vec4(dirV, 0.0)).xyz);
}

void main() {
  vec2 pix = gl_FragCoord.xy + uJitter;
  rngState = pcg(uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(uFrame) * 26699u);
  vec3 ro = uCamPos;
  vec3 rd = camRay(pix);

  // Sphere hit, evaluated for every pixel so screen-space derivatives stay valid for the frost bump.
  vec3 oc = ro - C;
  float b = dot(oc, rd);
  float hh = b * b - (dot(oc, oc) - R * R);
  bool hit = hh > 0.0 && (-b - sqrt(max(hh, 0.0))) > 0.0;
  float tHit = -b - sqrt(max(hh, 0.0));
  vec3 pClosest = ro + rd * max(-b, 0.0);
  vec3 pS = hit ? ro + rd * tHit : C + normalize(pClosest - C) * R;
  vec3 n0 = normalize(pS - C);
  float pxw = uPixelAngle * (hit ? tHit : length(pS - ro)) / max(dot(n0, -rd), 0.25);

  float dust, grime;
  float wear = glassWear(n0, dust, grime);
  vec4 fr = frostField(n0, pxw);
  // micro normal: analytic vector noise (no screen derivatives -> no 2x2 quad blocking)
  vec3 mn = vec3(vnoise(n0 * 90.0), vnoise(n0 * 90.0 + 17.0), vnoise(n0 * 90.0 + 41.0)) - 0.5;
  vec3 mf = hash33(floor(n0 * 420.0)) - 0.5;
  vec3 n = normalize(n0 + mn * (0.02 + 0.10 * wear) + mf * 0.25 * fr.y);

  vec3 col = vec3(0.0);
  int spp = uSpp;

  if (!hit) {
    for (int i = 0; i < 16; i++) {
      if (i >= spp) break;
      vec3 rdi = camRay(gl_FragCoord.xy + vec2(rnd(), rnd()) - 0.5 + uJitter * 0.0);
      col += shadeBg(ro, rdi, 0.0);
    }
    col /= float(spp);
  } else {
    float frost = fr.x;
    float roughF = mix(wear, 0.55, frost);
    // far-side frost seen through the glass (centre ray)
    vec3 tr0 = refract(rd, n0, 1.0 / IOR);
    vec3 pB = pS + tr0 * (-2.0 * dot(pS - C, tr0));
    vec3 nB = normalize(pB - C);
    float pxwB = pxw * 2.5;
    float dB, gB;
    float wearB = glassWear(nB, dB, gB);
    vec4 frB = frostField(nB, pxwB);
    float roughB = mix(wearB, 0.6, frB.x);

    vec3 V = -rd;
    vec3 Hh = normalize(LDIR + V);
    for (int i = 0; i < 16; i++) {
      if (i >= spp) break;
      // --- front surface microfacet
      vec3 nj = normalize(n + roughF * 0.6 * rndSphere());
      if (dot(nj, V) < 0.05) nj = n;
      float cosi = max(dot(nj, V), 0.0);
      float F = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
      vec3 refl = shadeBg(pS, reflect(rd, nj), roughF * 0.7);

      // --- transmission through the solid sphere (up to 3 internal events)
      vec3 dIn = refract(rd, nj, 1.0 / IOR);
      vec3 p = pS, dcur = dIn;
      vec3 thr = vec3(1.0 - F);
      vec3 trans = vec3(0.0);
      float travelled = 0.0;
      for (int k = 0; k < 3; k++) {
        float tt = -2.0 * dot(p - C, dcur);
        p += dcur * tt;
        travelled += tt;
        vec3 nOut = normalize(p - C);
        float rr = k == 0 ? roughB : wearB;
        vec3 njB = normalize(-nOut + rr * 0.6 * rndSphere());
        if (dot(njB, -dcur) < 0.05) njB = -nOut;
        vec3 dOut = refract(dcur, njB, IOR);
        vec3 absorb = exp(-vec3(0.10, 0.045, 0.06) * travelled);
        if (dot(dOut, dOut) > 0.0) {
          float co = max(dot(-njB, dOut), 0.0);
          float Fo = 0.04 + 0.96 * pow(1.0 - abs(dot(njB, dcur)), 5.0);
          vec3 bg = shadeBg(p, dOut, (roughF + rr) * 0.6);
          if (k == 0) {
            // far-side frost scatters light diffusely: it glows with what lies behind it
            vec3 frostLit = envMap(normalize(nOut + rndDir() * 0.6), 0.8) * 0.9 + bg * 0.25;
            bg = mix(bg, frostLit, frB.x * 0.8);
            bg *= 1.0 - 0.5 * gB;
          }
          trans += thr * absorb * (1.0 - Fo) * bg;
          thr *= Fo * absorb;
          dcur = reflect(dcur, njB);
        } else {
          thr *= absorb;
          dcur = reflect(dcur, njB);
        }
      }

      vec3 glass = F * refl + trans;

      // --- frost layer on the front: translucent white scatterer with glints
      vec3 scatterN = normalize(n + rndDir() * 0.6);
      vec3 irr = envMap(scatterN, 0.8);
      float ndl = max(dot(n, LDIR), 0.0);
      float back = max(-dot(n, LDIR), 0.0);
      vec3 frostCol = irr * 0.8 + WIN_COL * (0.13 * ndl + 0.05 * back) + trans * 0.5;
      frostCol *= vec3(0.93, 0.96, 1.0);
      vec3 c = mix(glass, frostCol, frost * 0.9);

      // dust specks and grime near the contact point
      c = mix(c, irr * 0.6 + vec3(0.04), dust * 0.6);
      c *= 1.0 - 0.35 * grime;
      col += c;
    }
    col /= float(spp);

    // frost glints: random facet orientations catch the window
    vec3 fn = normalize(n + (hash33(vec3(fr.z * 113.0, fr.z * 71.0, 3.0)) - 0.5) * 1.4);
    float g = pow(max(dot(fn, Hh), 0.0), 600.0) * step(0.6, fr.z);
    col += WIN_COL * 3.0 * g * fr.x;
  }

  col = max(col, vec3(0.0));
  col = min(col, vec3(64.0));
  vec3 prev = texture(uPrev, vUv).rgb;
  fragColor = vec4(mix(prev, col, uAlpha), 1.0);
}
