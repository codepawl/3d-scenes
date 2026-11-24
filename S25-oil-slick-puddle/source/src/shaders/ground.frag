// Wet asphalt + puddle + thin-film oil. Linear HDR output.
uniform float uTime;
uniform float uRain;
uniform vec3 uCamPos;
uniform vec3 uLampPos;
uniform vec3 uFilmW[16];   // per-wavelength RGB weights (CIE fit -> linear sRGB, white-normalised)
uniform float uLambda[16]; // nm
varying vec3 vWorld;

#include <common_noise>

const float PI = 3.14159265;
const vec2 PUDDLE_C = vec2(0.0, -0.35);
const vec3 LAMP_COL = vec3(1.0, 0.62, 0.30);

// ---------------------------------------------------------------- environment
// Analytic dusk street: sky, building silhouettes with windows, a sodium-ish lamp.
vec3 env(vec3 d, vec3 Ld, float rough) {
  float el = clamp(d.y, -1., 1.);
  float e = asin(el);
  vec3 zen = vec3(0.17, 0.20, 0.28), hor = vec3(0.40, 0.36, 0.35);
  vec3 sky = mix(hor, zen, smoothstep(0.0, 0.9, e));
  vec2 cuv = d.xz / (max(el, 0.0) + 0.25);
  float cl = fbm3(cuv * 1.3 + vec2(uTime * 0.02, 0.0));
  sky *= mix(0.75 + 0.5 * cl, 1.0, clamp(rough * 1.5, 0., 1.));

  // buildings: stepped skyline in azimuth
  float az = atan(d.x, -d.z);
  float bw = 0.21;
  float bi = floor(az / bw);
  float bh = 0.2 + 0.58 * hash11(bi * 1.37 + 3.1);
  float soft = 0.004 + rough * 0.35;
  float bmask = smoothstep(bh + soft, bh - soft, e);
  float bu = fract(az / bw);
  float sideMask = smoothstep(0.0, 0.03 + soft, bu) * smoothstep(1.0, 0.97 - soft, bu); // gaps between blocks
  bmask *= mix(1.0, sideMask, step(0.5, hash11(bi * 7.7)));
  vec2 wg = vec2(bu * 11.0, e * 42.0);
  vec2 wc = floor(wg), wf = fract(wg);
  float win = smoothstep(0.18, 0.26, wf.x) * smoothstep(0.82, 0.74, wf.x) * smoothstep(0.2, 0.3, wf.y) * smoothstep(0.8, 0.7, wf.y);
  float lit = step(0.5, hash12(wc + bi * 13.0)) * (0.5 + hash12(wc * 3.1 + bi));
  vec3 wcol = mix(vec3(1.3, 0.85, 0.45), vec3(0.55, 0.75, 1.1), step(0.8, hash12(wc * 1.7 + bi)));
  win *= lit * step(e, bh - 0.02) * step(0.0, e);
  vec3 bcol = vec3(0.022, 0.024, 0.028) + wcol * win * mix(1.0, 0.15, clamp(rough * 2., 0., 1.));
  vec3 col = mix(sky, bcol, bmask);

  // below horizon: dark street
  col = mix(col, vec3(0.03, 0.03, 0.032), smoothstep(0.0, -0.05 - rough * 0.3, el));

  // street lamp: sharp core + halo, widened by roughness
  float cd = max(dot(d, Ld), 0.0);
  float n = mix(9000.0, 18.0, sqrt(clamp(rough, 0., 1.)));
  col += LAMP_COL * pow(cd, n) * (n + 2.0) * 0.004;
  col += LAMP_COL * pow(cd, 60.0) * 0.35 * (1.0 - rough * 0.5);
  return col;
}

// ---------------------------------------------------------------- asphalt
float det0(float x) { return 1.0 - smoothstep(0.25, 0.9, x); }
struct Surf { vec3 alb; float h; float rough; float stone; };

