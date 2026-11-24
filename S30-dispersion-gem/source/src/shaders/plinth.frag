// Honed dark stone plinth: veins, speckle, top dust, worn and chipped edges
// (bevel faked in the normal), drip grime on the sides, varying roughness.
// Gem shadow + rotating dispersive caustic on the top face. Original work.

uniform vec3 uHalf;      // box half extents (object space)
uniform vec3 uGemC;      // gem centre, world
uniform float uGemR;     // gem radius, world
uniform float uGemAng;   // gem spin angle
uniform float uCaustic;  // caustic strength

varying vec3 vObjPos;
varying vec3 vObjN;
varying vec3 vWorldPos;

vec3 caustic(vec2 rel) {
  // rel in gem radii, in the gem's spinning frame
  float ca = cos(uGemAng), sa = sin(uGemAng);
  vec2 q = mat2(ca, -sa, sa, ca) * rel;
  float r = length(q);
  float a = atan(q.y, q.x);
  vec3 c = vec3(0.0);
  for (int ch = 0; ch < 3; ch++) {
    float s = 1.0 + 0.09 * (float(ch) - 1.0);      // red spreads less than blue
    float rr = r * s;
    float lobes = pow(0.5 + 0.5 * cos(8.0 * a + rr * 5.0), 18.0) + 0.6 * pow(0.5 + 0.5 * cos(16.0 * a - rr * 9.0 + 1.3), 30.0);
    float spk = smoothstep(0.64, 0.86, vnoise(vec3(q * s * 7.0, 3.1)) * 0.6 + vnoise(vec3(q * s * 19.0, 7.7)) * 0.5);
    float ring = smoothstep(1.25, 0.55, rr) * smoothstep(0.08, 0.35, rr);
    c[ch] = (lobes * 0.8 + spk * 1.4) * ring;
  }
  return c;
}

