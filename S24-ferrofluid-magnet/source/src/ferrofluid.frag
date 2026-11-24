// S24 ferrofluid-magnet — sphere-traced ferrofluid over a moving magnet.
// Original work by CodePawl, 2026 (MIT). sdCone/smin/hex-grid follow
// Inigo Quilez's published formulas (MIT), see CREDITS.md.
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMag;     // x: magnet position now, y: lagged position the fluid responds to
uniform vec3 uCamPos;
uniform vec3 uCamTgt;
uniform float uSeed;

out vec4 fragColor;

#define PI 3.14159265359
const float CELL     = 0.125;  // spike lattice pitch
const float FLOOR_Y  = -0.36;
const float MAG_R    = 0.30;
const float MAG_TOP  = -0.035;
const float BOX_TOP  = 0.62;
const float PUD_R    = 0.85;
const vec3  LIGHT    = normalize(vec3(0.25, 1.0, 0.35));

float gMx, gMxL;
vec2  gPc, gLat;

// ------------------------------------------------------------------ utils
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
// iq: exact cone, tip at origin, q = (base radius, -height)
float sdCone(vec3 p, vec2 q) {
  vec2 w = vec2(length(p.xz), p.y);
  vec2 a = w - q * clamp(dot(w, q) / dot(q, q), 0.0, 1.0);
  vec2 b = w - q * vec2(clamp(w.x / q.x, 0.0, 1.0), 1.0);
  float k = sign(q.y);
  float d = min(dot(a, a), dot(b, b));
  float s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));
  return sqrt(d) * sign(s);
}
// nearest hexagon centre (unit pitch)
vec2 hexCenter(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? hc.xy * s : (hc.zw + 0.5) * s;
}

// ------------------------------------------------------------ fluid SDF
// magnet field strength at the plate surface (dipole-like falloff)
float field(vec2 q) {
  vec2 d = q - vec2(gMxL, 0.0);
  float f = 1.0 + dot(d, d) / 0.17;
  return 1.0 / (f * f);
}
float puddleMask(vec2 q) {
  vec2 d = q - gPc;
  d.x *= 0.92;  // stretched toward the magnet
  return smoothstep(PUD_R + 0.02, PUD_R - 0.12, length(d));
}
float puddleH(vec2 q) {
  float m = puddleMask(q);
  float f = field(q);
  // faint slow swell so the flat pool carries moving reflections
  float sw = sin(q.x * 5.3 + uTime * 0.9) * sin(q.y * 4.1 - uTime * 0.7) + 0.5 * sin((q.x + q.y) * 9.0 - uTime * 1.3);
  return mix(-0.05, 0.026 + 0.15 * f + 0.0016 * sw, m);
}
float spikeHeight(vec2 c, vec2 id) {
  float f = field(c);
  vec2 d = c - gPc; d.x *= 0.92;
  float m = smoothstep(PUD_R - 0.08, PUD_R - 0.32, length(d));
  float r = hash12(id + 17.0);
  float s = 0.42 * smoothstep(0.16, 0.95, f) * m * (0.88 + 0.24 * r);
  // slight capillary shiver while the field changes
  s *= 1.0 + 0.035 * sin(uTime * 8.0 + r * 6.2832) * smoothstep(0.0, 0.1, s);
  return s;
}
float spike(vec3 p, vec2 id) {
  vec2 c = id * CELL + gLat;
  float S = spikeHeight(c, id);
  if (S < 0.012) return 1e3;
  float y0 = puddleH(c) - 0.02;
  float rb = CELL * (0.26 + 0.36 * smoothstep(0.0, 0.3, S));
  vec3 w = vec3(p.x - c.x, p.y - (y0 + S), p.z - c.y);
  return sdCone(w, vec2(rb, -S)) - 0.003;
}
float map(vec3 p) {
  float dH = (p.y - puddleH(p.xz)) * 0.62;
  if (p.y > BOX_TOP) return min(dH, p.y - BOX_TOP + 0.02);
  // own hex cell plus the two neighbours bracketing the point, so blends never crease at cell borders
  vec2 lp = (p.xz - gLat) / CELL;
  vec2 id = hexCenter(lp);
  vec2 l = lp - id;
  float a = atan(l.y, l.x);
  float k = floor(a / (PI / 3.0));
  float a1 = k * (PI / 3.0), a2 = a1 + PI / 3.0;
  float d = dH;
  d = smin(d, spike(p, id), 0.05);
  d = smin(d, spike(p, id + vec2(cos(a1), sin(a1))), 0.05);
  d = smin(d, spike(p, id + vec2(cos(a2), sin(a2))), 0.05);
  return d;
}
vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0012;
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
                   k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}
