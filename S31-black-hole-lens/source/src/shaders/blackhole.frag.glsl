// Schwarzschild lensing ray-marcher. Units: Schwarzschild radius r_s = 1 (GM = 1/2, c = 1).
// Original work by CodePawl, 2026. pcg3d hash after Jarzynski & Olano (JCGT 2020).
precision highp float;
precision highp int;

uniform vec2  uRes;
uniform float uTime;       // seconds
uniform float uDiskTime;   // scaled time for disk rotation
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uTanFov;     // tan(vfov/2)
uniform vec2  uJitter;     // sub-pixel jitter in pixels
uniform float uWeight;     // accumulation weight
uniform float uBeamExp;    // Doppler beaming exponent

in vec2 vUv;
out vec4 fragColor;

#define MAX_STEPS 300
#define R_IN  2.6
#define R_OUT 12.5
#define PI 3.14159265

// ---------------------------------------------------------------- hashing / noise
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash33(vec3 p) {
  uvec3 h = pcg3d(uvec3(ivec3(floor(p)) + 1048576));
  return vec3(h) * (1.0 / 4294967295.0);
}
float hash13(vec3 p) { return hash33(p).x; }

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash13(i);
  float b = hash13(i + vec3(1, 0, 0));
  float c = hash13(i + vec3(0, 1, 0));
  float d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1));
  float g = hash13(i + vec3(1, 0, 1));
  float h = hash13(i + vec3(0, 1, 1));
  float k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
             mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}

float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    n += a;
    p = p * 2.07 + vec3(17.1, 3.7, 9.3);
    a *= 0.5;
  }
  return s / n;
}

