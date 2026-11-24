// Cloud + light-shaft pass. MRT:
//   o0 = cloud along the view ray (sky pixels) or the mirrored ray (ocean pixels): rgb premultiplied, a = transmittance
//   o1 = in-scattered sun light in the air column below the cloud base (light shafts)
uniform int uSteps;
uniform int uLightSteps;
uniform int uRaySteps;

in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;

const float EXT = 55.0;   // extinction per km at density 1

float ign(vec2 p) {       // interleaved gradient noise, Jorge Jimenez (2014)
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float lightOD(vec3 p) {
  float od = 0.0, t = 0.0, len = 0.04;
  for (int i = 0; i < 8; i++) {
    if (i >= uLightSteps) break;
    float s = t + len * 0.5;
    od += cloudDensity(p + uSunDir * s, i < 2) * len;
    t += len; len *= 1.9;
  }
  return od * EXT * 1.3;
}

vec3 scatterSun(float od, float c) {
  // multiple-scattering octaves (Wrenninge 2013 style)
  vec3 L = vec3(0.0);
  float a = 1.0, b = 1.0, g = 1.0;
  for (int k = 0; k < 4; k++) {
    float ph = mix(hg(c, 0.80 * g), hg(c, -0.20 * g), 0.35);
    L += vec3(b * exp(-od * a) * ph);
    a *= 0.45; b *= 0.55; g *= 0.6;
  }
  return L;
}

vec4 marchClouds(vec3 o, vec3 d, int N, float jit, float tBias) {
  if (heightOf(o) > CLOUD_B) return vec4(0, 0, 0, 1);
  float t0 = shellUp(o, d, CLOUD_B);
  float t1 = shellUp(o, d, CLOUD_T);
  if (t0 < 0.0 || t0 + tBias > MAX_DIST) return vec4(0, 0, 0, 1);
  t1 = min(t1, min(MAX_DIST - tBias, t0 + 40.0));
  float dt = max((t1 - t0) / float(N), 0.03);
  float c = dot(d, uSunDir);
  vec3 sunC = sunColor() * 4.0 * PI;
  vec3 amb = skyAmbient();
  vec3 haze = hazeColor(d);
  float T = 1.0;
  vec3 col = vec3(0.0);
  float t = t0 + dt * jit;
  float emptyRun = 0.0;
  for (int i = 0; i < 256; i++) {
    if (i >= N || t > t1) break;
    vec3 p = o + d * t;
    float h;
    float sh = cloudShape(p, h);
    if (sh > 0.0) {
      float dens = cloudDetail(p, h, sh, true);
      if (dens > 0.002) {
        float od = lightOD(p);
        float powder = 1.0 - 0.6 * exp(-od * 1.5);
        vec3 Ls = sunC * scatterSun(od, c) * powder
                + amb * (0.12 + 0.55 * h * h)
                + vec3(0.02, 0.03, 0.04) * (1.0 - h);   // ocean bounce
        float sigma = dens * EXT;
        float Ts = exp(-sigma * dt);
        float fogT = exp(-(t + tBias) / 26.0);
        vec3 seg = Ls * (1.0 - Ts);                      // albedo ~1, energy conserving
        col += T * mix(haze * (1.0 - Ts), seg, fogT);
        T *= Ts;
        if (T < 0.01) { T = 0.0; break; }
      }
      t += dt;
    } else {
      // empty space: stride proportional to how far outside the shape we are
      t += dt * (1.0 + clamp(-sh * 4.0, 0.0, 2.0));
    }
  }
  return vec4(col, T);
}

vec3 marchShafts(vec3 ro, vec3 rd, float tEnd, float jit) {
  float c = dot(rd, uSunDir);
  float ph = mix(hg(c, 0.72), hg(c, 0.0), 0.3);
  const float BETA = 0.025;  // aerosol scattering per km
  float dt = tEnd / float(uRaySteps);
  vec3 acc = vec3(0.0);
  float t = dt * jit;
  for (int i = 0; i < 64; i++) {
    if (i >= uRaySteps) break;
    vec3 p = ro + rd * t;
    float vis = exp(-sunShadowOD(p) * 1.5);
    // light only lives below the cloud base; fade near the sea surface haze
    acc += vis * exp(-t * BETA * 1.4) * dt;
    t += dt;
  }
  // contrast form: lit air adds light, shadowed air removes part of the sky's average in-scatter,
  // so shafts read as alternating bright and dark rays rather than a uniform glow
  float unshadowed = (1.0 - exp(-tEnd * BETA * 1.4)) / (BETA * 1.4);
  return (acc - 0.65 * unshadowed) * sunColor() * BETA * ph * 4.0 * PI * 2.2;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + ndc.x * uTanHalf * uAspect * uCamRight + ndc.y * uTanHalf * uCamUp);
  vec3 ro = uCamPos;
  float jit = fract(ign(gl_FragCoord.xy) + uFrame * 0.618034);

  float tOcean = shellDown(ro, rd, 0.0);
  vec4 cl;
  float tEnd;
  if (tOcean > 0.0) {
    vec3 p = ro + rd * tOcean;
    vec3 n = normalize(vec3(-p.x / EARTH_R, 1.0, -p.z / EARTH_R));
    vec3 r = reflect(rd, n);
    p += n * 0.001;
    cl = marchClouds(p, r, uSteps / 2, jit, tOcean);
    tEnd = min(tOcean, 14.0);
  } else {
    cl = marchClouds(ro, rd, uSteps, jit, 0.0);
    float tb = shellUp(ro, rd, CLOUD_B);
    tEnd = min(tb, 14.0);
  }
  vec3 shafts = marchShafts(ro, rd, tEnd, fract(jit + 0.5));
  o0 = cl;
#ifdef DEBUG_COV
  { float tb0 = shellUp(ro, rd, CLOUD_B); vec3 pb = ro + rd * tb0; float hh; float dd = cloudShape(pb + vec3(0, 0.05, 0), hh); o0 = vec4(0, 0, 0, dd > 0.0 ? 0.0 : 1.0); if (tOcean > 0.0) o0 = vec4(0,0,0,0.5); }
#endif
  o1 = vec4(shafts, 1.0);  // may be negative (half-float target)
}
