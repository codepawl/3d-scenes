import { NOISE, WORLD } from './common.js';

export const SKY_FN = /* glsl */ `
uniform vec3 uSunDir;
vec3 skyColor(vec3 d){
  float y = d.y;
  vec3 zen = vec3(0.010, 0.017, 0.045);
  vec3 hor = vec3(0.15, 0.11, 0.135);
  vec3 col = mix(hor, zen, smoothstep(-0.02, 0.55, y));
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.40, 0.16) * 0.65 * pow(s, 8.0) * smoothstep(0.45, -0.03, y);
  col += vec3(0.85, 0.45, 0.30) * 0.14 * pow(s, 2.0) * smoothstep(0.7, 0.0, y);
  col = mix(col, vec3(0.035, 0.028, 0.03), smoothstep(0.0, -0.25, y));
  return col;
}
`;

export const terrainVert = /* glsl */ `
${NOISE}
${WORLD}
varying vec3 vWorld;
void main(){
  vec2 xz = (modelMatrix * vec4(position, 1.0)).xz;
  float h = max(rockH(xz), lavaH(xz));
  vWorld = vec3(xz.x, h, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

export const terrainFrag = /* glsl */ `
${NOISE}
${WORLD}
${SKY_FN}
uniform float uTauA, uTauB, uWA;
uniform vec3 uSunCol;
varying vec3 vWorld;

const float PI = 3.14159265;
const float FLOW_V = 0.32;

// ------------------------------------------------------------------ blackbody-ish ramp
// t: 0 (cool crust ~500C) .. 1 (fresh lava ~1150C). Returns HDR radiance.
vec3 blackbody(float t){
  t = clamp(t, 0.0, 1.2);
  vec3 c = vec3(1.0, 0.0, 0.0);
  c.g = smoothstep(0.20, 0.95, t) * 0.78 + 0.03 * t;
  c.b = smoothstep(0.62, 1.15, t) * 0.55;
  c.r = 1.0;
  float I = 30.0 * t * t * t * t * sqrt(t);
  return c * I;
}

// ------------------------------------------------------------------ lava crust
vec2 flowQ(vec2 p, float tau, float seed){
  float w = chW(p.y);
  float x = p.x - chX(p.y);
  float d = x / w;
  float v = FLOW_V * smoothstep(FRONT_Z + 0.2, FRONT_Z + 7.0, p.y) * (1.0 - 0.3 * d * d);
  return vec2(x, p.y + v * tau) + seed * vec2(13.7, 41.3);
}
vec2 warp(vec2 q){ return q + 0.11 * vec2(snoise(q * 1.4), snoise(q * 1.4 + vec2(5.2, 1.3))); }

struct Crust { float h; float T; float rough; float tint; float crack; };

