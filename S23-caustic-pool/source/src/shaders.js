// All GLSL for the caustic pool. Original work, CodePawl, 2026 (MIT).
// Units: metres. Pool interior x in [-HX, HX], z in [-HZ, HZ], floor y = 0, water surface y = SURF.

export const POOL = { HX: 7.0, HZ: 3.5, SURF: 2.0, TOP: 2.35 };

const common = /* glsl */ `
#define HX ${POOL.HX.toFixed(3)}
#define HZ ${POOL.HZ.toFixed(3)}
#define SURF ${POOL.SURF.toFixed(3)}
#define PI 3.14159265
#define NW 11

uniform float uTime;
uniform vec3 uSunW;      // refracted sun direction in water (pointing DOWN, normalised)
uniform vec3 uCamPos;

// Water absorption (1/m) per channel and scattering albedo colour.
const vec3 SIGMA_T = vec3(0.42, 0.075, 0.045);
const vec3 SUN_COL = vec3(1.0, 0.96, 0.88) * 3.2;
const vec3 DEEP_COL = vec3(0.020, 0.115, 0.165);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
// Interleaved gradient noise (screen-space dither), Jimenez 2014.
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

// ---- Water surface: sum of directional sine waves with analytic gradient + Hessian ----
// Returns height in .x; gradient (dh/dx, dh/dz) and Hessian (hxx, hxz, hzz) via out params.
void waves(vec2 p, int count, out float h, out vec2 g, out vec3 H) {
  h = 0.0; g = vec2(0.0); H = vec3(0.0);
  float L = 2.3;
  for (int i = 0; i < NW; i++) {
    if (i >= count) break;
    float fi = float(i);
    float ang = fi * 2.39996 + 0.7 + 0.35 * sin(fi * 1.7);
    vec2 d = vec2(cos(ang), sin(ang));
    float k = 2.0 * PI / L;
    float w = sqrt(9.81 * k);                // deep-water dispersion
    float a = (0.050 + 0.012 * sin(fi * 3.1)) / k; // steepness / k
    float th = k * dot(d, p) - w * uTime * 0.55 + fi * 1.913;
    float s = sin(th), c = cos(th);
    h += a * s;
    g += a * k * c * d;
    float ak2s = -a * k * k * s;
    H += ak2s * vec3(d.x * d.x, d.x * d.y, d.y * d.y);
    L *= 0.79;
  }
}

// Ray-density caustic: a sun ray refracted at surface point s is displaced on a receiver at depth D by
// D * c * grad h(s) (small-slope approx, c = 1 - 1/n). Intensity = 1 / |det(I + D c Hess h)|.
// eps softens the singular folds (and is raised with pixel footprint to avoid aliasing).
vec3 caustic(vec3 p, int count, float eps) {
  float D = max(SURF - p.y, 0.0);
  vec2 s = p.xz - uSunW.xz * (D / -uSunW.y);
  float h; vec2 g; vec3 H;
  waves(s, count, h, g, H);
  // per-channel refraction (exaggerated dispersion) -> chromatic fringes on caustic edges
  vec3 c = vec3(0.243, 0.252, 0.263) * D;
  vec3 a = 1.0 + c * H.x;
  vec3 d = 1.0 + c * H.z;
  vec3 det = a * d - c * c * H.y * H.y;
  vec3 I = 1.0 / sqrt(det * det + eps * eps);
  // fade-in with depth: no focusing right under the surface
  return mix(vec3(1.0), I, smoothstep(0.0, 0.25, D));
}

float hgPhase(float cosT, float gg) {
  float d = 1.0 + gg * gg - 2.0 * gg * cosT;
  return (1.0 - gg * gg) / (4.0 * PI * d * sqrt(d));
}

// Light reaching point p from the sun through the water column.
vec3 sunAtten(vec3 p) {
  float D = max(SURF - p.y, 0.0);
  return exp(-SIGMA_T * D / -uSunW.y);
}

// Participating medium between camera and a surface at distance t along rd:
// Beer-Lambert extinction + ambient in-scatter + marched single-scatter sun shafts.
vec3 applyMedium(vec3 col, vec3 ro, vec3 rd, float t, vec2 fragPx) {
  vec3 T = exp(-SIGMA_T * t);
  vec3 amb = DEEP_COL * (0.55 + 0.45 * smoothstep(-0.6, 0.8, rd.y));
  vec3 res = col * T + amb * (1.0 - T);
  // shafts
  const int NS = 14;
  float tMax = min(t, 16.0);
  float dt = tMax / float(NS);
  float j = ign(fragPx);
  float ph = hgPhase(dot(rd, uSunW), 0.55);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < NS; i++) {
    float ts = (float(i) + j) * dt;
    vec3 q = ro + rd * ts;
    vec3 cq = caustic(q, 5, 0.55);
    vec3 lit = SUN_COL * sunAtten(q) * (cq * cq * cq);
    acc += lit * exp(-SIGMA_T * ts) * dt;
  }
  res += acc * ph * vec3(0.10, 0.17, 0.19) * 3.0;
  return res;
}
`;

