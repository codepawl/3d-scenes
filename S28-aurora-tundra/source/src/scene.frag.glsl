// S28 aurora-tundra — single-pass procedural scene.
// Original work by CodePawl, 2026 (MIT). Hash: "hash without sine" style, see CREDITS.md.
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamRot;   // columns: right, up, forward
uniform float uFov;      // tan(fov/2)
uniform int   uAuroraSteps;

out vec4 fragColor;

#define AUR_BOT 110.0
#define AUR_TOP 400.0
#define PI 3.14159265

// ---------------------------------------------------------------- hashes / noise
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// value noise with quintic fade, returns [-1,1]
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
// value noise + analytic derivative (for terrain erosion-ish fbm)
vec3 vnoised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
              du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p = ROT * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

// voronoi: returns (F1, F2-F1 edge distance)
vec2 voronoi(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg, mr; float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j);
    vec2 r = g + hash22(n + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float ed = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = mg + vec2(i, j);
    vec2 r = g + hash22(n + g) - f;
    if (dot(mr - r, mr - r) > 0.00001)
      ed = min(ed, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec2(sqrt(md), ed);
}

// ---------------------------------------------------------------- world layout
// lake mask: 1 inside the frozen lake, 0 on land
float lakeMask(vec2 xz) {
  vec2 q = (xz - vec2(10.0, 230.0)) / vec2(230.0, 210.0);
  float d = length(q);
  if (d > 1.3) return 0.0;              // noise can't pull it back inside
  if (d < 0.55) return 1.0;
  d += 0.18 * fbm(xz * 0.006, 2) + 0.04 * vnoise(xz * 0.05);
  return 1.0 - smoothstep(0.86, 1.0, d);
}

float terrainH(vec2 xz, int oct) {
  float r = length(xz - vec2(10.0, 230.0));
  float lm = lakeMask(xz);
  if (lm > 0.999) return -2.5;
  // rolling tundra
  float h = 0.0, a = 1.0, f = 0.008;
  vec2 dsum = vec2(0);
  vec2 p = xz * f;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    vec3 n = vnoised(p);
    dsum += n.yz;
    h += a * n.x / (1.0 + dot(dsum, dsum)); // derivative damping -> flatter valleys, sharper crests
    p = ROT * p * 2.07 + 3.7;
    a *= 0.48;
  }
  float hills = h * 14.0 + 3.0;
  // distant ridged mountains rising with distance
  float far = smoothstep(380.0, 1100.0, r);
  float hgt = hills;
  if (far > 0.0) {
    float m = 1.0 - abs(vnoise(xz * 0.0024 + 4.0));
    m = m * m;
    m += 0.5 * (1.0 - abs(vnoise(xz * 0.0055 + 9.0))) * m;
    hgt += far * (m * 170.0 + 20.0);
  }
  // lake basin
  hgt = mix(max(hgt, 0.6), -2.5, lm);
  return hgt;
}

// ---------------------------------------------------------------- sky
vec3 skyBase(vec3 rd) {
  float h = max(rd.y, 0.0);
  vec3 zen = vec3(0.0006, 0.0010, 0.0026);
  vec3 hor = vec3(0.0035, 0.0050, 0.0075);   // faint airglow
  return mix(hor, zen, pow(h, 0.45));
}