// ray vs fluid bounding slab; returns (tmin, tmax)
vec2 boxRange(vec3 ro, vec3 rd) {
  vec3 bmin = vec3(-2.2, 0.0, -1.6), bmax = vec3(2.2, BOX_TOP, 1.6);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  return vec2(max(max(tn.x, tn.y), max(tn.z, 0.0)), min(min(tf.x, tf.y), tf.z));
}
float marchFluid(vec3 ro, vec3 rd, int steps) {
  vec2 r = boxRange(ro, rd);
  if (r.x > r.y) return -1.0;
  float t = r.x;
  for (int i = 0; i < 160; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0003 * (1.0 + t)) return t;
    t += min(d, 0.05);
    if (t > r.y) break;
  }
  return -1.0;
}
float softShadow(vec3 ro, vec3 rd, float k) {
  vec2 r = boxRange(ro, rd);
  if (r.x > r.y) return 1.0;
  float res = 1.0, t = max(r.x, 0.01);
  for (int i = 0; i < 40; i++) {
    float h = map(ro + rd * t);
    res = min(res, k * h / t);
    if (res < 0.002) break;
    t += clamp(h, 0.012, 0.12);
    if (t > r.y) break;
  }
  return clamp(res, 0.0, 1.0);
}
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.012 + 0.05 * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.75;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

// ------------------------------------------------------------ studio env
float panel(vec2 uv, vec2 c, vec2 hs, float soft) {
  vec2 d = abs(uv - c) - hs;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, o);
}
vec3 env(vec3 d, float rough) {
  float soft = 0.012 + rough * 0.6;
  // dark cyclorama with a faint horizon glow
  vec3 col = mix(vec3(0.012, 0.013, 0.015), vec3(0.05, 0.052, 0.058), smoothstep(-0.2, 0.6, d.y));
  col += vec3(0.10, 0.095, 0.09) * exp(-abs(d.y) * 9.0);
  col += vec3(0.16, 0.16, 0.17) * smoothstep(0.45, 0.0, abs(d.y - 0.12)); // lit cyc wall band
  col += vec3(0.11, 0.11, 0.12) * smoothstep(0.25, 1.0, d.y); // ceiling bounce
  // overhead softbox
  if (d.y > 0.0) {
    vec2 uv = d.xz / d.y;
    col += vec3(1.0, 0.98, 0.95) * 5.0 * panel(uv, vec2(-0.1, 0.15), vec2(0.55, 0.28), soft * 1.5);
    col += vec3(1.0) * 1.6 * panel(uv, vec2(0.0, -0.9), vec2(1.2, 0.08), soft);
  }
  // warm key strip, left
  if (d.x < 0.0) {
    vec2 uv = d.zy / -d.x;
    col += vec3(1.0, 0.82, 0.62) * 7.0 * panel(uv, vec2(0.25, 0.5), vec2(0.13, 0.55), soft);
  }
  // cool rim strip, back right
  if (d.z < 0.0) {
    vec2 uv = d.xy / -d.z;
    col += vec3(0.62, 0.78, 1.0) * 6.0 * panel(uv, vec2(0.75, 0.35), vec2(0.1, 0.5), soft);
    col += vec3(0.8, 0.85, 0.9) * 1.2 * panel(uv, vec2(-0.9, 0.2), vec2(0.3, 0.25), soft * 2.0);
  }
  // fill card, front right (camera side)
  if (d.z > 0.0) {
    vec2 uv = d.xy / d.z;
    col += vec3(0.9, 0.92, 1.0) * 0.9 * panel(uv, vec2(1.1, 0.4), vec2(0.35, 0.4), soft * 2.0);
  }
  return col;
}