const vsWorld = /* glsl */ `
varying vec3 vPos;
varying vec3 vNrm;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vNrm = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// ------------------------------------------------------------------------------------------------
// Pool shell: floor + walls with procedural mosaic, glaze fresnel, caustics.
// ------------------------------------------------------------------------------------------------
export const poolShader = {
  vertexShader: vsWorld,
  fragmentShader: /* glsl */ `
${common}
varying vec3 vPos;
varying vec3 vNrm;

// cheap underwater environment for glaze reflections
vec3 envUnder(vec3 r) {
  vec3 base = DEEP_COL * 1.4;
  float up = smoothstep(-0.1, 0.9, r.y);
  vec3 col = mix(base * 0.6, vec3(0.10, 0.42, 0.52), up);
  // Snell's window: bright disc straight up (critical angle ~48.6 deg)
  float win = smoothstep(0.62, 0.70, r.y);
  col += win * vec3(0.55, 0.85, 1.0) * 1.6;
  return col;
}

// Tile pattern. uv in metres on the wall/floor plane.
// returns albedo; out: tile-space normal offset (xy), grout mask, tile id hash
vec3 mosaic(vec2 uv, vec2 fw, int face, out vec2 nOff, out float grout, out float rough) {
  float S = 0.125;               // tile pitch
  vec2 cuv = uv / S;
  vec2 id = floor(cuv);
  vec2 f = fract(cuv) - 0.5;     // [-0.5,0.5]
  vec2 fwc = fw / S;             // footprint in cell units
  float gw = 0.045;              // grout half-width (cell units)
  vec2 e = 0.5 - abs(f);         // distance to cell edge
  // filtered grout mask
  vec2 gm = smoothstep(gw - fwc, gw + fwc, e);
  grout = 1.0 - gm.x * gm.y;
  // rounded bevel: normal tilts near the edge; fade when footprint is larger than the bevel
  float bev = 0.16;
  vec2 b = 1.0 - smoothstep(gw, gw + bev, e);
  float bfade = 1.0 - smoothstep(0.08, 0.35, max(fwc.x, fwc.y));
  nOff = sign(f) * b * b * 0.75 * bfade;
  // hand-laid jitter: each tile slightly tilted
  vec3 r = hash32(id + float(face) * 17.0);
  nOff += (r.xy - 0.5) * 0.10 * (1.0 - grout);

  // colour palette: pale aqua glazed mosaic with variation
  vec3 c1 = vec3(0.70, 0.86, 0.88);
  vec3 c2 = vec3(0.55, 0.78, 0.84);
  vec3 c3 = vec3(0.86, 0.93, 0.92);
  vec3 alb = r.z < 0.45 ? c1 : (r.z < 0.8 ? c2 : c3);
  alb *= 0.9 + 0.2 * hash12(id * 1.37 + 3.1);
  rough = 0.18 + 0.12 * r.x;
  return alb;
}