float macroH(vec2 p) {
  vec2 q = (p - PUDDLE_C) / vec2(1.75, 1.05);
  float bowl = 0.016 * (length(q + 0.18 * vec2(fbm3(p * 0.9), fbm3(p * 0.9 + 4.0))) - 1.0);
  return bowl + 0.007 * (fbm(p * 1.4 + 2.0) - 0.5) + 0.002;
}

Surf asphalt(vec2 p, float fw) {
  Surf s;
  // coarse aggregate
  float sc = 42.0;
  vec2 sp = p * sc;
  sp += 0.35 * vec2(vnoise(sp * 1.7), vnoise(sp * 1.7 + 5.3)) * det0(fw * sc * 2.0);
  vec3 v = voronoi(sp);
  float det = 1.0 - smoothstep(0.25, 0.9, fw * sc);
  float edge = v.y - v.x;
  float thr = 0.22 + 0.22 * fract(v.z * 13.7);
  float shape = v.x + 0.18 * (vnoise(sp * 4.0 + v.z * 50.0) - 0.5);
  float stone = smoothstep(thr + 0.05, thr - 0.03, shape) * step(0.4, v.z) * det;
  vec3 stoneCol = mix(vec3(0.075, 0.073, 0.07), vec3(0.20, 0.19, 0.18), pow(v.z, 2.0));
  stoneCol = mix(stoneCol, vec3(0.30, 0.24, 0.19), step(0.85, fract(v.z * 7.3)) * 0.7); // brownish chips
  // fine sand
  float sc2 = 190.0;
  vec3 v2 = voronoi(p * sc2 + 3.7);
  float det2 = 1.0 - smoothstep(0.25, 0.9, fw * sc2);
  float sand = smoothstep(0.05, 0.2, v2.y - v2.x) * det2;
  vec3 binder = vec3(0.040, 0.039, 0.038) * (0.75 + 0.6 * v2.z * sand * det2);
  s.alb = mix(binder, stoneCol, stone);
  s.alb *= mix(1.0, 0.7 + 0.6 * vnoise(p * 400.0), det2);

  // grime, tar stains, wear
  float g = fbm(p * 0.6);
  s.alb *= 0.65 + 0.6 * g;
  float stain = smoothstep(0.58, 0.72, fbm(p * 2.1 + 9.0));
  s.alb = mix(s.alb, vec3(0.018, 0.016, 0.015), stain * 0.85);
  float dust = smoothstep(0.55, 0.8, fbm(p * 3.3 + 1.0)) * (1.0 - stain);
  s.alb = mix(s.alb, s.alb * vec3(1.35, 1.25, 1.1), dust);

  // cracks
  vec2 cw = p * 0.9 + 0.35 * vec2(fbm3(p * 2.0), fbm3(p * 2.0 + 7.0));
  vec3 cv = voronoi(cw);
  float cwid = 0.018 + 0.02 * fbm3(p * 5.0);
  float cfw = fw * 0.9 * 1.5;
  float crack = 1.0 - smoothstep(cwid - cfw, cwid + cfw, cv.y - cv.x);
  crack *= smoothstep(0.35, 0.55, fbm3(p * 0.7 + 2.3)); // only some edges cracked
  s.alb = mix(s.alb, vec3(0.008), crack);

  // worn painted bay line (chipped, stays on stone tops)
  float line = abs(p.x - 2.05 - 0.03 * sin(p.y * 0.4));
  float lw = 0.055;
  float lmask = 1.0 - smoothstep(lw - fw, lw + fw, line);
  float chip = smoothstep(0.42, 0.6, fbm(p * 9.0) * 0.8 + stone * 0.35 + 0.1 * g);
  float paint = lmask * chip;
  s.alb = mix(s.alb, vec3(0.62, 0.58, 0.46) * (0.8 + 0.3 * g), paint * (1.0 - crack));

  s.h = 0.0011 * stone * (0.6 + 0.6 * v.z) + 0.0003 * sand - 0.0012 * crack + 0.0002 * paint;
  s.rough = mix(0.85, 0.55, stone);
  s.rough = mix(s.rough, 0.5, paint);
  s.rough = mix(s.rough, 0.95, dust);
  s.stone = stone;
  return s;
}