vec3 starField(vec3 rd, float pix) {
  vec3 col = vec3(0);
  float ext = smoothstep(-0.02, 0.25, rd.y);        // atmospheric extinction
  for (int L = 0; L < 3; L++) {
    float S = 90.0 + float(L) * 170.0;
    vec3 p = rd * S;
    vec3 c = floor(p);
    vec3 h = hash33(c + float(L) * 31.7);
    float thr = 0.95 - float(L) * 0.03;
    if (h.x < thr) continue;
    float bright = pow((h.x - thr) / (1.0 - thr), 4.0) * (1.0 - float(L) * 0.25);
    vec3 sp = c + 0.25 + 0.5 * hash33(c + 7.3);
    vec3 sd = normalize(sp);
    float ang = length(rd - sd);                     // ~angle for small values
    float sig = pix * 0.75;
    float g = exp(-ang * ang / (sig * sig));
    float tw = 0.75 + 0.25 * sin(uTime * (1.5 + 4.0 * h.y) + h.z * 40.0);
    vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.7, 0.82, 1.0), h.y);
    col += tint * g * bright * tw * 0.09 * (uRes.y / 720.0) * (uRes.y / 720.0);
  }
  // faint milky band along a tilted great circle
  vec3 ax = normalize(vec3(0.35, 0.55, -0.75));
  float band = exp(-pow(dot(rd, ax) / 0.16, 2.0));
  vec2 mq = vec2(atan(rd.z, rd.x), rd.y) * 6.0;
  float dust = 0.5 + 0.5 * fbm(mq, 5);
  float lanes = smoothstep(0.1, 0.6, 0.5 + 0.5 * fbm(mq * 2.3 + 5.0, 4));
  col += vec3(0.010, 0.010, 0.013) * band * dust * (0.4 + 0.6 * lanes);
  return col * ext;
}

// aurora emission density at world point; returns rgb emission
float gAurField;
vec3 auroraEmit(vec3 p, float t) {
  vec2 q = p.xz * 0.0019;
  // slow domain warp = drifting folds
  vec2 w = vec2(fbm(q * 1.1 + vec2(t * 0.030, -t * 0.018), 2),
                fbm(q * 1.1 + vec2(4.2 - t * 0.022, 1.7 + t * 0.025), 2));
  vec2 qw = q + w * 0.75;
  // two east-west arcs that fold: zero level sets of (distance to arc + warp noise)
  float fold = 0.85 * vnoise(qw * vec2(1.3, 0.9) + vec2(t * 0.04, 0.0)) + 0.3 * vnoise(qw * 3.3 - t * 0.05);
  float f1 = (p.z - 660.0) * 0.0026 + fold;
  float f2 = (p.z - 1350.0) * 0.0022 + 0.9 * vnoise(qw * 1.1 + 7.0 - t * 0.03);
  float field = abs(f1) < abs(f2) ? f1 : f2;
  float width = 0.045 + 0.03 * fold;
  float sheet = exp(-field * field / (width * width));
  // a soft wider glow around the sheets
  float halo = exp(-field * field / (width * width * 9.0)) * 0.05;

  // lower edge height varies along the curtain
  float bot = AUR_BOT + 35.0 * vnoise(qw * 4.0 + 1.0);
  float hN = (p.y - bot) / (AUR_TOP - bot);
  if (hN < 0.0) return vec3(0);

  // vertical rays: noise in xz only -> constant along y
  vec2 rq = qw * 34.0 + vec2(t * 0.9, 0.0);
  float rays = 0.45 + 0.55 * vnoise(rq) + 0.35 * vnoise(rq * 2.7 - vec2(0.0, t * 1.4));
  rays = clamp(rays, 0.0, 1.5);
  rays = rays * rays * rays * 0.8;

  // intensity modulation along curtains (activity patches that pulse)
  float an = vnoise(qw * 0.7 + 8.0);
  float act = (0.6 + 0.4 * sin(t * 0.5 + 9.0 * an)) * (0.35 + 0.65 * smoothstep(-0.5, 0.3, an + 0.25));

  float d = (sheet * rays + halo) * act;
  float edge = smoothstep(0.0, 0.035, hN);
  float green = edge * exp(-hN * 4.2) * (1.0 + 1.6 * exp(-hN * 16.0));
  float red   = smoothstep(0.15, 0.55, hN) * exp(-max(hN - 0.55, 0.0) * 3.0) * 0.22;
  float pinkfringe = exp(-hN * 55.0) * edge * sheet * sheet * rays;

  vec3 c = vec3(0.10, 1.00, 0.36) * green
         + vec3(0.55, 0.06, 0.40) * red
         + vec3(0.90, 0.15, 0.55) * pinkfringe * 0.6 * act;
  return c * d;
}