void main() {
  vec3 N = normalize(vNrm);
  vec3 P = vPos;
  vec3 V = normalize(uCamPos - P);
  int face;
  vec2 uv; vec3 T, B;
  if (N.y > 0.5) { face = 0; uv = P.xz; T = vec3(1,0,0); B = vec3(0,0,1); }
  else if (abs(N.x) > 0.5) { face = 1; uv = vec2(P.z, P.y); T = vec3(0,0,1); B = vec3(0,1,0); }
  else { face = 2; uv = vec2(P.x, P.y); T = vec3(1,0,0); B = vec3(0,1,0); }
  vec2 fw = max(fwidth(uv), vec2(1e-5));

  vec2 nOff; float grout; float rough;
  vec3 alb = mosaic(uv + 0.0625, fw, face, nOff, grout, rough);

  // ---- markings (dark blue lanes / end targets / waterline band) ----
  vec3 navy = vec3(0.05, 0.12, 0.30);
  float tile = 0.125;
  // snap marks to whole tiles so they follow the grout grid
  vec2 tc = (floor((uv + 0.0625) / tile) + 0.5) * tile - 0.0625;
  float mark = 0.0;
  if (face == 0) {
    for (int l = -1; l <= 1; l++) {
      float zc = float(l) * 2.333;
      float lane = step(abs(tc.y - zc), 0.13) * step(abs(tc.x), HX - 2.0);
      float tbar = step(abs(tc.y - zc), 0.52) * step(abs(abs(tc.x) - (HX - 2.0)), 0.13);
      mark = max(mark, max(lane, tbar));
    }
  } else if (face == 1) {
    for (int l = -1; l <= 1; l++) {
      float zc = float(l) * 2.333;
      float v = step(abs(tc.x - zc), 0.13) * step(0.30, tc.y) * step(tc.y, 1.55);
      float hbar = step(abs(tc.x - zc), 0.40) * step(abs(tc.y - 1.20), 0.13);
      mark = max(mark, max(v, hbar));
    }
  }
  // waterline band on every wall
  if (face != 0) mark = max(mark, step(SURF - 0.32, tc.y));
  alb = mix(alb, navy * (0.85 + 0.3 * hash12(floor(uv / tile) + 9.0)), mark);

  vec3 groutCol = vec3(0.62, 0.66, 0.64);
  alb = mix(alb, groutCol, grout);
  rough = mix(rough, 0.8, grout);

  vec3 Nt = normalize(N + T * nOff.x + B * nOff.y);
  if (dot(Nt, V) < 0.02) Nt = N;

  // ---- lighting ----
  vec3 L = -uSunW;
  float fp = length(fwidth(P));
  vec3 C = caustic(P, NW, 0.06 + fp * 5.0);
  float NdL = max(dot(Nt, L), 0.0);
  vec3 sunE = SUN_COL * sunAtten(P) * C;

  // ambient from above (Snell's window skylight scattered down), with corner occlusion
  float dWall = min(HX - abs(P.x), HZ - abs(P.z));
  float ao;
  if (N.y > 0.5) ao = mix(0.6, 1.0, smoothstep(0.0, 0.8, dWall));
  else ao = mix(0.6, 1.0, smoothstep(0.0, 0.8, P.y)) * mix(0.75, 1.0, smoothstep(0.0, 0.6, dWall));
  vec3 skyE = vec3(0.30, 0.55, 0.62) * exp(-SIGMA_T * (SURF - P.y) * 1.2) * (0.6 + 0.4 * Nt.y) * ao;

  vec3 diffuse = alb * (sunE * NdL * 0.75 + skyE * 0.8) / PI * 2.2;

  // glaze: dielectric clear-coat. In water, glaze n=1.5 vs water 1.333 gives tiny F0 physically;
  // we use a slightly stronger value so the fresnel sheen of every tilted tile reads on screen.
  float NdV = max(dot(Nt, V), 0.0);
  float F0 = 0.03;
  float F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  F *= (1.0 - grout * 0.9);
  vec3 R = reflect(-V, Nt);
  vec3 refl = envUnder(R) * ao;
  // sun glint (GGX) on the glaze, modulated by caustic focus -> sparkles
  vec3 Hh = normalize(L + V);
  float NdH = max(dot(Nt, Hh), 0.0);
  float a2 = rough * rough; a2 *= a2;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float Dg = a2 / (PI * dd * dd);
  vec3 spec = sunE * Dg * NdL * (F0 + (1.0 - F0) * pow(1.0 - max(dot(Hh, V), 0.0), 5.0)) * 0.25;

  vec3 col = mix(diffuse, refl, F) + spec * (1.0 - grout);

  float t = length(P - uCamPos);
  col = applyMedium(col, uCamPos, -V, t, gl_FragCoord.xy);
  gl_FragColor = vec4(col, 1.0);
}
`,
};

// ------------------------------------------------------------------------------------------------
// Water surface seen from below: Snell's window vs total internal reflection.
// ------------------------------------------------------------------------------------------------
export const surfaceShader = {
  vertexShader: vsWorld,
  fragmentShader: /* glsl */ `