void main() {
  vec3 p = vObjPos;
  vec3 N = normalize(vObjN);
  vec3 ax = abs(N);
  vec3 q = uHalf - abs(p);   // distance to each face plane

  // --- worn bevel: bend the normal near edges --------------------------------
  float wob = vnoise(p * 9.0) * 0.6 + vnoise(p * 31.0) * 0.4;
  float bevel = 0.010 + 0.028 * wob;
  float edgeD = 10.0;
  vec3 Nb = N;
  for (int j = 0; j < 3; j++) {
    if (ax[j] > 0.5) continue;
    float dj = q[j];
    edgeD = min(edgeD, dj);
    float k = 1.0 - clamp(dj / bevel, 0.0, 1.0);
    vec3 e = vec3(0.0); e[j] = sign(p[j]);
    Nb += e * k * k * 1.6;
  }
  Nb = normalize(Nb);
  float ew = 1.0 - smoothstep(0.0, bevel * 1.8, edgeD);      // edge wear mask
  float chipN = vnoise(p * 38.0) * 0.65 + vnoise(p * 95.0) * 0.35;
  float chip = (1.0 - smoothstep(0.0, 0.05, edgeD)) * smoothstep(0.6, 0.68, chipN);

  float top = step(0.5, N.y);

  // --- stone albedo -----------------------------------------------------------
  float n1 = fbm(p * 2.6);
  float n2 = fbm(p * 13.0 + 3.1);
  float n3 = vnoise(p * 150.0);
  float veinF = fbm(p * vec3(1.3, 2.4, 1.1) + n1 * 1.8);
  float vein = 1.0 - smoothstep(0.0, 0.022, abs(veinF - 0.52));
  float vein2 = 1.0 - smoothstep(0.0, 0.008, abs(fbm(p * 4.0 + 11.0) - 0.5));
  vec3 base = mix(vec3(0.022, 0.022, 0.024), vec3(0.052, 0.049, 0.045), n1);
  base *= 0.8 + 0.4 * n2;
  base += vec3(0.035, 0.034, 0.032) * smoothstep(0.80, 0.97, n3);
  base = mix(base, vec3(0.16, 0.152, 0.14), vein * 0.45 + vein2 * 0.15);
  float rough = mix(0.26, 0.5, n2);
  rough = mix(rough, 0.18, vein * 0.4);

  // smudges / wipe marks on the polished top
  float wipe = smoothstep(0.45, 0.75, fbm(vec3(p.x * 3.0 + p.z * 1.2, p.z * 8.0, 1.0)));
  rough = mix(rough, 0.55, wipe * 0.5 * top);

  // dust: more toward the rim and corners, wiped near the pin
  float rim = smoothstep(0.25, 0.68, max(abs(p.x), abs(p.z)));
  float dust = top * smoothstep(0.42, 0.8, fbm(p * 8.0 + 5.0)) * (0.25 + 0.75 * rim);
  dust += top * step(0.93, vnoise(p * 210.0)) * 0.7 * (0.3 + rim);
  dust = clamp(dust, 0.0, 1.0);
  base = mix(base, vec3(0.20, 0.19, 0.175), dust * 0.5);
  rough = mix(rough, 0.92, dust);

  // edge wear: lighter, rough, chipped
  base = mix(base, vec3(0.11, 0.105, 0.10), ew * 0.6);
  rough = mix(rough, 0.8, ew);
  base *= 1.0 - 0.6 * chip;
  rough = mix(rough, 0.95, chip);

  // drip grime streaks down the sides from the top edge
  float hz = ax.x > 0.5 ? p.z : p.x;
  float streak = smoothstep(0.45, 0.8, vnoise(vec3(hz * 9.0, p.y * 0.7, 2.0)) * 0.75 + vnoise(vec3(hz * 31.0, p.y * 2.0, 5.0)) * 0.25);
  float drip = (1.0 - top) * streak * smoothstep(uHalf.y - 0.9, uHalf.y - 0.05, p.y);
  float lowGrime = (1.0 - top) * smoothstep(uHalf.y - 0.4, uHalf.y - 1.4, p.y);
  base *= 1.0 - 0.45 * drip - 0.35 * lowGrime;
  rough = mix(rough, 0.85, drip);

  // micro normal detail (grain + pits)
  vec3 g = vec3(vnoise(p * 80.0), vnoise(p * 80.0 + 11.0), vnoise(p * 80.0 + 23.0)) - 0.5;
  Nb = normalize(Nb + g * (0.05 + 0.25 * chip + 0.06 * dust));

  // --- lighting ---------------------------------------------------------------
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 R = reflect(-V, Nb);
  float NoV = max(dot(Nb, V), 1e-3);

  // gem shadow on the key light + caustic (top face only)
  float shadow = 0.0;
  vec3 caus = vec3(0.0);
  if (top > 0.5) {
    vec3 L = KEY_DIR;
    float t = (uGemC.y - vWorldPos.y) / L.y;
    vec2 Q = vWorldPos.xz + L.xz * t - uGemC.xz;
    float d = length(Q);
    shadow = 1.0 - smoothstep(uGemR * 0.35, uGemR * 1.25, d);
    caus = caustic(Q / uGemR) * uCaustic;
    // second, sharper caustic from the overhead light, almost straight below
    vec3 L2 = normalize(vec3(0.15, 1.0, 0.1));
    float t2 = (uGemC.y - vWorldPos.y) / L2.y;
    vec2 Q2 = vWorldPos.xz + L2.xz * t2 - uGemC.xz;
    caus += caustic(Q2 / uGemR * 1.3 + 0.2) * uCaustic * 0.35;
    shadow = max(shadow, 0.5 * (1.0 - smoothstep(uGemR * 0.3, uGemR * 1.0, length(Q2))));
  }
  // contact darkening around the pin foot
  float ao = top > 0.5 ? mix(0.55, 1.0, smoothstep(0.03, 0.16, length(p.xz))) : 1.0;

  vec3 irr = envIrradiance(Nb) - keyIrradiance(Nb) * shadow * 0.8;
  vec3 diff = base / PI * (irr * ao + caus * 6.0);

  float F0 = 0.04;
  float F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0) * (1.0 - rough) * (1.0 - rough);
  vec3 spec = env(R, rough) * F * (1.0 - shadow * 0.6 * step(0.0, dot(R, KEY_DIR))) * ao;

  gl_FragColor = vec4(diff + spec, 1.0);
}
