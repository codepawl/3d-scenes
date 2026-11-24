// S21 desert dunes — ray-marched heightfield, single-scattering sky, night stars.
// Original work by CodePawl, 2026 (MIT). See CREDITS.md for referenced techniques.
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamMat;
uniform float uTanHalfFov;
uniform vec3  uSunDir;      // true sun direction (for sky)
uniform vec3  uKeyDir;      // key light direction (sun by day, moon by night)
uniform vec3  uKeyCol;      // key light irradiance colour (already attenuated)
uniform vec3  uSkyAmb;      // hemispherical sky radiance average
uniform float uExposure;
uniform float uNight;       // 0 day .. 1 full night (stars)
uniform float uFrame;

#define PI 3.14159265

// ---------------------------------------------------------------- hashes / noise
// Integer hash (Dave Hoskins, "Hash without Sine 2", MIT). Exact on every GPU and mirrored in JS.
float hash12(vec2 p) {
  uvec2 q = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}
vec3 hash32(vec3 p) {
  uvec3 q = uvec3(ivec3(p)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  uint n = (q.x ^ q.y ^ q.z) * 1597334673u;
  uvec3 r = uvec3(n, n * 16807u, n * 48271u);
  return vec3(r) * (1.0 / 4294967295.0);
}

// value noise in [-1,1]
float vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.0; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- terrain
const vec2 WIND  = vec2(0.8660254, 0.5);
const vec2 WIND2 = vec2(0.4226183, 0.9063078);

// asymmetric dune cross-section, s in [0,1): gentle windward ramp, steep slip face
float profile(float s) {
  const float c = 0.72;
  if (s < c) { float x = s / c; return x * x * (1.6 - 0.6 * x); }
  float x = (s - c) / (1.0 - c);
  return (1.0 - x) * (1.0 - x);
}

float terrain(vec2 p) {
  vec2 q = vec2(dot(p, WIND), dot(p, vec2(-WIND.y, WIND.x)));
  // main transverse dunes, crests bent by warping noise
  float ph = q.x / 110.0 + 0.85 * vnoise(q * vec2(0.0035, 0.009)) + 0.22 * vnoise(q * 0.021 + 4.0);
  float amp = 0.62 + 0.38 * vnoise(q * vec2(0.004, 0.012) + 9.0);
  float h = 12.5 * amp * profile(fract(ph));
  // secondary, oblique dune train
  float ph2 = dot(p, WIND2) / 37.0 + 0.6 * vnoise(p * 0.027 + 7.0);
  h += 2.3 * (0.55 + 0.45 * vnoise(p * 0.011 + 2.0)) * profile(fract(ph2));
  // broad undulation
  h += 22.0 * fbm3(p * 0.0021 + 3.0);
  return h;
}

// ---------------------------------------------------------------- atmosphere
const float RP = 6371e3, RA = 6471e3;
const vec3  BR = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float BM = 21e-6, HR = 8e3, HM = 1.2e3, G = 0.76;

float sphereExit(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r;
  float d = b * b - c;
  return d < 0.0 ? -1.0 : -b + sqrt(d);
}
float sphereEnter(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r;
  float d = b * b - c;
  return d < 0.0 ? -1.0 : -b - sqrt(d);
}

// in-scattered radiance along rd up to distance maxT (metres); returns transmittance in trans
vec3 atmosphere(vec3 rd, vec3 sd, float maxT, float dust, out vec3 trans) {
  vec3 ro = vec3(0.0, RP + 2.0, 0.0);
  float tEnd = min(sphereExit(ro, rd, RA), maxT);
  float g = sphereEnter(ro, rd, RP);
  if (g > 0.0) tEnd = min(tEnd, g);
  const int N = 10;
  float ds = tEnd / float(N);
  vec3 sumR = vec3(0), sumM = vec3(0);
  float odR = 0.0, odM = 0.0;
  float mu = dot(rd, sd);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = G * G;
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * mu, 1.5));
  float bm = BM * dust;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (ds * (float(i) + 0.5));
    float h = length(p) - RP;
    float hr = exp(-h / HR) * ds, hm = exp(-h / HM) * ds;
    odR += hr; odM += hm;
    float tl = sphereExit(p, sd, RA);
    float dl = tl / 4.0, lR = 0.0, lM = 0.0;
    for (int j = 0; j < 4; j++) {
      vec3 q = p + sd * (dl * (float(j) + 0.5));
      float hl = length(q) - RP;
      lR += exp(min(-hl / HR, 40.0)) * dl;
      lM += exp(min(-hl / HM, 40.0)) * dl;
    }
    vec3 att = exp(-(BR * (odR + lR) + bm * 1.1 * (odM + lM)));
    sumR += att * hr; sumM += att * hm;
  }
  trans = exp(-(BR * odR + bm * 1.1 * odM));
  // x2.5: cheap stand-in for multiple scattering, single scattering alone gives a too-dark sky
  return 22.0 * 2.5 * (sumR * BR * pR + sumM * bm * pM);
}