${common}
varying vec3 vPos;
varying vec3 vNrm;
void main() {
  vec3 P = vPos;
  float h; vec2 g; vec3 H;
  waves(P.xz, 8, h, g, H);
  vec3 Nup = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 n = -Nup;                      // facing the camera (below)
  vec3 rd = normalize(P - uCamPos);
  float eta = 1.333;
  vec3 tr = refract(rd, n, eta);
  float cosI = max(dot(-rd, n), 0.0);
  // fresnel water->air
  float F0 = 0.02;
  float F = F0 + (1.0 - F0) * pow(1.0 - cosI, 5.0);
  vec3 refl = reflect(rd, n);
  // reflected view: underside mirrors the pale pool shell, dimmed by depth
  vec3 reflCol = mix(vec3(0.06, 0.30, 0.36), vec3(0.03, 0.16, 0.22), smoothstep(0.0, -0.6, refl.y));
  reflCol *= 0.9 + 0.25 * caustic(vec3(P.x, 0.0, P.z), 5, 0.4).g;
  vec3 col;
  if (dot(tr, tr) < 1e-4) {
    col = reflCol;                    // total internal reflection
  } else {
    float sky = clamp(tr.y, 0.0, 1.0);
    vec3 skyCol = mix(vec3(0.85, 0.93, 1.0), vec3(0.35, 0.62, 0.95), sky) * 2.2;
    vec3 sunAir = normalize(vec3(0.5, 0.866, 0.15));
    skyCol += vec3(1.0, 0.95, 0.85) * 60.0 * pow(max(dot(tr, sunAir), 0.0), 900.0);
    col = mix(skyCol, reflCol, F);
  }
  float t = length(P - uCamPos);
  col = applyMedium(col, uCamPos, rd, t, gl_FragCoord.xy);
  gl_FragColor = vec4(col, 1.0);
}
`,
};

// ------------------------------------------------------------------------------------------------
// Post: ACES filmic tonemap, subtle chromatic aberration + vignette, dither against banding.
// ------------------------------------------------------------------------------------------------
export const postShader = {
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`,
  fragmentShader: /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uRes;
uniform float uFrame;
uniform float uExposure;
varying vec2 vUv;
vec3 aces(vec3 x) {
  // Narkowicz 2015 ACES fit
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  vec2 off = d * r2 * 0.012;
  vec3 c;
  c.r = texture2D(tColor, vUv - off).r;
  c.g = texture2D(tColor, vUv).g;
  c.b = texture2D(tColor, vUv + off).b;
  c *= uExposure;
  c *= mix(1.0, 0.62, smoothstep(0.08, 0.55, r2 * 1.6));
  c = aces(c);
  c = toSRGB(c);
  float n = ign(gl_FragCoord.xy + vec2(uFrame * 5.588, uFrame * 3.17)) + ign(gl_FragCoord.yx + 7.0) - 1.0;
  c += n / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`,
};