// ------------------------------------------------- below the glass plate
float iCylinder(vec3 ro, vec3 rd, vec2 c, out vec3 n) {
  // vertical cylinder radius MAG_R, y in [FLOOR_Y, MAG_TOP]
  float tBest = 1e9;
  vec2 oc = ro.xz - c;
  float a = dot(rd.xz, rd.xz), b = dot(oc, rd.xz), cc = dot(oc, oc) - MAG_R * MAG_R;
  float h = b * b - a * cc;
  if (h > 0.0 && a > 1e-6) {
    float t = (-b - sqrt(h)) / a;
    float y = ro.y + rd.y * t;
    if (t > 0.0 && y > FLOOR_Y && y < MAG_TOP) {
      tBest = t;
      n = vec3((oc + rd.xz * t) / MAG_R, 0.0).xzy;
    }
  }
  if (abs(rd.y) > 1e-5) {
    float t = (MAG_TOP - ro.y) / rd.y;
    vec2 q = ro.xz + rd.xz * t - c;
    if (t > 0.0 && t < tBest && dot(q, q) < MAG_R * MAG_R) { tBest = t; n = vec3(0, 1, 0); }
  }
  return tBest;
}
vec3 floorShade(vec3 p) {
  vec2 mc = vec2(gMx, 0.0);
  float dc = length(p.xz - mc) - MAG_R;
  float ao = 0.35 + 0.65 * smoothstep(0.0, 0.3, dc);
  // magnet's cast shadow from the key
  vec3 nn;
  float sm = iCylinder(p + vec3(0, 0.001, 0), LIGHT, mc, nn) < 1e8 ? 0.0 : 1.0;
  // fluid's shadow through the glass (soft, it is far above)
  float sf = 0.25 + 0.75 * softShadow(p, LIGHT, 2.5);
  float falloff = exp(-dot(p.xz, p.xz) * 0.11);
  float grain = 0.94 + 0.06 * hash12(floor(p.xz * 400.0));
  vec3 alb = vec3(0.40, 0.39, 0.37) * grain;
  vec3 irr = vec3(1.25) * sm * sf + vec3(0.32);
  return alb * irr * ao * falloff;
}
vec3 magnetShade(vec3 p, vec3 n, vec3 rd) {
  vec3 r = reflect(rd, n);
  float nv = max(dot(n, -rd), 0.0);
  vec3 F0 = vec3(0.66, 0.63, 0.58);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - nv, 5.0);
  vec3 refl = r.y < 0.0 ? vec3(0.22, 0.21, 0.2) * (0.4 + 0.6 * smoothstep(-0.6, 0.0, r.y)) + env(r, 0.25) * 0.3 : env(r, 0.22);
  if (r.y > 0.0) refl *= mix(1.0, 0.25, 1.0 - softShadow(p, r, 3.0)); // fluid seen from below
  float ao = 0.55 + 0.45 * smoothstep(FLOOR_Y, FLOOR_Y + 0.1, p.y);
  // fine lathe rings on the top face
  if (n.y > 0.5) refl *= 0.92 + 0.08 * sin(length(p.xz - vec2(gMx, 0.0)) * 520.0);
  return refl * F * ao;
}
vec3 belowScene(vec3 ro, vec3 rd) {
  vec3 n;
  float tc = iCylinder(ro, rd, vec2(gMx, 0.0), n);
  float tf = (FLOOR_Y - ro.y) / rd.y;
  if (tc < tf) return magnetShade(ro + rd * tc, n, rd);
  return floorShade(ro + rd * tf);
}

// --------------------------------------------------------------- shading
float fresnel(float f0, float nv) { return f0 + (1.0 - f0) * pow(1.0 - nv, 5.0); }