// ---------------------------------------------------------------- rain rings
const int ND = 22;
void rainField(vec2 p, float fw, out vec2 grad, out float h, out vec2 disp, out float thin, out float stretch) {
  grad = vec2(0); h = 0.; disp = vec2(0); thin = 0.; stretch = 0.;
  for (int i = 0; i < ND; i++) {
    float fi = float(i);
    float T = 1.7 + 1.5 * hash11(fi * 7.13 + 0.3);
    float tt = uTime + hash11(fi * 3.71 + 1.0) * T;
    float k = floor(tt / T);
    float a = tt - k * T;
    vec2 rnd = hash22(vec2(fi * 1.31, k + 0.5));
    vec2 c = PUDDLE_C + (rnd - 0.5) * vec2(3.2, 1.9);
    vec2 dv = p - c;
    float r = length(dv);
    vec2 dir = dv / max(r, 1e-4);
    float life = smoothstep(T, T * 0.75, a) * smoothstep(0.0, 0.02, a);
    float front = 0.06 + 0.30 * a;
    float sig = 0.015 + 0.045 * a;
    float x = (r - front) / sig;
    float env = exp(-x * x) * exp(-1.4 * a) / (1.0 + 5.0 * r) * life;
    float lam = 0.016 + 0.014 * a;
    float kw = 2.0 * PI / lam;
    float aa = 1.0 - smoothstep(0.25, 0.7, fw / lam);
    // trailing secondary ring
    float x2 = (r - front * 0.6) / (sig * 0.8);
    float env2 = 0.5 * exp(-x2 * x2) * exp(-1.8 * a) / (1.0 + 5.0 * r) * life;
    float ph = kw * (r - front);
    float ph2 = kw * 1.3 * (r - front * 0.6);
    float amp = 0.0011 * uRain;
    h += amp * (env * cos(ph) + env2 * cos(ph2));
    grad += dir * (-amp * aa * (env * kw * sin(ph) + env2 * kw * 1.3 * sin(ph2)));
    // impact crater/splash bump
    float sp = exp(-r * r / 0.00012) * exp(-a * 14.0) * life;
    grad += dir * (-sp * r / 0.00012 * 2.0 * 0.0016 * uRain) * aa;
    // oil response: film pushed out inside the ring (stretch), piles up at the front
    float inside = smoothstep(front + sig, front - sig, r);
    float s = 0.45 * exp(-0.55 * a) * inside * life * uRain;
    disp += dv * s;
    stretch += s;
    thin += exp(-r * r / pow(0.012 + 0.05 * a, 2.0)) * exp(-0.9 * a) * life * uRain;
    stretch -= 0.6 * env * (1.0 + 5.0 * r) * exp(-0.5 * a) * uRain; // compression at the crest
  }
}

// ---------------------------------------------------------------- thin film
// Airy reflectance of a film (n2) on water (n3), averaged over s and p.
float airy(float r12, float r23, float cd) {
  float a = r12 * r12 + r23 * r23 + 2.0 * r12 * r23 * cd;
  float b = 1.0 + r12 * r12 * r23 * r23 + 2.0 * r12 * r23 * cd;
  return a / b;
}
vec3 thinFilm(float cos1, float dnm) {
  const float n1 = 1.0, n2 = 1.47, n3 = 1.333;
  float sin1 = sqrt(max(0.0, 1.0 - cos1 * cos1));
  float sin2 = sin1 * n1 / n2;
  float cos2 = sqrt(1.0 - sin2 * sin2);
  float sin3 = sin1 * n1 / n3;
  float cos3 = sqrt(1.0 - sin3 * sin3);
  float rs12 = (n1 * cos1 - n2 * cos2) / (n1 * cos1 + n2 * cos2);
  float rp12 = (n2 * cos1 - n1 * cos2) / (n2 * cos1 + n1 * cos2);
  float rs23 = (n2 * cos2 - n3 * cos3) / (n2 * cos2 + n3 * cos3);
  float rp23 = (n3 * cos2 - n2 * cos3) / (n3 * cos2 + n2 * cos3);
  vec3 rgb = vec3(0);
  float opd = 4.0 * PI * n2 * dnm * cos2;
  for (int i = 0; i < 16; i++) {
    float cd = cos(opd / uLambda[i]);
    float R = 0.5 * (airy(rs12, rs23, cd) + airy(rp12, rp23, cd));
    rgb += uFilmW[i] * R;
  }
  return max(rgb, vec3(0.0));
}

