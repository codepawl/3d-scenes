// ---------------------------------------------------------------------------
// Shared GLSL: uniforms, hashing/noise, curved-earth geometry, sun + sky model,
// cumulus density field. Units are kilometres. Ocean surface is height 0.
// ---------------------------------------------------------------------------
precision highp float;
precision highp int;

uniform vec2  uRes;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3  uSunDir;
uniform float uTime;
uniform vec2  uOffset;     // world drift of the cloud field (km)
uniform float uFrame;

#define PI 3.14159265
const float EARTH_R  = 6371.0;
const float CLOUD_B  = 0.85;  // cloud base (km)
const float CLOUD_T  = 3.0;   // max tops (km)
const float MAX_DIST = 90.0;

// --- Hash without Sine, Dave Hoskins (MIT) -------------------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// --- value noise (quintic fade) -------------------------------------------
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i),               n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
const mat2 ROT2 = mat2(0.80, 0.60, -0.60, 0.80);
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise2(p); p = ROT2 * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}

// --- curved-earth "height above sea" with parabolic approximation -------
float heightOf(vec3 p) { return p.y + dot(p.xz, p.xz) / (2.0 * EARTH_R); }

// first t>0 where the ray crosses height H, ray starting below H. -1 if none
float shellUp(vec3 o, vec3 d, float H) {
  float a = dot(d.xz, d.xz) / (2.0 * EARTH_R);
  float b = d.y + dot(o.xz, d.xz) / EARTH_R;
  float c = heightOf(o) - H;           // < 0
  float disc = b * b - 4.0 * a * c;
  float s = sqrt(max(disc, 0.0));
  return (b >= 0.0) ? (2.0 * c) / (-b - s) : (-b + s) / (2.0 * a);
}
// first t>0 where ray from above hits height H (the ocean). -1 if miss
float shellDown(vec3 o, vec3 d, float H) {
  float a = dot(d.xz, d.xz) / (2.0 * EARTH_R);
  float b = d.y + dot(o.xz, d.xz) / EARTH_R;
  float c = heightOf(o) - H;           // > 0
  float disc = b * b - 4.0 * a * c;
  if (b >= 0.0 || disc < 0.0) return -1.0;
  float q = -0.5 * (b - sqrt(disc));
  return c / q;
}

// --- sun + sky ----------------------------------------------------------
const vec3 TAU_R = vec3(0.045, 0.105, 0.26);  // Rayleigh zenith optical depth
const vec3 TAU_M = vec3(0.10);                // hazy maritime aerosol
float airmass(float sinE) {                    // Kasten & Young 1989
  float e = degrees(asin(clamp(sinE, -0.05, 1.0)));
  return 1.0 / (max(sinE, -0.05) + 0.50572 * pow(max(e + 6.07995, 0.5), -1.6364));
}
vec3 sunColor() {                               // irradiance reaching the low atmosphere
  return 6.0 * exp(-(TAU_R + TAU_M) * airmass(uSunDir.y));
}
float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}
vec3 skyColor(vec3 d) {
  float vy = max(d.y, 0.0);
  float mv = airmass(vy);
  float ms = airmass(uSunDir.y);
  float c = dot(d, uSunDir);
  vec3 tau = TAU_R + TAU_M;
  vec3 scatter = (TAU_R * (3.0 / (16.0 * PI)) * (1.0 + c * c) + TAU_M * mix(hg(c, 0.72), hg(c, 0.2), 0.4)) / tau;
  vec3 E = 6.0 * exp(-tau * ms * 0.55);        // sun light along the view path
  vec3 L = E * scatter * (1.0 - exp(-tau * mv)) * 3.0;
  // multiple-scatter fill so the zenith stays blue and the horizon milky
  L += vec3(0.05, 0.13, 0.36) * (0.35 + 1.5 * max(uSunDir.y, 0.0)) * (1.0 - exp(-tau.z * mv));
  return L;
}
vec3 hazeColor(vec3 d) { return skyColor(normalize(vec3(d.x, 0.015, d.z))); }
vec3 skyAmbient() { return skyColor(vec3(0, 1, 0)) * 1.4 + skyColor(normalize(vec3(uSunDir.x, 0.25, uSunDir.z))) * 0.35; }

// --- cumulus density ----------------------------------------------------
float cloudCoverage(vec2 q) {
  float n = fbm2(q * 0.28 + vec2(3.1, 7.4));
  float m = vnoise2(q * 0.06 + 11.0);        // large-scale clustering
  return n * 0.85 + m * 0.25;
}
// cheap macro shape: returns signed fill (>0 inside), h is normalized height
float cloudShape(vec3 p, out float h) {
  h = (heightOf(p) - CLOUD_B) / (CLOUD_T - CLOUD_B);
  if (h < 0.0 || h > 1.0) return -1.0;
  vec2 q = p.xz + uOffset;
  float cov = cloudCoverage(q);
  float d = (cov - 0.635) * 3.6 - h * h * 1.0 - h * 0.15;
  d = min(d, h * 6.0 - 0.02);                 // flat-ish, sharp base
  return d;
}
float cloudDetail(vec3 p, float h, float d, bool hi) {
  vec3 q = vec3(p.x + uOffset.x, p.y, p.z + uOffset.y) * 2.8;
  q.y -= uTime * 0.035;                        // slow upward boil
  q.xz += uTime * vec2(0.01, 0.02);
  float n = vnoise3(q) * 0.55;
  n += vnoise3(q * 2.7 + 5.3) * 0.28;
  if (hi) n += vnoise3(q * 7.1 + 1.7) * 0.17;
  else n += 0.085;
  n = 1.0 - abs(n * 2.0 - 1.0);                // billowy
  d -= (1.0 - n) * (0.16 + 0.28 * h);
  return clamp(d * 2.6, 0.0, 1.0);
}
float cloudDensity(vec3 p, bool hi) {
  float h;
  float d = cloudShape(p, h);
  if (d <= 0.0) return 0.0;
  return cloudDetail(p, h, d, hi);
}

// optical depth of cloud along sun ray from a point anywhere below/inside the slab (cheap)
float sunShadowOD(vec3 p) {
  vec3 o = p;
  float hp = heightOf(p);
  float t0 = hp < CLOUD_B ? shellUp(p, uSunDir, CLOUD_B) : 0.0;
  float t1 = shellUp(p, uSunDir, CLOUD_T);
  t1 = min(t1, t0 + 14.0);
  float od = 0.0;
  const int N = 5;
  float dt = (t1 - t0) / float(N);
  for (int i = 0; i < N; i++) {
    float h;
    float d = cloudShape(o + uSunDir * (t0 + (float(i) + 0.5) * dt), h);
    od += clamp(d * 2.0, 0.0, 1.0) * dt;
  }
  return od * 18.0;
}
