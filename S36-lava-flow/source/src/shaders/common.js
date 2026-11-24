// Shared GLSL: hashing, noise, Voronoi and the analytic world (basalt slope + lava channel + toes).
// Used by both the vertex and fragment stages so geometry and shading agree exactly.

export const NOISE = /* glsl */ `
// --- Hash without Sine (Dave Hoskins, MIT) ---
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

// --- 2D simplex noise (Ashima Arts / Stefan Gustavson, MIT) ---
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x){ return mod289(((x * 34.0) + 10.0) * x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
float fbm(vec2 p, int oct){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * snoise(p);
    p = ROT * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

// --- Voronoi with true border distance (technique after Inigo Quilez, "Voronoi edges", MIT) ---
// returns x = distance to nearest cell border, y = cell hash, z = hash of the nearest edge (pair of cells)
vec3 voronoiEdge(vec2 x, float jit){
  vec2 n = floor(x), f = fract(x);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = 0.5 + jit * (hash22(n + g) - 0.5);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md){ md = d; mr = r; mg = g; }
  }
  float bd = 8.0; vec2 bg = mg;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = 0.5 + jit * (hash22(n + g) - 0.5);
    vec2 r = g + o - f;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 1e-5){
      float d = dot(0.5 * (mr + r), normalize(dr));
      if (d < bd){ bd = d; bg = g; }
    }
  }
  vec2 ca = n + mg, cb = n + bg;
  return vec3(bd, hash12(ca), hash12(ca + cb + 0.37 * (ca * cb)));
}

// cheap F1 (for vesicles)
float voronoiF1(vec2 x, out float id){
  vec2 n = floor(x), f = fract(x);
  float md = 8.0; id = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md){ md = d; id = hash12(n + g); }
  }
  return sqrt(md);
}
`;

export const WORLD = /* glsl */ `
uniform float uTime;
const float FRONT_Z = -4.2;

float chX(float z){ return 1.6 * sin(z * 0.085 + 0.4) + 0.6 * sin(z * 0.21 + 2.1); }
float chW(float z){ return 1.7 + 0.3 * sin(z * 0.15 + 1.0) + 0.2 * sin(z * 0.37 + 0.3) + 0.25 * smoothstep(10.0, -4.0, z); }

float rockLarge(vec2 p){
  return p.y * 0.30 + 1.0 * snoise(p * 0.03 + vec2(3.1, 1.7)) + 0.4 * snoise(p * 0.08 + vec2(-5.0, 2.0));
}

float rockH(vec2 p){
  float w = chW(p.y);
  float d = (p.x - chX(p.y)) / w;
  // billowy hummocks of older pahoehoe: rounded lobes with sharp creases between them
  vec2 q = p * 0.42 + vec2(1.3, 7.1);
  float b = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ b += a * abs(snoise(q)); q = ROT * q * 2.1 + 5.3; a *= 0.5; }
  float tum = smoothstep(0.2, 0.8, snoise(p * 0.12 + 11.0));
  float mid = (0.55 * b - 0.2 + 0.35 * tum) * (1.0 - 0.6 * exp(-d * d * 0.15));
  float trough = -0.55 * exp(-d * d * 0.6);
  float ad = abs(d) - 1.12;
  float levee = 0.24 * exp(-ad * ad * 7.0) * smoothstep(FRONT_Z - 0.5, FRONT_Z + 2.5, p.y);
  return rockLarge(p) + mid + trough + levee;
}

// toe parameters: centre, radius, growth rate
void toeParams(int i, out vec2 c, out float r, out float grow){
  float fi = float(i);
  float hA = hash11(fi * 7.13 + 1.0), hB = hash11(fi * 3.71 + 5.0), hC = hash11(fi * 9.17 + 2.0);
  float xf = chX(FRONT_Z), wf = chW(FRONT_Z);
  float u = fi / 8.0 * 2.0 - 1.0;
  float g = smoothstep(0.0, 1.0, (uTime - (hC * 26.0 - 14.0)) / 16.0);
  grow = g * (1.0 - g) * 4.0; // how actively it is inflating right now (0..1)
  r = mix(0.38, 0.95, hA) * (0.6 + 0.4 * g);
  c = vec2(xf + u * wf * 1.15 + (hA - 0.5) * 0.6,
           FRONT_Z - 0.35 - 1.5 * hB * (1.0 - 0.45 * abs(u)) - 0.35 * g);
}

float smax(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

// lava surface height; toeW = how much the toe field dominates; toeL = local toe coords (scaled by radius)
float lavaH(vec2 p, out float toeW, out vec3 toeL){
  float xc = chX(p.y), w = chW(p.y);
  float d = (p.x - xc) / (w * 1.02);
  float fz = FRONT_Z + 0.35 * sin(p.x * 2.1 + 0.7) + 0.2 * sin(p.x * 4.3 + 2.0);
  float front = sqrt(clamp((p.y - fz) / 1.3, 0.0, 1.0));
  float prof = sqrt(max(1.0 - d * d, 0.0));
  float base = rockLarge(vec2(xc, p.y)) - 0.45;
  float hc = base + 0.8 * prof * front - 0.5 * (1.0 - front) - 0.3 * max(abs(d) - 1.0, 0.0);
  hc += 0.04 * snoise(vec2(p.x - xc, p.y) * vec2(0.9, 0.5) + 3.0);

  float tb = rockLarge(p) - 0.24;
  float ht = -10.0; toeL = vec3(0.0, 0.0, 0.0);
  for (int i = 0; i < 9; i++){
    vec2 c; float r, g;
    toeParams(i, c, r, g);
    vec2 dd = (p - c) / vec2(r * 1.18, r);
    float q = 1.0 - dot(dd, dd);
    float h = tb + (q > 0.0 ? 0.58 * r * sqrt(q) : -3.0);
    if (h > ht){ ht = h; toeL = vec3(dd, g); }
  }
  float hl = smax(hc, ht, 0.12);
  toeW = smoothstep(-0.06, 0.06, ht - hc);
  return hl;
}
float lavaH(vec2 p){ float a; vec3 b; return lavaH(p, a, b); }
`;
