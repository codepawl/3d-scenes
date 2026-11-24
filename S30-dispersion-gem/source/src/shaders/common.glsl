// ---------------------------------------------------------------------------
// Shared GLSL: hashing, value noise, fbm, and the procedural studio environment.
// hash12 / hash13: "Hash without Sine" by Dave Hoskins (MIT), see CREDITS.md.
// Everything else here is original.
// ---------------------------------------------------------------------------
#define PI 3.14159265359

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1, 0, 0));
  float c = hash13(i + vec3(0, 1, 0));
  float d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1));
  float g = hash13(i + vec3(1, 0, 1));
  float h = hash13(i + vec3(0, 1, 1));
  float k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.96875;
}

// --- studio environment ----------------------------------------------------
// Rectangular softbox seen along direction c with tangent axes u, v and half
// sizes hs (in tangent-plane units). Roughness widens the edge and lowers the
// peak so the energy stays roughly constant.
float softbox(vec3 d, vec3 c, vec3 u, vec3 v, vec2 hs, float rough) {
  float k = dot(d, c);
  if (k <= 0.0) return 0.0;
  vec2 q = vec2(dot(d, u), dot(d, v)) / k;
  float w = 0.004 + rough * 0.45;
  vec2 e = hs + w * 0.5;
  vec2 m = smoothstep(e, e - w, abs(q));
  float area = (2.0 * hs.x) * (2.0 * hs.y);
  float grown = (2.0 * hs.x + w) * (2.0 * hs.y + w);
  float centre = 0.82 + 0.18 * (1.0 - dot(q / e, q / e));
  return m.x * m.y * centre * area / grown;
}

// small round light ("spark"), radius r in radians
float spark(vec3 d, vec3 c, float r, float rough) {
  float rr = r + rough * 0.35;
  float a = acos(clamp(dot(d, c), -1.0, 1.0));
  return smoothstep(rr, rr * 0.55, a) * (r * r) / (rr * rr);
}

void basis(vec3 c, out vec3 u, out vec3 v) {
  u = normalize(cross(abs(c.y) > 0.95 ? vec3(1, 0, 0) : vec3(0, 1, 0), c));
  v = cross(c, u);
}

// Key softbox direction (also used for the plinth shadow).
const vec3 KEY_DIR = normalize(vec3(-0.5, 0.7, 0.6));

vec3 env(vec3 d, float rough) {
  // dark studio: warm floor bounce, cool-neutral ceiling, lit backdrop sweep behind the plinth
  float up = smoothstep(-0.35, 0.65, d.y);
  vec3 col = mix(vec3(0.016, 0.013, 0.011), vec3(0.030, 0.032, 0.036), up);
  col += vec3(0.055, 0.050, 0.046) * pow(max(dot(d, normalize(vec3(0.1, 0.25, -1.0))), 0.0), 6.0);
  col += vec3(0.010, 0.009, 0.008) * exp(-abs(d.y) * 9.0);

  vec3 u, v;
  // key: big warm-white softbox, upper left front
  basis(KEY_DIR, u, v);
  col += vec3(1.0, 0.96, 0.9) * 14.0 * softbox(d, KEY_DIR, u, v, vec2(0.42, 0.30), rough);
  // overhead
  vec3 c = normalize(vec3(0.15, 1.0, 0.1));
  basis(c, u, v);
  col += vec3(0.95, 0.97, 1.0) * 7.0 * softbox(d, c, u, v, vec2(0.30, 0.30), rough);
  // two tall rim strips behind, slightly cool
  c = normalize(vec3(0.92, 0.18, -0.45));
  basis(c, u, v);
  col += vec3(0.85, 0.92, 1.05) * 11.0 * softbox(d, c, u, v, vec2(0.05, 0.75), rough);
  c = normalize(vec3(-0.9, 0.22, -0.5));
  basis(c, u, v);
  col += vec3(0.9, 0.95, 1.05) * 9.0 * softbox(d, c, u, v, vec2(0.05, 0.75), rough);
  // front fill card, dim
  c = normalize(vec3(0.6, 0.15, 0.8));
  basis(c, u, v);
  col += vec3(1.0, 0.95, 0.9) * 1.6 * softbox(d, c, u, v, vec2(0.5, 0.35), rough);
  // tiny hard spark lights: these are what produce "fire" through dispersion
  col += vec3(1.0, 0.98, 0.95) * 160.0 * spark(d, normalize(vec3(0.35, 0.85, 0.45)), 0.018, rough);
  col += vec3(1.0, 0.97, 0.92) * 140.0 * spark(d, normalize(vec3(-0.25, 0.55, 0.8)), 0.016, rough);
  col += vec3(0.95, 0.98, 1.0) * 140.0 * spark(d, normalize(vec3(0.75, 0.45, 0.35)), 0.016, rough);
  col += vec3(1.0, 0.96, 0.9) * 120.0 * spark(d, normalize(vec3(-0.7, 0.35, 0.6)), 0.015, rough);
  col += vec3(1.0, 0.98, 0.96) * 120.0 * spark(d, normalize(vec3(0.05, 0.3, 0.95)), 0.014, rough);
  col += vec3(0.95, 0.97, 1.0) * 110.0 * spark(d, normalize(vec3(-0.1, 0.95, -0.3)), 0.016, rough);
  return col;
}

// Analytic irradiance of the same environment (Lambert, cosine weighted).
vec3 envIrradiance(vec3 n) {
  float up = n.y * 0.5 + 0.5;
  vec3 irr = PI * mix(vec3(0.018, 0.015, 0.012), vec3(0.034, 0.035, 0.038), up);
  irr += vec3(1.0, 0.96, 0.9) * 14.0 * (0.84 * 0.60) * 0.9 * max(dot(n, KEY_DIR), 0.0);
  irr += vec3(0.95, 0.97, 1.0) * 7.0 * 0.36 * 0.9 * max(dot(n, normalize(vec3(0.15, 1.0, 0.1))), 0.0);
  irr += vec3(0.85, 0.92, 1.05) * 11.0 * 0.15 * 0.9 * max(dot(n, normalize(vec3(0.92, 0.18, -0.45))), 0.0);
  irr += vec3(0.9, 0.95, 1.05) * 9.0 * 0.15 * 0.9 * max(dot(n, normalize(vec3(-0.9, 0.22, -0.5))), 0.0);
  irr += vec3(1.0, 0.95, 0.9) * 1.6 * 0.7 * 0.9 * max(dot(n, normalize(vec3(0.6, 0.15, 0.8))), 0.0);
  return irr;
}

// key-light-only irradiance (so the gem can shadow it)
vec3 keyIrradiance(vec3 n) {
  return vec3(1.0, 0.96, 0.9) * 14.0 * (0.84 * 0.60) * 0.9 * max(dot(n, KEY_DIR), 0.0);
}
