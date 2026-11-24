// Dispersive gem: analytic ray tracing inside a convex polytope (facet planes
// in object space), exact dielectric Fresnel, total internal reflection, and a
// per-wavelength index of refraction. Original work.

uniform vec4 uPlanes[NPL];   // xyz = outward normal, w = plane offset (n.x = w)
uniform mat3 uRot;           // object -> world rotation
uniform vec3 uCamObj;        // camera position in object space
uniform float uDisp;         // dispersion multiplier (1 = real diamond)
uniform float uFrame;

varying vec3 vObjPos;
varying vec3 vObjN;

vec3 W(vec3 d) { return normalize(uRot * d); }

// unpolarised Fresnel reflectance, eta = n_incident / n_transmitted, cosi > 0
float fresnelD(float cosi, float eta) {
  float sint2 = eta * eta * (1.0 - cosi * cosi);
  if (sint2 >= 1.0) return 1.0;
  float cost = sqrt(1.0 - sint2);
  float rs = (eta * cosi - cost) / (eta * cosi + cost);
  float rp = (cosi - eta * cost) / (cosi + eta * cost);
  return 0.5 * (rs * rs + rp * rp);
}

float gss(float x, float m, float s) { float d = (x - m) / s; return exp(-0.5 * d * d); }

// wavelength (micrometres) -> linear RGB weight; analytic fit, original
vec3 spectralRGB(float l) {
  return vec3(gss(l, 0.600, 0.042) + 0.28 * gss(l, 0.425, 0.022),
              gss(l, 0.545, 0.042),
              gss(l, 0.455, 0.030));
}

// Follow one wavelength through the stone. Starts just inside the entry facet.
vec3 traceInside(vec3 p, vec3 d, float ior) {
  vec3 acc = vec3(0.0);
  float thr = 1.0;
  for (int b = 0; b < MAXB; b++) {
    float tmin = 1e5;
    vec3 nx = vec3(0.0, 1.0, 0.0);
    for (int i = 0; i < NPL; i++) {
      vec4 pl = uPlanes[i];
      float dn = dot(pl.xyz, d);
      if (dn > 1e-5) {
        float t = max((pl.w - dot(pl.xyz, p)) / dn, 0.0);
        if (t < tmin) { tmin = t; nx = pl.xyz; }
      }
    }
    p += d * tmin;
    thr *= exp(-0.04 * tmin);           // faint body absorption
    float cosi = dot(d, nx);
    float F = fresnelD(cosi, ior);
    if (F < 1.0) {
      vec3 t = refract(d, -nx, ior);
      acc += thr * (1.0 - F) * env(W(t), 0.0);
    }
    thr *= F;
    d = reflect(d, nx);
    if (thr < 0.015) break;
  }
  acc += thr * env(W(d), 0.25) * 0.7;
  return acc;
}

// fine polishing scratches in facet space
float scratches(vec2 uv) {
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    float ang = float(i) * 2.13 + 0.4;
    vec2 dir = vec2(cos(ang), sin(ang));
    float x = dot(uv, dir) * 22.0 + float(i) * 3.7;
    float id = floor(x);
    float fx = fract(x) - 0.5;
    float along = dot(uv, vec2(-dir.y, dir.x));
    float h = hash12(vec2(id, float(i) * 17.0));
    float seg = smoothstep(0.55, 0.75, sin(along * (5.0 + h * 9.0) + h * 40.0));
    s += step(0.86, h) * seg * (1.0 - smoothstep(0.0, 0.07, abs(fx)));
  }
  return clamp(s, 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vObjN);
  vec3 p = vObjPos;
  float isGirdle = 1.0 - smoothstep(0.10, 0.2, abs(n.y));

  vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(n, t1);
  vec2 uvf = vec2(dot(p, t1), dot(p, t2));

  float scr = scratches(uvf);
  float smudge = fbm(p * 5.0 + 2.0);
  float grime = smoothstep(0.52, 0.8, smudge);          // oily fingerprint haze
  vec3 jitter = vec3(vnoise(p * 70.0), vnoise(p * 70.0 + 7.3), 0.0) - 0.5;
  vec3 nb = normalize(n + (t1 * jitter.x + t2 * jitter.y) * (0.006 + 0.03 * grime) + isGirdle * (t1 * (vnoise(p * 260.0) - 0.5) * 0.25));

  vec3 rd = normalize(p - uCamObj);
  if (dot(nb, rd) > -0.01) nb = n;
  float cosi = -dot(rd, nb);
  float F = fresnelD(cosi, 1.0 / 2.42);
  float rough = 0.02 * grime + isGirdle * 0.5;
  vec3 refl = env(W(reflect(rd, nb)), rough);

  // interleaved gradient noise (Jimenez 2014) for wavelength jitter
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 trans = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int k = 0; k < NS; k++) {
    float lam = 0.40 + 0.30 * (float(k) + ign) / float(NS);
    vec3 w = spectralRGB(lam);
    float ior = 2.3818 + 0.0121 * uDisp / (lam * lam);   // Cauchy fit for diamond
    vec3 dIn = refract(rd, nb, 1.0 / ior);
    trans += w * traceInside(p + dIn * 1e-4, dIn, ior);
    wsum += w;
  }
  trans /= wsum;

  vec3 col = refl * F + trans * (1.0 - F);
  // frosted girdle: scattering, low contrast
  col = mix(col, envIrradiance(W(n)) * 0.06 + trans * 0.25, isGirdle * 0.8);
  // fingerprint haze: milky layer that lifts blacks and dulls fire a little
  col = mix(col, col * 0.85 + envIrradiance(W(nb)) * 0.012, grime * 0.6);
  // scratches catch light
  col += scr * (0.04 + 0.6 * env(W(reflect(rd, n)), 0.6)) * 0.35;
  // dust motes on the upward facets
  float dust = step(0.996, hash13(floor(p * 120.0))) * smoothstep(0.3, 0.9, n.y);
  col += dust * envIrradiance(W(n)) * 0.02;

  gl_FragColor = vec4(col, 1.0);
}