// ---------------------------------------------------------------- night sky
vec3 stars(vec3 rd, float pix) {
  vec3 col = vec3(0);
  for (int layer = 0; layer < 2; layer++) {
    float R = layer == 0 ? 180.0 : 420.0;
    vec3 p = rd * R;
    vec3 cell = floor(p);
    vec3 h = hash32(cell + float(layer) * 113.0);
    float thresh = layer == 0 ? 0.93 : 0.9;
    if (h.x > thresh) {
      vec3 c = cell + 0.5 + (h - 0.5) * 0.7;
      // angular distance from ray to star, in cell units
      vec3 cd = normalize(c);
      float ang = acos(clamp(dot(cd, rd), -1.0, 1.0)) * R;
      float sig = max(pix * R * 0.6, 0.015);
      float b = exp(-ang * ang / (sig * sig)) * (0.08 / (sig * sig)) * 0.02;
      float mag = pow((h.x - thresh) / (1.0 - thresh), 3.0) * (layer == 0 ? 3.0 : 1.0);
      float tw = 0.75 + 0.25 * sin(uTime * (3.0 + 6.0 * h.y) + h.z * 40.0);
      vec3 tint = mix(vec3(1.0, 0.78, 0.55), vec3(0.75, 0.85, 1.0), h.z);
      col += b * mag * tw * tint;
    }
  }
  // faint milky way band
  vec3 axis = normalize(vec3(0.35, 0.55, -0.76));
  float band = exp(-pow(dot(rd, axis) * 4.5, 2.0));
  float dustN = fbm3(vec2(atan(rd.z, rd.x) * 6.0, rd.y * 9.0) + 11.0);
  col += band * (0.0009 + 0.0008 * dustN) * vec3(0.75, 0.8, 1.0) * smoothstep(-0.3, 0.6, dustN + 0.3);
  return col * smoothstep(0.0, 0.18, rd.y);
}

const float TMAX = 3200.0;
const float AP_SCALE = 10.0;   // dusty desert air: aerial-perspective distances scaled up
const float AP_DUST = 2.5;
// clear sky seen through the same dusty layer that hazes the terrain, so the far terrain fades exactly into it
vec3 skyColor(vec3 rd, float pix, out vec3 trans) {
  vec3 rdc = rd; rdc.y = max(rdc.y, 0.002); rdc = normalize(rdc);
  vec3 col = atmosphere(rdc, uSunDir, 1e9, 1.0, trans);
  vec3 hTr;
  vec3 haze = atmosphere(rdc, uSunDir, TMAX * AP_SCALE, AP_DUST, hTr);
  col = col * hTr + haze;
  // sun disc
  float cs = dot(rdc, uSunDir);
  float disc = smoothstep(0.99996 - pix * 0.5, 0.99996, cs);
  col += disc * trans * 22.0 * 600.0 * smoothstep(-0.01, 0.01, uSunDir.y);
  // night base + stars
  col += vec3(0.0006, 0.0009, 0.0018) * uNight;
  col += stars(rd, pix) * uNight * hTr;
  return col;
}