// pz: world z (for downstream crack opening); toeW, toeL from lavaH; lod: footprint in metres
Crust crustAt(vec2 p, float tau, float seed, float toeW, vec3 toeL, float lod, bool full){
  Crust c; c.T = 0.0; c.rough = 0.5; c.tint = 0.0;
  vec2 q = flowQ(p, tau, seed);
  vec2 qs = p * 1.9 + vec2(31.0, 7.0);              // static coords for toes
  vec2 qq = (toeW > 0.5) ? qs : q;
  vec2 qw = warp(qq);
  float w = chW(p.y);
  float dn = (p.x - chX(p.y)) / w;

  // primary plates (~0.65 m)
  const float S1 = 1.55;
  vec3 v1 = voronoiEdge(qw * vec2(S1, S1 * 0.85), 0.85);
  float e1 = v1.x / S1;                               // metres
  float zOpen = mix(FRONT_Z - 1.0, 26.0, v1.z);       // edges open as they travel downstream
  float open = 0.42 + 0.58 * smoothstep(zOpen + 0.7, zOpen - 0.7, p.y);
  open *= 0.75 + 0.25 * sin(uTime * 0.9 + v1.z * 40.0);
  // toe: cracks open with inflation; hottest at the leading rim
  float rim = 0.0;
  if (toeW > 0.5){
    float rr = length(toeL.xy);
    rim = smoothstep(0.72, 1.0, rr) * smoothstep(0.2, -0.8, toeL.y); // downslope side (toes grow toward -z)
    open = mix(0.15, 1.0, toeL.z) * (0.4 + 0.6 * step(v1.z, 0.35 + 0.6 * toeL.z));
  }
  float edgeTaper = 1.0 - 0.7 * smoothstep(0.55, 0.95, abs(dn)) * (1.0 - toeW);
  float cw = (0.008 + 0.075 * v1.z * v1.z) * open * edgeTaper;   // crack half-width (m)
  cw *= 0.8 + 0.4 * snoise(qw * 3.1);
  cw = max(cw, 0.0);
  float fw = max(lod, 1e-4);
  float aw = max(cw, fw);
  float crack = (1.0 - smoothstep(0.0, aw, e1)) * (cw / aw);

  // secondary hairline cracks (~0.22 m)
  const float S2 = 4.4;
  vec3 v2 = voronoiEdge(qw * S2 + 3.7, 0.9);
  float e2 = v2.x / S2;
  float cw2 = 0.004 * step(0.45, v2.z) * open * edgeTaper;
  float aw2 = max(cw2, fw);
  float crack2 = (1.0 - smoothstep(0.0, aw2, e2)) * (cw2 / aw2) * smoothstep(0.02, 0.08, e1);

  // relief: domed plates, sunken cracks, ropy folds
  float dome = smoothstep(0.0, 0.3, e1);
  float h = 0.022 * dome - 0.03 * crack - 0.01 * crack2;
  float ropeFade = 1.0 - smoothstep(0.012, 0.04, lod);
  if (ropeFade > 0.0){
    float ph;
    if (toeW > 0.5) ph = length(toeL.xy) * 46.0 + 1.3 * snoise(qs * 2.0);
    else ph = (q.y + 0.45 * (1.0 - dn * dn)) * (2.0 * PI / 0.14) + 1.4 * snoise(q * 2.2);
    float ropeAmp = smoothstep(-0.1, 0.5, snoise(qq * 0.55 + 3.0)) * smoothstep(0.03, 0.12, e1);
    h += 0.011 * sin(ph) * ropeAmp * ropeFade;
  }
  h += 0.014 * fbm(qq * 6.0, 2) * (1.0 - smoothstep(0.01, 0.03, lod));
  h += 0.02 * dot(hash22(vec2(v1.y * 57.0, 1.0)) - 0.5, qw - floor(qw)) * dome; // per-plate tilt
  c.h = h;
  c.crack = max(crack, crack2);
  if (!full) return c;

  // temperature
  float coreT = 0.95 + 0.12 * snoise(qw * 6.0 + uTime * 0.3);
  float halo = exp(-e1 / (0.025 + 0.6 * cw)) * open * edgeTaper;
  float thinSpot = smoothstep(0.7, 0.95, hash12(vec2(v1.y * 91.0, 3.0))) * 0.3 * smoothstep(0.2, 0.7, snoise(qw * 3.0 + 7.0)) * smoothstep(0.02, 0.1, e1);
  float T = 0.03 + 0.03 * v1.y + 0.42 * halo + thinSpot;
  T = max(T, coreT * crack);
  T = max(T, 0.75 * crack2);
  float brk = smoothstep(0.1, 0.7, snoise(qs * 2.5 + uTime * 0.05));
  T = max(T, rim * (0.25 + 0.6 * brk) * (0.6 + 0.4 * toeL.z));
  T *= mix(1.0, 0.75, smoothstep(0.6, 1.0, abs(dn)) * (1.0 - toeW));
  c.T = T;
  c.rough = clamp(0.22 + 0.25 * v1.y + 0.18 * fbm(qq * 3.0, 2) + 0.3 * smoothstep(0.6, 1.0, abs(dn)), 0.12, 0.8);
  c.tint = v1.y;
  return c;
}