vec3 aurora(vec3 ro, vec3 rd, int steps, float jitter) {
  if (rd.y <= 0.01) return vec3(0);
  float t0 = (AUR_BOT - 40.0 - ro.y) / rd.y;
  float t1 = min((AUR_TOP - ro.y) / rd.y, 7000.0);
  if (t1 <= t0) return vec3(0);
  float dt = (t1 - t0) / float(steps);
  vec3 acc = vec3(0);
  float T = uTime * 0.7;   // slow drift
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float t = t0 + (float(i) + jitter) * dt;
    vec3 p = ro + rd * t;
    acc += auroraEmit(p, T) * exp(-t * 0.00035);
  }
  // keep integrated brightness independent of step count / path length
  acc *= dt * 0.026;
  return acc * smoothstep(0.01, 0.12, rd.y);
}

vec3 sky(vec3 ro, vec3 rd, float pix, int steps, float jitter) {
  vec3 a = aurora(ro, rd, steps, jitter);
  vec3 s = starField(rd, pix);
  vec3 base = skyBase(rd);
  // aurora light scattered near horizon
  base += vec3(0.003, 0.012, 0.007) * exp(-max(rd.y, 0.0) * 9.0) * (0.8 + 0.2 * sin(uTime * 0.5));
  return base + s * (1.0 / (1.0 + 30.0 * dot(a, vec3(0.3, 0.6, 0.1)))) + a;
}