float oilThickness(vec2 q) {
  vec2 w = vec2(fbm3(q * 0.8 + vec2(0.0, uTime * 0.02)), fbm3(q * 0.8 + vec2(5.2, 1.3) - uTime * 0.015));
  vec2 w2 = vec2(fbm(q * 1.6 + 3.0 * w + vec2(1.7, 9.2)), fbm(q * 1.6 + 3.0 * w + vec2(8.3, 2.8)));
  return fbm(q * 1.1 + 2.6 * w2);
}

// ---------------------------------------------------------------- lighting helpers
float D_GGX(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
vec3 ambient(vec3 N) { return mix(vec3(0.03, 0.03, 0.03), vec3(0.20, 0.20, 0.23), N.y * 0.5 + 0.5); }

vec3 lampDirect(vec3 P, vec3 N, vec3 V, vec3 alb, float rough, float F0) {
  vec3 Lv = uLampPos - P;
  float d2 = dot(Lv, Lv);
  vec3 L = Lv * inversesqrt(d2);
  vec3 H = normalize(L + V);
  float NoL = max(dot(N, L), 0.0), NoH = max(dot(N, H), 0.0), NoV = max(dot(N, V), 1e-3);
  float a = max(rough * rough, 0.003);
  float F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float k = a * 0.5;
  float vis = 1.0 / ((NoL * (1.0 - k) + k) * (NoV * (1.0 - k) + k) * 4.0);
  vec3 rad = LAMP_COL * 55.0 / d2;
  return rad * NoL * (alb / PI + D_GGX(NoH, a) * F * vis);
}

void main() {
  vec3 P = vWorld;
  vec2 p = P.xz;
  vec3 toCam = uCamPos - P;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fw = max(length(fwidth(p)), 1e-5);
  vec3 Ld = normalize(uLampPos - P);

  Surf s = asphalt(p, fw);
  float H = macroH(p) + s.h;

  vec2 rg; float rh; vec2 disp; float thin; float stretch;
  rainField(p, fw, rg, rh, disp, thin, stretch);

  float depth = -H + rh * 0.4;
  float ew = max(fwidth(depth), 0.00025);
  float water = smoothstep(-ew, ew, depth);

  // ---- asphalt shading (rain-wet everywhere, wetter near the water)
  vec2 dpx = dFdx(p), dpy = dFdy(p);
  float dhx = dFdx(H), dhy = dFdy(H);
  float det = dpx.x * dpy.y - dpx.y * dpy.x;
  vec2 hg = abs(det) > 1e-12 ? vec2(dhx * dpy.y - dhy * dpx.y, dpx.x * dhy - dpy.x * dhx) / det : vec2(0);
  hg = clamp(hg, -3.0, 3.0);
  vec3 Ng = normalize(vec3(-hg.x * 1.6, 1.0, -hg.y * 1.6));
  float nearWater = smoothstep(-0.006, 0.0, depth);
  float pits = smoothstep(0.0006, 0.0, s.h);  // binder low spots hold water
  float wet = clamp(0.55 + 0.45 * nearWater + 0.2 * pits, 0.0, 1.0);
  vec3 albG = s.alb * mix(1.0, 0.55, wet);
  float roughG = mix(s.rough, mix(0.32, 0.08, pits), wet * (0.6 + 0.4 * nearWater));
  // water film flattens the normal in pits
  Ng = normalize(mix(Ng, vec3(0, 1, 0), wet * pits * 0.8));
  float NoV = max(dot(Ng, V), 1e-3);
  float Fg = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
  vec3 groundCol = albG * ambient(Ng) + lampDirect(P, Ng, V, albG, roughG, 0.04);
  float roughE = max(roughG, 0.22);
  groundCol += env(reflect(-V, Ng), Ld, roughE) * Fg * mix(0.3, 1.0, 1.0 - roughE);

  // ---- water + oil film
  // wind capillaries
  vec2 wq = p * 9.0 + vec2(uTime * 0.35, uTime * 0.12);
  float e = 0.04;
  float n0 = vnoise(wq), nx = vnoise(wq + vec2(e, 0)), ny = vnoise(wq + vec2(0, e));
  vec2 wg = vec2(nx - n0, ny - n0) / e * 9.0 * 0.00025;
  vec2 grad = rg + wg * (1.0 - smoothstep(0.004, 0.02, fw));
  vec3 Nw = normalize(vec3(-grad.x, 1.0, -grad.y));
  float cosi = clamp(dot(Nw, V), 0.02, 1.0);

  // oil: slowly rotating marbled film, pushed by rain rings
  vec2 q = p - PUDDLE_C;
  float ang = uTime * 0.012;
  q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
  vec2 qd = q - disp * 1.0;
  float th = oilThickness(qd * 1.25 + 3.0);
  float cover = smoothstep(0.34, 0.52, fbm3(qd * 0.55 + 11.0) + 0.12 * th);
  float dnm = mix(70.0, 640.0, smoothstep(0.12, 0.88, th));
  dnm *= clamp(1.0 - 0.75 * stretch, 0.25, 1.6);
  dnm *= 1.0 - 0.85 * clamp(thin, 0.0, 1.0);
  dnm *= cover;
  // film is thinner near the shoreline where it smears onto the asphalt
  vec3 Rf = thinFilm(cosi, dnm);

  vec3 Rv = reflect(-V, Nw);
  vec3 refl = env(Rv, Ld, 0.015);

  // bottom seen through shallow water, refracted by the ripples
  float wdep = max(depth, 0.0);
  vec2 pb = p - V.xz / max(V.y, 0.2) * wdep * 0.25 + grad * wdep * 60.0;
  Surf sb = asphalt(pb, fw);
  vec3 albB = sb.alb * 0.5;
  vec3 silt = vec3(0.035, 0.030, 0.024);
  albB = mix(albB, silt, smoothstep(0.0, 0.016, wdep) * 0.75);
  vec3 bottom = albB * (ambient(vec3(0, 1, 0)) * 0.8 + lampDirect(P, vec3(0, 1, 0), V, albB, 0.9, 0.02) * 0.8);
  bottom *= exp(-wdep * vec3(30.0, 22.0, 18.0));
  bottom *= mix(vec3(1.0), vec3(0.8, 0.72, 0.58), cover * 0.6); // oil tints transmission
  float Ravg = dot(Rf, vec3(0.333));
  vec3 waterCol = refl * Rf + bottom * (1.0 - Ravg);
  // tiny glints from the lamp on ripple facets
  vec3 Hl = normalize(Ld + V);
  waterCol += LAMP_COL * Rf * D_GGX(max(dot(Nw, Hl), 0.0), 0.02) * 55.0 / dot(uLampPos - P, uLampPos - P) * 0.25;

  vec3 col = mix(groundCol, waterCol, water);

  // distance haze
  float fog = 1.0 - exp(-max(dist - 3.0, 0.0) * 0.12);
  col = mix(col, vec3(0.10, 0.10, 0.115), fog);
  gl_FragColor = vec4(col, 1.0);
}