Crust crustBlend(vec2 p, float toeW, vec3 toeL, float lod, bool full){
  Crust c; c.h = 0.0; c.T = 0.0; c.rough = 0.0; c.tint = 0.0; c.crack = 0.0;
  for (int k = 0; k < 2; k++){
    float w = (k == 0) ? uWA : 1.0 - uWA;
    if (w < 0.001) continue;
    Crust a = crustAt(p, (k == 0) ? uTauA : uTauB, float(k), toeW, toeL, lod, full);
    c.h += a.h * w; c.T += a.T * w; c.rough += a.rough * w; c.tint += a.tint * w; c.crack += a.crack * w;
  }
  return c;
}

// ------------------------------------------------------------------ basalt detail
float rockDetail(vec2 p, float lod, out float cavity, out float ves){
  float h = 0.04 * fbm(p * 2.2 + 5.0, 3) + 0.03 * abs(snoise(p * 1.3 + 2.0));
  float fine = 1.0 - smoothstep(0.01, 0.04, lod);
  h += 0.014 * fbm(p * 9.0, 2) * fine;
  vec3 fr = voronoiEdge(p * vec2(0.9, 1.1) + 20.0, 0.9);
  float groove = 1.0 - smoothstep(0.0, 0.05 + 0.04 * fr.z, fr.x);
  h -= 0.035 * groove * step(0.3, fr.z);
  float id;
  float f1 = voronoiF1(p * 15.0, id);
  ves = (1.0 - smoothstep(0.08, 0.22 * id + 0.04, f1)) * step(0.55, id) * fine * smoothstep(-0.2, 0.5, snoise(p * 0.7 + 4.0));
  h -= 0.006 * ves;
  cavity = groove * step(0.3, fr.z);
  return h;
}

