precision highp float;
#include <common>
#include <env>
#include <loop>
varying vec2 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;

// CIE 1931 colour matching functions, multi-lobe analytic fit (Wyman, Sloan & Shirley, JCGT 2013)
vec3 cie(float l) {
  float t1 = (l - 442.0) * ((l < 442.0) ? 0.0624 : 0.0374);
  float t2 = (l - 599.8) * ((l < 599.8) ? 0.0264 : 0.0323);
  float t3 = (l - 501.1) * ((l < 501.1) ? 0.0490 : 0.0382);
  float x = 0.362 * exp(-0.5 * t1 * t1) + 1.056 * exp(-0.5 * t2 * t2) - 0.065 * exp(-0.5 * t3 * t3);
  float t4 = (l - 568.8) * ((l < 568.8) ? 0.0213 : 0.0247);
  float t5 = (l - 530.9) * ((l < 530.9) ? 0.0613 : 0.0322);
  float y = 0.821 * exp(-0.5 * t4 * t4) + 0.286 * exp(-0.5 * t5 * t5);
  float t6 = (l - 437.0) * ((l < 437.0) ? 0.0845 : 0.0278);
  float t7 = (l - 459.0) * ((l < 459.0) ? 0.0385 : 0.0725);
  float z = 1.217 * exp(-0.5 * t6 * t6) + 0.681 * exp(-0.5 * t7 * t7);
  return vec3(x, y, z);
}
const mat3 XYZ2RGB = mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570);

// soap film thickness in nm
float thickness(vec2 p, float t, out float speck) {
  float r = length(p);
  float th = atan(p.y, p.x);
  float u = r / loopR(th);
  // differential rotation: the breeze drags the middle round faster than the rim -> spiral bands
  float ang = (0.35 * t + 0.25 * sin(0.5 * t)) * (1.0 - smoothstep(0.0, 1.0, u)) * 0.9;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = mat2(ca, sa, -sa, ca) * p;
  float ft = t * 0.18;
  vec2 w1 = vec2(fbm2(q * 1.9 + vec2(0.0, ft)), fbm2(q * 1.9 + vec2(5.2, -ft) + 1.3));
  vec2 q2 = q + 0.55 * (w1 - 0.5);
  vec2 w2 = vec2(fbm2(q2 * 3.7 + vec2(ft * 1.7, 2.0)), fbm2(q2 * 3.7 - vec2(1.1, ft * 1.3)));
  vec2 q3 = q2 + 0.22 * (w2 - 0.5);
  // gravity drainage: thin at top, thick at bottom, horizontal bands swirled by the warp
  float yy = q3.y + 0.06 * sin(3.0 * q3.x + t * 0.7);
  float s = clamp((0.98 - yy) / 1.96, 0.0, 1.0);
  float h = 15.0 + 1350.0 * pow(s, 1.55);
  // fine turbulent striations
  h *= 1.0 + 0.10 * (fbm2(q3 * 13.0 + t * 0.3) - 0.5) + 0.05 * (vnoise2(q3 * 45.0) - 0.5);
  // black film patches near the top
  float blk = smoothstep(0.62, 0.78, fbm2(q2 * 5.0 + 4.0) + 0.55 * (yy - 0.45));
  h = mix(h, 12.0, blk * smoothstep(0.2, 0.75, yy));
  // drifting micro specks / tiny trapped droplets
  vec2 g = q2 * 38.0;
  vec2 gi = floor(g);
  vec2 gf = fract(g) - 0.5 - 0.35 * (vec2(hash12(gi), hash12(gi + 7.0)) - 0.5);
  float pr = step(0.93, hash12(gi + 3.0));
  speck = pr * smoothstep(0.09, 0.02, length(gf));
  h += speck * 600.0;
  // Plateau border: thick meniscus where the film meets the wire
  h += 9000.0 * exp(-(1.0 - u) * 55.0);
  return h;
}

void main() {
  float th = atan(vLocal.y, vLocal.x);
  float u = length(vLocal) / loopR(th);
  if (u > 1.002) discard; // mesh ends on the wire; guard only

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  float cosi = clamp(dot(N, V), 0.001, 1.0);
  const float n = 1.335;
  float sini2 = 1.0 - cosi * cosi;
  float cost = sqrt(max(1.0 - sini2 / (n * n), 0.0));
  float rs = (cosi - n * cost) / (cosi + n * cost);
  float rp = (n * cosi - cost) / (n * cosi + cost);
  float rs2 = rs * rs, rp2 = rp * rp;

  float speck;
  float d = thickness(vLocal, uTime, speck);
  // thick films lose coherence over the visible band -> average reflectance
  float coh = exp(-pow(d / 1700.0, 2.0));
  float Rinc = 0.5 * (2.0 * rs2 / (1.0 + rs2) + 2.0 * rp2 / (1.0 + rp2));

  vec3 xyz = vec3(0.0), white = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float l = 390.0 + 21.0 * float(i);
    float phi = 4.0 * PI * n * d * cost / l;
    float c = cos(phi);
    // Airy summation for a free-standing film (r23 = -r12)
    float Rs = 2.0 * rs2 * (1.0 - c) / (1.0 + rs2 * rs2 - 2.0 * rs2 * c);
    float Rp = 2.0 * rp2 * (1.0 - c) / (1.0 + rp2 * rp2 - 2.0 * rp2 * c);
    float R = mix(Rinc, 0.5 * (Rs + Rp), coh);
    vec3 cm = cie(l);
    xyz += R * cm;
    white += cm;
  }
  vec3 Rrgb = max(XYZ2RGB * (xyz / white.y), 0.0);
  vec3 W = max(XYZ2RGB * (white / white.y), 1e-3);
  Rrgb /= W; // equal-energy white -> neutral

  vec3 Rdir = reflect(-V, N);
  vec3 refl = Rrgb * envColor(Rdir, 0.0);
  // specks scatter a little light of their own
  refl += speck * 0.02 * envColor(N, 0.6);
  float a = clamp(dot(Rrgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  // Plateau border is a real liquid tube: a little opaque-looking sheen
  float border = exp(-(1.0 - u) * 70.0);
  refl += border * 0.10 * envColor(Rdir, 0.25);
  gl_FragColor = vec4(refl, a + border * 0.15);
}