// approximate light from the aurora as seen by a surface
vec3 auroraLight(vec3 n) {
  vec3 L = normalize(vec3(-0.2, 0.75, 0.62));
  float pulse = 0.85 + 0.15 * sin(uTime * 0.5);
  vec3 c = vec3(0.006, 0.024, 0.013) * pulse;
  float dif = max(dot(n, L), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  return c * (0.35 * hemi + 0.9 * dif) + vec3(0.0022, 0.0030, 0.0055) * hemi; // + starlight
}

// ---------------------------------------------------------------- terrain
float marchTerrain(vec3 ro, vec3 rd, float tmax, int steps, int oct) {
  float t = 0.5;
  float lastH = 0.0, lastT = t;
  for (int i = 0; i < 160; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float h = p.y - terrainH(p.xz, oct);
    if (h < 0.002 * t) {
      // linear refine between last and current
      return mix(lastT, t, lastH / (lastH - h));
    }
    lastH = h; lastT = t;
    if (rd.y > 0.0 && p.y > 215.0) break;           // above the highest peak, going up
    t += max(h * 0.6, 0.02 + t * 0.004);
    if (t > tmax) break;
  }
  return -1.0;
}

vec3 terrainNormal(vec2 xz, float t) {
  float e = 0.05 + t * 0.002;
  float h = terrainH(xz, 7);
  float hx = terrainH(xz + vec2(e, 0), 7);
  float hz = terrainH(xz + vec2(0, e), 7);
  return normalize(vec3(h - hx, e, h - hz));
}

vec3 shadeTerrain(vec3 p, vec3 rd, float t, float pix) {
  vec3 n = terrainNormal(p.xz, t);
  // micro bumps on snow (wind ripples, fades with distance)
  float fade = 1.0 - smoothstep(20.0, 160.0, t);
  vec2 rp = p.xz * vec2(1.6, 0.6);
  n = normalize(n + fade * 0.18 * vec3(vnoise(rp * 3.0), 0.0, vnoise(rp * 3.0 + 9.0)));

  float slope = 1.0 - n.y;
  float patchy = fbm(p.xz * 0.09, 5);
  float fine = vnoise(p.xz * 1.7);
  // snow cover: thins on steep slopes and wind-scoured crests
  float snow = smoothstep(0.18, 0.05, slope + 0.12 * patchy + 0.05 * fine);
  snow = mix(snow, 1.0, smoothstep(600.0, 1200.0, t) * 0.6);
  // rock / dark lichen + dwarf shrub where exposed
  vec3 rock = mix(vec3(0.05, 0.048, 0.045), vec3(0.11, 0.10, 0.09), 0.5 + 0.5 * fbm(p.xz * 0.6, 3));
  vec3 scrub = vec3(0.06, 0.045, 0.03) * (0.6 + 0.4 * fine);
  vec3 bare = mix(scrub, rock, smoothstep(0.25, 0.45, slope + 0.2 * patchy));
  // grimy snow: old wind crust, dirt specks
  float grime = smoothstep(0.2, 0.8, 0.5 + 0.5 * fbm(p.xz * 0.35 + 3.0, 4));
  vec3 snowAlb = mix(vec3(0.82, 0.86, 0.92), vec3(0.62, 0.64, 0.66), grime * 0.6);
  vec3 alb = mix(bare, snowAlb, snow);

  vec3 col = alb * auroraLight(n);
  // snow sparkle: sparse glints facing the aurora, fades out at distance (AA)
  if (snow > 0.5 && t < 60.0) {
    vec2 sc = floor(p.xz * 14.0);
    float hs = hash12(sc);
    float g = step(0.985, hs) * (0.5 + 0.5 * sin(uTime * 3.0 + hs * 90.0 + dot(rd.xz, vec2(40.0))));
    col += vec3(0.05, 0.12, 0.08) * g * (1.0 - smoothstep(10.0, 60.0, t)) * snow;
  }
  // aerial haze lit by aurora
  float fog = 1.0 - exp(-t * 0.0011);
  vec3 fogc = vec3(0.004, 0.008, 0.009);
  return mix(col, fogc, fog);
}

// ---------------------------------------------------------------- ice
vec3 shadeIce(vec3 p, vec3 rd, float t, float pix, float jitter) {
  vec2 xz = p.xz;
  float fp = pix * t;                // footprint of a pixel in world units
  // frost / blown-snow cover, streaked by wind along x
  vec2 wq = xz * vec2(0.035, 0.11);
  float drift = fbm(wq + 2.0, 5) + 0.25 * fbm(xz * 0.4, 3);
  float snowCov = smoothstep(0.22, 0.5, drift);
  float frost = smoothstep(0.1, 0.55, fbm(xz * 0.21 + 11.0, 4)) * (1.0 - snowCov);

  // cracks: two scales of voronoi edges, AA width from footprint
  float crack = 0.0;
  if (t < 260.0 && snowCov < 0.99) {
  vec2 v1 = voronoi(xz * 0.09);
  vec2 v2 = voronoi(xz * 0.33 + 5.0);
  float w1 = max(0.006, fp * 0.09 * 1.2);
  float w2 = max(0.006, fp * 0.33 * 1.2);
  crack = (1.0 - smoothstep(0.0, w1, v1.y)) * 0.9 * (0.5 + 0.5 * smoothstep(-0.2, 0.3, vnoise(xz * 0.07)));
  crack = max(crack, (1.0 - smoothstep(0.0, w2, v2.y)) * 0.5 * smoothstep(0.0, 0.4, vnoise(xz * 0.15 + 3.0)));
  crack *= (1.0 - snowCov) * (1.0 - smoothstep(80.0, 260.0, t)); // too fine to resolve far away
  }

  // roughness varies: black ice ~0.02, frosted ~0.35, snow 1
  float rough = mix(0.015 + 0.03 * (0.5 + 0.5 * vnoise(xz * 0.5)), 0.35, frost);
  rough = mix(rough, 1.0, snowCov);

  // normal: gentle undulation + micro relief, scaled by roughness and faded with distance
  float fd = 1.0 - smoothstep(30.0, 300.0, t);
  vec3 n = vec3(0, 1, 0);
  n.xz += 0.012 * vec2(vnoise(xz * 0.15), vnoise(xz * 0.15 + 7.0));
  n.xz += fd * (0.006 + rough * 0.06) * vec2(vnoise(xz * 2.3), vnoise(xz * 2.3 + 3.0));
  // per-pixel scatter for rough spots (reads as broken, frosted reflection)
  vec2 hj = hash22(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5;
  n.xz += hj * rough * rough * 0.35;
  n = normalize(n);

  vec3 r = reflect(rd, n);
  r.y = abs(r.y);
  float cosv = clamp(dot(-rd, n), 0.0, 1.0);
  float F = 0.018 + 0.982 * pow(1.0 - cosv, 5.0);

  // reflected environment: terrain silhouette or sky
  vec3 env;
  float tr = marchTerrain(p + vec3(0, 0.05, 0), r, 3000.0, 48, 3);
  if (tr > 0.0) {
    vec3 hp = p + r * tr;
    vec3 hn = terrainNormal(hp.xz, tr * 3.0);
    env = vec3(0.6) * auroraLight(hn);
    float fog = 1.0 - exp(-tr * 0.0011);
    env = mix(env, vec3(0.004, 0.011, 0.009), fog);
  } else {
    env = sky(p, r, pix * (1.0 + rough * 6.0), max(uAuroraSteps / 2, 14), jitter);
  }
  // roughness blurs toward a dim ambient version
  vec3 amb = vec3(0.005, 0.016, 0.010) * (0.85 + 0.15 * sin(uTime * 0.5));
  env = mix(env, amb, smoothstep(0.12, 0.7, rough) * 0.7);

  // what is under the clear ice: deep dark water, trapped bubbles with parallax
  vec3 refr = refract(rd, n, 1.0 / 1.31);
  vec3 under = vec3(0.0015, 0.0035, 0.0040);
  for (int k = 0; k < 2; k++) {
    float depth = 0.12 + 0.3 * float(k);
    vec2 bp = xz + refr.xz / max(-refr.y, 0.05) * depth;
    vec2 cell = floor(bp * 3.0);
    vec2 hb = hash22(cell + float(k) * 17.0);
    vec2 c = (cell + 0.2 + 0.6 * hb) / 3.0;
    float rr = 0.015 + 0.04 * hash12(cell + 3.0);
    float bd = length(bp - c);
    float b = smoothstep(rr, rr - max(0.006, fp), bd) * step(0.85, hb.x);
    under += vec3(0.004, 0.010, 0.009) * b * (1.0 - smoothstep(10.0, 60.0, t));
  }
  under *= (1.0 - frost * 0.5);

  vec3 diffuseIce = vec3(0.55, 0.62, 0.68) * auroraLight(n);
  vec3 snowCol = mix(vec3(0.80, 0.84, 0.90), vec3(0.6, 0.62, 0.64), 0.4 * (0.5 + 0.5 * fbm(xz * 0.6, 3))) * auroraLight(n);

  vec3 col = mix(under, diffuseIce, frost * 0.6) * (1.0 - F) + env * F;
  // cracks: white fractured planes inside the ice, catching aurora light
  col = mix(col, vec3(0.75, 0.85, 0.9) * auroraLight(vec3(0, 1, 0)) * 1.1 + env * 0.05, crack * 0.6);
  col = mix(col, snowCol, snowCov);

  float fog = 1.0 - exp(-t * 0.0006);
  return mix(col, vec3(0.003, 0.007, 0.007), fog);
}

// ---------------------------------------------------------------- main
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 rd = normalize(uCamRot * vec3(uv * uFov, 1.0));
  vec3 ro = uCamPos;
  float pix = 2.0 * uFov / uRes.y;   // angular size of one pixel

  // interleaved gradient noise for march jitter (animated so it averages out in video)
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy + float(int(uTime * 30.0) % 64) * 5.588, vec2(0.06711056, 0.00583715))));

  vec3 col;
  float tIce = rd.y < 0.0 ? -ro.y / rd.y : 1e9;
  float tTer = marchTerrain(ro, rd, min(tIce, 4000.0), 120, 5);
  if (tTer > 0.0) {
    col = shadeTerrain(ro + rd * tTer, rd, tTer, pix);
  } else if (tIce < 4000.0) {
    col = shadeIce(ro + rd * tIce, rd, tIce, pix, ign);
  } else {
    col = sky(ro, rd, pix, uAuroraSteps, ign);
  }

  col *= 2.2;                     // exposure
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  // vignette
  vec2 q = gl_FragCoord.xy / uRes;
  col *= 0.75 + 0.25 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.2);
  // triangular dither against banding in the dark gradients
  float d1 = hash12(gl_FragCoord.xy + 0.37 * fract(uTime));
  float d2 = hash12(gl_FragCoord.yx + 11.3 + 0.71 * fract(uTime));
  col += (d1 + d2 - 1.0) / 255.0;
  fragColor = vec4(col, 1.0);
}