// ------------------------------------------------------------------ lighting
float D_GGX(float NdH, float a){ float a2 = a * a; float d = NdH * NdH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float V_Smith(float NdV, float NdL, float a){ float k = a * 0.5; return 0.25 / ((NdV * (1.0 - k) + k) * (NdL * (1.0 - k) + k)); }

vec3 lavaLightAt(vec3 P, vec3 N, out float prox){
  // lava as a line source along the channel axis (plus the toe field below the front)
  float zc = max(P.z, FRONT_Z - 1.2);
  vec3 C = vec3(chX(zc), P.y + 0.15, zc);
  // pull toward the surface of the flow
  float dx = P.x - C.x;
  float w = chW(zc);
  C.x += clamp(dx, -w * 0.8, w * 0.8);
  vec3 L = C - P;
  float d2 = dot(L, L);
  L *= inversesqrt(d2 + 1e-4);
  prox = 1.0 / (1.0 + d2 * 0.5);
  float wrap = max(dot(N, L), 0.0) * 0.8 + 0.2;
  return vec3(1.0, 0.30, 0.07) * 1.3 * wrap / (0.6 + d2);
}

void main(){
  vec3 P = vWorld;
  vec2 p = P.xz;
  vec3 V = normalize(cameraPosition - P);
  float dist = length(cameraPosition - P);
  float lod = length(fwidth(p));

  float toeW; vec3 toeL;
  float hr = rockH(p);
  float hl = lavaH(p, toeW, toeL);
  float fwH = fwidth(hl - hr) + 0.002;
  float lavaM = smoothstep(-fwH, fwH, hl - hr + 0.004);

  const float E = 0.04;
  vec3 col = vec3(0.0);
  float heat = 0.0;
  vec3 Nmacro;

  // ---------------- rock
  vec3 rockCol = vec3(0.0);
  if (lavaM < 0.999){
    float hx = rockH(p + vec2(E, 0.0)), hz = rockH(p + vec2(0.0, E));
    vec2 gM = vec2(hx - hr, hz - hr) / E;
    float cav, ves, cv2, vs2;
    float ed = max(lod, 0.012);
    float d0 = rockDetail(p, lod, cav, ves);
    float dx = rockDetail(p + vec2(ed, 0.0), lod, cv2, vs2);
    float dz = rockDetail(p + vec2(0.0, ed), lod, cv2, vs2);
    vec2 g = gM + vec2(dx - d0, dz - d0) / ed;
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 Ng = normalize(vec3(-gM.x, 1.0, -gM.y));

    // albedo: dark basalt, oxidised patches, ash dust in hollows and on flats, dark vesicles
    float n1 = fbm(p * 0.6 + 2.0, 3);
    float n2 = snoise(p * 0.25 - 4.0);
    vec3 alb = mix(vec3(0.040, 0.039, 0.040), vec3(0.085, 0.080, 0.076), smoothstep(-0.6, 0.6, n1));
    alb = mix(alb, vec3(0.13, 0.065, 0.040), smoothstep(0.35, 0.8, n2) * 0.55);          // hematite staining
    float near = smoothstep(-0.35, 0.0, hl - hr);
    float dust = smoothstep(0.1, 0.6, snoise(p * 0.9 + 9.0) + 0.6 * (Ng.y - 0.9) * 4.0 - d0 * 8.0);
    dust = max(dust * 0.7, cav * 0.55) * (1.0 - smoothstep(-0.8, -0.1, hl - hr));
    alb = mix(alb, vec3(0.20, 0.185, 0.165), dust * 0.75);
    alb *= 1.0 - 0.6 * ves;
    float glassy = smoothstep(0.45, 0.75, snoise(p * 0.4 + 1.7));
    float rough = clamp(0.92 - 0.3 * glassy + 0.1 * dust + 0.08 * fbm(p * 5.0, 2), 0.62, 0.98);
    // scorched rim right next to the flow
    alb *= 1.0 - 0.55 * near;
    float ao = clamp(1.0 + d0 * 6.0, 0.35, 1.0) * (1.0 - 0.4 * cav) * (1.0 - 0.4 * ves);

    float NdV = max(dot(N, V), 1e-3);
    float a = rough * rough;
    // sun (dusk, low)
    vec3 L = uSunDir; vec3 H = normalize(L + V);
    float NdL = max(dot(N, L), 0.0);
    vec3 F = vec3(0.04) + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 spec = D_GGX(max(dot(N, H), 0.0), a) * V_Smith(NdV, NdL, a) * F;
    vec3 c = (alb / PI + spec) * uSunCol * NdL;
    // sky ambient + reflection
    vec3 skyAmb = mix(vec3(0.016, 0.014, 0.016), vec3(0.05, 0.058, 0.09), N.y * 0.5 + 0.5);
    c += alb * skyAmb * ao * 1.6;
    vec3 R = reflect(-V, N);
    float Fr = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    c += skyColor(normalize(vec3(R.x, abs(R.y), R.z))) * Fr * (1.0 - rough) * (1.0 - rough) * 0.35 * ao;
    // lava irradiance
    float prox;
    vec3 Ll = lavaLightAt(P, N, prox);
    c += alb * Ll * (0.6 + 0.4 * ao);
    // contact heat: rock touching the flow glows faintly
    c += blackbody(0.2) * pow(near, 6.0) * 0.3;
    rockCol = c;
    Nmacro = Ng;
  }

  // ---------------- lava
  vec3 lavaCol = vec3(0.0);
  float lavaHeat = 0.0;
  if (lavaM > 0.001){
    float hx = lavaH(p + vec2(E, 0.0)), hz = lavaH(p + vec2(0.0, E));
    vec2 gM = vec2(hx - hl, hz - hl) / E;
    float ed = max(lod * 0.7, 0.006);
    Crust c0 = crustBlend(p, toeW, toeL, lod, true);
    vec2 dh = vec2(0.0);
    for (int k = 0; k < 2; k++){
      vec2 o = (k == 0) ? vec2(ed, 0.0) : vec2(0.0, ed);
      float hk = crustBlend(p + o, toeW, toeL, lod, false).h;
      if (k == 0) dh.x = hk; else dh.y = hk;
    }
    vec2 g = gM + (dh - c0.h) / ed;
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    // glassy silver-black skin with a little oxidation and thin-film tint
    vec3 alb = mix(vec3(0.028, 0.026, 0.027), vec3(0.06, 0.045, 0.04), c0.tint);
    alb = mix(alb, vec3(0.09, 0.05, 0.035), smoothstep(0.3, 0.8, snoise(p * 1.7 + 9.0)) * 0.5); // oxidised skin
    float grain = snoise(p * 28.0) * (1.0 - smoothstep(0.004, 0.015, lod));
    alb *= 1.0 + 0.35 * grain;
    float rough = clamp(c0.rough + 0.12 * grain + 0.1 * fbm(p * 9.0, 2), 0.1, 0.9);
    float NdV = max(dot(N, V), 1e-3);
    float a = rough * rough;
    vec3 film = 0.75 + 0.25 * cos(6.2831 * (NdV * 1.7 + c0.tint * 0.5 + vec3(0.0, 0.33, 0.67)));
    vec3 F0 = vec3(0.045) * film;
    vec3 L = uSunDir; vec3 H = normalize(L + V);
    float NdL = max(dot(N, L), 0.0);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 spec = D_GGX(max(dot(N, H), 0.0), a) * V_Smith(NdV, NdL, a) * F;
    vec3 c = (alb / PI + spec) * uSunCol * NdL;
    vec3 skyAmb = mix(vec3(0.016, 0.014, 0.016), vec3(0.05, 0.058, 0.09), N.y * 0.5 + 0.5);
    c += alb * skyAmb * 1.6;
    vec3 R = reflect(-V, N);
    vec3 Fr = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
    float envSharp = (1.0 - rough) * (1.0 - rough);
    vec3 env = skyColor(normalize(vec3(R.x, abs(R.y) + 0.02, R.z)));
    env = mix(vec3(dot(env, vec3(0.3, 0.5, 0.2))), env, 0.5);
    c += env * Fr * (0.12 + 0.45 * envSharp);
    // glow from the surrounding cracks on the crust itself
    c += alb * vec3(1.0, 0.3, 0.08) * 0.5;
    // incandescence
    vec3 em = blackbody(c0.T);
    c = c * (1.0 - c0.crack) + em;
    lavaCol = c;
    lavaHeat = 0.35 + 0.65 * clamp(c0.T, 0.0, 1.0);
    if (lavaM >= 0.999) Nmacro = normalize(vec3(-gM.x, 1.0, -gM.y));
  }

  col = mix(rockCol, lavaCol, lavaM);
  heat = lavaHeat * lavaM;

  // ---------------- atmosphere: dusk haze with lava-lit gas
  float fogA = 1.0 - exp(-dist * 0.009);
  fogA *= 1.0 - 0.35 * smoothstep(-2.0, 25.0, P.y);
  vec3 fogCol = skyColor(normalize(vec3(-V.x, max(-V.y, 0.02) * 0.4, -V.z)));
  float zc = max(P.z, FRONT_Z - 1.2);
  float dxc = abs(P.x - chX(zc)) / chW(zc);
  float glow = exp(-dxc * dxc * 0.35) * smoothstep(FRONT_Z - 4.0, FRONT_Z, P.z);
  fogCol = fogCol * 0.7 + vec3(1.0, 0.32, 0.09) * 0.12 * glow;
  col = mix(col, fogCol, fogA);

  col = min(col, vec3(250.0));
  col = max(col, vec3(0.0));
  gl_FragColor = vec4(col, heat * (1.0 - fogA));
}
`;