// ---------------------------------------------------------------- colour
// Planck spectrum sampled at three wavelengths, normalised to unit luminance.
vec3 blackbody(float T) {
  const vec3 lam = vec3(630e-9, 549e-9, 465e-9);
  vec3 x = 1.4388e-2 / (lam * T);
  vec3 b = 1.0 / (pow(lam / 549e-9, vec3(5.0)) * (exp(min(x, vec3(60.0))) - 1.0));
  return b / max(dot(b, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
}

// ---------------------------------------------------------------- accretion disk
// Disk texture in the co-rotating frame. ang = azimuth with rotation removed.
vec3 diskTex(float r, float ang, float seed) {
  float ca = cos(ang), sa = sin(ang);
  // azimuth is stretched relative to radius -> sheared filaments
  vec3 q = vec3(ca * r * 0.55, sa * r * 0.55, r * 1.6) + seed;
  // large clumps / arcs modulate the fine filaments
  float clump = fbm(vec3(ca * 1.3, sa * 1.3, r * 0.45) + seed * 0.37 + 5.0, 3);
  float base = fbm(q, 5) * (0.55 + 0.9 * clump);
  float ridge = 1.0 - abs(2.0 * fbm(q * vec3(1.0, 1.0, 1.9) + 31.0, 4) - 1.0);
  ridge = ridge * ridge * ridge;
  // dust lanes: thin, dark, wider scale
  float lane = fbm(vec3(ca * r * 0.3, sa * r * 0.3, r * 1.1) + seed + 57.0, 3);
  lane = smoothstep(0.52, 0.68, lane);
  // fine grain / clumps
  float grain = vnoise(q * vec3(4.0, 4.0, 3.0) + 101.0);
  return vec3(base, ridge, lane) + vec3(0.0, 0.25 * grain, 0.0);
}

// returns emitted rgb (already * alpha) and alpha
vec4 diskSample(vec3 p, vec3 v, float r) {
  float phi = atan(p.z, p.x);
  float omega = sqrt(0.5 / (r * r * r));          // Keplerian coordinate angular velocity

  // two-phase flow to keep differential-rotation shear bounded
  const float P = 14.0;
  float t0 = mod(uDiskTime, P);
  float t1 = mod(uDiskTime + 0.5 * P, P);
  float w = abs(t0 / P * 2.0 - 1.0);               // 1 at phase reset of t0? -> weight of layer 1
  vec3 A = diskTex(r, phi - omega * (t0 - 0.5 * P), 0.0);
  vec3 B = diskTex(r, phi - omega * (t1 - 0.5 * P), 13.7);
  vec3 tx = mix(A, B, w);

  float base = tx.x, ridge = tx.y, lane = tx.z;

  // radial emissivity (thin-disk profile, zero torque near R_IN)
  float prof = pow(r, -3.0) * max(1.0 - sqrt(R_IN / r), 0.0);
  prof /= 0.0062;                                  // ~1 at peak
  float Tn = pow(prof, 0.25);

  float edge = smoothstep(R_IN, R_IN + 0.5, r) * (1.0 - smoothstep(R_OUT - 4.5 - 2.0 * base, R_OUT, r));

  float outer = smoothstep(5.0, R_OUT, r);
  float dens = (smoothstep(0.22 + 0.18 * outer, 0.7, base) * 1.7 + 0.6 * ridge) * (1.0 - 0.9 * lane);
  float tau = dens * mix(1.8, 0.9, outer) * edge;
  float mu = max(abs(normalize(v).y), 0.04);
  float alpha = 1.0 - exp(-tau / mu);

  // Doppler + gravitational shift
  vec3 ephi = vec3(-sin(phi), 0.0, cos(phi));
  float beta = min(sqrt(0.5 / max(r - 1.0, 0.05)), 0.9);
  float gam = inversesqrt(1.0 - beta * beta);
  float D = 1.0 / (gam * (1.0 + beta * dot(ephi, normalize(v))));
  float g = D * sqrt(max(1.0 - 1.0 / r, 0.0));

  float T = (1900.0 + 5000.0 * Tn) * g;
  float I = prof * (0.25 + 0.9 * ridge + 0.9 * base * base) * (1.0 - 0.75 * lane);
  I *= pow(g, uBeamExp);
  vec3 bb = blackbody(T);
  bb = max(mix(vec3(dot(bb, vec3(0.2126, 0.7152, 0.0722))), bb, 1.45), 0.0); // grade: richer colour
  vec3 col = bb * vec3(1.2, 0.93, 0.72) * I * 0.5;
  return vec4(col * alpha, alpha);
}

// ---------------------------------------------------------------- background sky
// Stars on a cube-face grid, 3x3 neighbour search so nothing is clipped at cell borders.
vec3 starLayer(vec3 d, float N, float density, float px, float seed) {
  vec3 ad = abs(d);
  vec3 fu, fv, fn;
  if (ad.x > ad.y && ad.x > ad.z) { fn = vec3(sign(d.x), 0.0, 0.0); fu = vec3(0.0, 0.0, 1.0); fv = vec3(0.0, 1.0, 0.0); }
  else if (ad.y > ad.z)           { fn = vec3(0.0, sign(d.y), 0.0); fu = vec3(1.0, 0.0, 0.0); fv = vec3(0.0, 0.0, 1.0); }
  else                            { fn = vec3(0.0, 0.0, sign(d.z)); fu = vec3(1.0, 0.0, 0.0); fv = vec3(0.0, 1.0, 0.0); }
  float dn = dot(d, fn);
  vec2 uv = vec2(dot(d, fu), dot(d, fv)) / dn * N;
  vec2 c0 = floor(uv);
  float w0 = 0.0007;                  // intrinsic star width (rad)
  float w = max(w0, px * 0.6);
  float energy = (w0 * w0) / (w * w); // flux-conserving blur when lensing compresses the sky
  vec3 acc = vec3(0.0);
  float fseed = seed + fn.x * 3.0 + fn.y * 5.0 + fn.z * 7.0;
  for (int k = 0; k < 9; k++) {
    vec2 c = c0 + vec2(float(k % 3 - 1), float(k / 3 - 1));
    vec3 h = hash33(vec3(c, fseed));
    if (h.x < density) {
      vec2 sp = (c + 0.1 + 0.8 * fract(h.yz * 13.37 + h.x * 7.1)) / N;
      vec3 sd = normalize(fn + sp.x * fu + sp.y * fv);
      vec3 x = cross(d, sd);
      float m = h.y;
      float mag = pow(m, 18.0) * 7.0 + pow(m, 4.0) * 0.14;
      vec3 tint = mix(vec3(1.0, 0.62, 0.36), vec3(0.72, 0.82, 1.15), fract(h.z * 31.7));
      acc += tint * mag * exp(-dot(x, x) / (w * w));
    }
  }
  return acc * energy;
}

vec3 sky(vec3 d, float px) {
  vec3 col = vec3(0.0);
  col += starLayer(d, 40.0, 0.30, px, 0.0);
  col += starLayer(d, 95.0, 0.22, px, 300.0) * 0.45;
  col += starLayer(d, 210.0, 0.14, px, 900.0) * 0.22;

  // galactic band with dust lanes
  vec3 bandN = normalize(vec3(0.25, 1.0, -0.35));
  float b = dot(d, bandN);
  float band = exp(-b * b / 0.03);
  float neb = fbm(d * 3.0 + 4.0, 5);
  float dust = smoothstep(0.42, 0.72, fbm(d * 7.0 + 19.0, 5));
  vec3 haze = mix(vec3(0.60, 0.40, 0.28), vec3(0.30, 0.36, 0.60), neb) * band * (0.25 + neb) * (1.0 - 0.9 * dust);
  col += haze * 0.045;
  col += vec3(0.0015, 0.0018, 0.003) * (0.5 + neb);   // very faint floor
  return col;
}

// ---------------------------------------------------------------- main
void main() {
  vec2 fc = gl_FragCoord.xy + uJitter;
  vec2 uv = (fc - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 rd = normalize(uCamFwd + uv.x * uTanFov * uCamRight + uv.y * uTanFov * uCamUp);

  vec3 p = uCamPos;
  vec3 v = rd;
  vec3 L = cross(p, v);
  float h2 = dot(L, L);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float escaped = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = length(p);
    float dt = clamp(0.065 * r, 0.012, 2.5);
    vec3 a = -1.5 * h2 * p / pow(r, 5.0);
    vec3 vn = v + a * dt;
    vec3 pn = p + vn * dt;

    if (p.y * pn.y < 0.0) {
      float f = p.y / (p.y - pn.y);
      vec3 pc = mix(p, pn, f);
      float rc = length(pc);
      if (rc > R_IN && rc < R_OUT) {
        vec4 ds = diskSample(pc, vn, rc);
        col += trans * ds.rgb;
        trans *= 1.0 - ds.a;
      }
    }
    p = pn; v = vn;
    float rn = length(p);
    if (rn < 1.0 || trans < 0.004) break;
    if (rn > 50.0 && dot(p, v) > 0.0) { escaped = 1.0; break; }
  }

  vec3 dir = normalize(v);
  // angular pixel footprint of the bent ray (outside any branch so derivatives are valid)
  float px = length(fwidth(dir));
  px = clamp(px, 0.0, 0.05);
  if (escaped > 0.5) col += trans * sky(dir, px);

  fragColor = vec4(col * uWeight, uWeight);
}