// one secondary bounce: other spikes, the glass below, or the studio
vec3 fluidReflect(vec3 p, vec3 r, float rough) {
  float t = marchFluid(p, r, 48);
  if (t > 0.0) {
    vec3 q = p + r * t;
    vec3 n = calcNormal(q);
    return env(reflect(r, n), 0.05) * fresnel(0.07, max(dot(n, -r), 0.0));
  }
  if (r.y < 0.0) {
    // plate + lit floor seen from above (cheap, no shadows)
    vec3 q = p + r * ((FLOOR_Y - p.y) / r.y);
    return vec3(0.17, 0.168, 0.16) * exp(-dot(q.xz, q.xz) * 0.11) + env(reflect(r, vec3(0, 1, 0)), 0.02) * 0.04;
  }
  return env(r, rough);
}

// glass plate footprint (rounded rectangle) and its signed distance
const vec2 PLATE_HS = vec2(1.9, 1.25);
float plateSD(vec2 q) {
  vec2 d = abs(q) - PLATE_HS + 0.08;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.08;
}

vec3 render(vec3 ro, vec3 rd) {
  float t = marchFluid(ro, rd, 140);
  vec3 col = vec3(0.0);
  vec3 rO = vec3(0.0), rD = vec3(0.0);
  float rW = 0.0, rough = 0.03;
  vec3 bO = ro;      // origin for the under-glass view
  float bW = 0.0;    // its weight
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float nv = max(dot(n, -rd), 0.0);
    float ao = calcAO(p, n);
    float sh = softShadow(p + n * 0.004, LIGHT, 10.0);
    col = vec3(0.010, 0.010, 0.011) * (max(dot(n, LIGHT), 0.0) * sh + 0.25 * ao); // near-black body
    rO = p + n * 0.004; rD = reflect(rd, n);
    rW = fresnel(0.07, nv) * (0.35 + 0.65 * ao);
  } else if (rd.y < 0.0) {
    float tp = -ro.y / rd.y;
    vec3 p = ro + rd * tp;
    float sd = plateSD(p.xz);
    if (sd < 0.0) {
      float F = fresnel(0.04, -rd.y);
      float px = 1.5 * tp / uRes.y;
      float edge = 1.0 - smoothstep(0.0, 0.012 + px, -sd);
      float smudge = 0.85 + 0.15 * hash12(floor(p.xz * 37.0) + 3.0);
      bO = p; bW = (1.0 - F) * (1.0 - edge);
      rO = p + vec3(0.0, 0.001, 0.0); rD = reflect(rd, vec3(0, 1, 0)); rough = 0.01;
      rW = F * smudge * (1.0 - edge);
      // polished bevel catching the studio
      col = edge * (vec3(0.07) + 0.5 * env(normalize(vec3(sign(p.x) * 0.5, 0.6, sign(p.z) * 0.5)), 0.1));
    } else {
      bW = 1.0;
    }
  } else {
    return env(rd, 0.0);
  }
  if (bW > 0.0) col += bW * belowScene(bO, rd) * (bO.y > -0.001 && bO != ro ? vec3(0.88, 0.92, 0.9) : vec3(1.0));
  if (rW > 0.0) col += rW * fluidReflect(rO, rD, rough);
  return col;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  gMx = uMag.x;
  gMxL = uMag.y;
  gPc = vec2(0.28 * gMxL, 0.0);
  gLat = vec2(0.55 * gMxL, 0.0);

  vec3 ww = normalize(uCamTgt - uCamPos);
  vec3 uu = normalize(cross(ww, vec3(0, 1, 0)));
  vec3 vv = cross(uu, ww);
  float fl = 1.0 / tan(radians(19.0));

  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 rd = normalize(uv.x * uu + uv.y * vv + fl * ww);
  vec3 col = render(uCamPos, rd);

  vec2 q = gl_FragCoord.xy / uRes;
  col *= 0.55 + 0.45 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.2);
  col = aces(col * 1.1);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + uSeed * 13.1) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