// ---------------------------------------------------------------- shading helpers
float softShadow(vec3 p, vec3 l) {
  if (l.y < -0.05) return 0.0;
  float res = 1.0, t = 0.6;
  for (int i = 0; i < 36; i++) {
    vec3 q = p + l * t;
    float d = q.y - terrain(q.xz);
    res = min(res, 10.0 * d / t);
    if (res < 0.0 || q.y > 75.0) break;
    t += clamp(d * 0.7, 0.4, 28.0);
  }
  return smoothstep(0.0, 1.0, clamp(res, 0.0, 1.0));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 rd = normalize(uCamMat * vec3(uv * uTanHalfFov, 1.0));
  vec3 ro = uCamPos;
  float pix = 2.0 * uTanHalfFov / uRes.y;   // radians per pixel

  // ---- march heightfield
  float t = 0.3, lt = t, ld = 1.0;
  bool hit = false;
  for (int i = 0; i < 220; i++) {
    vec3 p = ro + rd * t;
    float d = p.y - terrain(p.xz);
    if (d < 0.0015 * t) {
      if (d < 0.0) t = lt + (t - lt) * ld / (ld - d); // secant refine
      hit = true; break;
    }
    if (t > TMAX || (rd.y > 0.0 && p.y > 80.0)) break;
    if (i == 219) hit = true;   // ran out of steps while grazing a crest: accept, never punch a hole to the sky
    lt = t; ld = d;
    t += max(d * 0.42, 0.015 + t * 0.002);
  }

  vec3 skyTrans;
  vec3 col;
  if (!hit) {
    col = skyColor(rd, pix, skyTrans);
  } else {
    vec3 p = ro + rd * t;
    // ---- normal from central differences
    float e = max(0.03, t * pix * 1.2);
    float hx = terrain(p.xz + vec2(e, 0)) - terrain(p.xz - vec2(e, 0));
    float hz = terrain(p.xz + vec2(0, e)) - terrain(p.xz - vec2(0, e));
    vec2 grad = vec2(hx, hz) / (2.0 * e);
    float slope = length(grad);
    vec3 nMacro = normalize(vec3(-grad.x, 1.0, -grad.y));

    // ---- wind ripples (shading only), perpendicular to the wind, filtered by pixel footprint
    float foot = t * pix;
    const float RF = 1.0 / 0.55;                    // ripple frequency (1/m)
    float rippleFade = clamp(1.5 - foot * RF * 4.5, 0.0, 1.0);
    float windSlope = dot(grad, WIND);              // >0 windward, <0 lee / slip face
    float rmask = (1.0 - smoothstep(0.28, 0.55, slope)) * (0.55 + 0.45 * smoothstep(-0.1, 0.15, windSlope));
    rmask *= 0.6 + 0.4 * vnoise(p.xz * 0.05);
    vec2 rgrad = vec2(0);
    if (rippleFade * rmask > 0.001) {
      vec2 rw = normalize(WIND + 0.25 * vec2(vnoise(p.xz * 0.02), vnoise(p.xz * 0.02 + 5.0)));
      float warp = 0.9 * vnoise(p.xz * 0.31) + 0.3 * vnoise(p.xz * 1.1 + 3.0);
      float ph = dot(p.xz, rw) * RF + warp;
      float w = 2.0 * PI * ph;
      // asymmetric ripple: sin + harmonic, derivative
      float dh = cos(w) + 0.7 * cos(2.0 * w + 0.6);
      // second, finer set for texture
      float ph2 = dot(p.xz, normalize(rw + vec2(0.0, 0.35))) * RF * 2.7 + 2.0 * warp;
      float fade2 = clamp(1.5 - foot * RF * 2.7 * 4.5, 0.0, 1.0);
      float dh2 = cos(2.0 * PI * ph2) * 0.25 * fade2;
      rgrad = (0.045 * dh * RF * 2.0 * PI) * rw * rippleFade * rmask
            + (0.045 * dh2 * RF * 2.7 * 2.0 * PI) * rw * rippleFade * rmask * 0.4;
    }
    vec3 n = normalize(vec3(-(grad.x + rgrad.x), 1.0, -(grad.y + rgrad.y)));

    // ---- material
    float hN = vnoise(p.xz * 0.013);
    vec3 alb = mix(vec3(0.62, 0.36, 0.19), vec3(0.74, 0.47, 0.27), 0.5 + 0.5 * hN);
    // troughs a touch darker/coarser, crests paler
    float crest = smoothstep(-6.0, 12.0, p.y - 22.0 * fbm3(p.xz * 0.0021 + 3.0));
    alb *= mix(0.86, 1.06, crest);
    alb *= 0.94 + 0.06 * vnoise(p.xz * 3.1);

    // ---- lighting
    vec3 l = uKeyDir;
    float ndl = dot(n, l);
    float sh = ndl > -0.1 ? softShadow(p + nMacro * 0.05, l) : 0.0;
    float diff = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
    // sand back-scatter (rough granular surface brightens toward the light-behind-viewer direction)
    float retro = pow(clamp(dot(-rd, l), 0.0, 1.0), 4.0);
    vec3 direct = uKeyCol * diff * sh * (1.0 + 0.25 * retro) / PI;
    float ao = clamp(0.55 + 0.45 * n.y, 0.0, 1.0) * mix(0.75, 1.0, crest);
    vec3 amb = uSkyAmb * ao * (0.8 + 0.2 * n.y);
    // bounce from lit sand
    vec3 bounce = uKeyCol * alb * 0.06 * clamp(l.y, 0.0, 1.0) * (1.0 - n.y * 0.5) / PI;
    col = alb * (direct + amb + bounce);

    // glitter: sparse quartz facets catching the key light
    vec2 gc = floor(p.xz * 55.0);
    float gh = hash12(gc + floor(rd.xz * 900.0));
    float gl = step(0.9965, gh) * clamp(1.0 - foot * 40.0, 0.0, 1.0);
    vec3 hv = normalize(l - rd);
    col += gl * uKeyCol * sh * pow(clamp(dot(n, hv), 0.0, 1.0), 6.0) * 0.6 * step(0.0, ndl);

    // ---- aerial perspective; near the far limit the surface turns into the clear sky behind it
    vec3 rdf = normalize(vec3(rd.x, max(rd.y, 0.002), rd.z));
    vec3 tr, ctr;
    vec3 ins = atmosphere(rdf, uSunDir, t * AP_SCALE, AP_DUST, tr);
    float farF = smoothstep(TMAX * 0.35, TMAX, t);
    if (farF > 0.0) {
      vec3 clear = atmosphere(rdf, uSunDir, 1e9, 1.0, ctr) + vec3(0.0006, 0.0009, 0.0018) * uNight;
      col = mix(col, clear, farF);
    }
    col = col * tr + ins;
    col += vec3(0.0006, 0.0009, 0.0018) * uNight * (1.0 - tr.b);
  }

  col *= uExposure;
  col = aces(col);
  col = toSRGB(col);
  // triangular dither against banding in the smooth sky gradients
  vec2 fc = gl_FragCoord.xy + mod(uFrame, 64.0) * vec2(17.0, 31.0);
  float dz = hash12(fc) + hash12(fc + vec2(91.0, 37.0)) - 1.0;
  col += dz / 255.0;
  fragColor = vec4(col, 1.0);
}
