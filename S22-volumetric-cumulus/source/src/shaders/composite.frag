// Full-res composite: sky, sun, ocean, cloud buffer upsample, shafts, tonemap.
uniform sampler2D tCloud;
uniform sampler2D tShaft;
uniform vec2 uCloudRes;
uniform float uExposure;
uniform int uDebug;

in vec2 vUv;
out vec4 fragColor;

// 5-tap soft upsample of the (possibly half-res) cloud buffers
vec4 tap(sampler2D t, vec2 uv) {
  vec2 o = 0.75 / uCloudRes;
  return texture(t, uv) * 0.4
       + (texture(t, uv + vec2(o.x, o.y)) + texture(t, uv + vec2(-o.x, o.y))
        + texture(t, uv + vec2(o.x, -o.y)) + texture(t, uv + vec2(-o.x, -o.y))) * 0.15;
}

// directional ocean waves: returns slope (dh/dx, dh/dz); lost = slope variance removed by LOD
vec2 noiseGrad(vec2 p) {
  const float e = 0.08;
  return vec2(vnoise2(p + vec2(e, 0.0)) - vnoise2(p - vec2(e, 0.0)),
              vnoise2(p + vec2(0.0, e)) - vnoise2(p - vec2(0.0, e))) / (2.0 * e);
}
vec2 oceanSlope(vec2 x, float footprint, out float lost) {
  vec2 s = vec2(0.0);
  lost = 0.0;
  const float WIND = -1.2;                       // mean wave heading (rad)
  float wl = 0.09;                               // km
  float amp = 0.045;                             // slope amplitude (A*k)
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float ang = WIND + (hash12(vec2(fi, 3.7)) - 0.5) * 2.2;
    vec2 dir = vec2(cos(ang), sin(ang));
    float k = 2.0 * PI / wl;
    float w = sqrt(9.81e-3 * k);                 // deep-water dispersion (km, s)
    float ph = dot(dir, x) * k - w * uTime * 1.5 + hash12(vec2(fi, 9.1)) * 6.283;
    float fade = clamp(1.6 - footprint * k * 0.6, 0.0, 1.0);
    // sharpened crests: slope of a trochoid-ish profile
    float c = cos(ph), sn = sin(ph);
    s += dir * amp * c * (1.0 + 0.5 * sn) * fade;
    lost += amp * amp * 0.5 * (1.0 - fade * fade);
    wl *= 0.79; amp *= 0.96;
  }
  // broadband capillary chop from value-noise gradients, filtered by footprint
  float k1 = 1.0 / 0.006, k2 = 1.0 / 0.0025;
  float f1 = clamp(1.5 - footprint * k1 * 1.2, 0.0, 1.0);
  float f2 = clamp(1.5 - footprint * k2 * 1.2, 0.0, 1.0);
  s += noiseGrad(x * k1 + uTime * vec2(0.3, -0.8)) * 0.035 * f1;
  s += noiseGrad(ROT2 * x * k2 - uTime * vec2(0.6, 0.9)) * 0.025 * f2;
  lost += 0.035 * 0.035 * (1.0 - f1 * f1) + 0.025 * 0.025 * (1.0 - f2 * f2);
  return s;
}

vec3 aces(vec3 x) {   // Narkowicz 2015 fit
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + ndc.x * uTanHalf * uAspect * uCamRight + ndc.y * uTanHalf * uCamUp);
  vec3 ro = uCamPos;
  vec3 sunC = sunColor();
  float pixAng = 2.0 * uTanHalf / uRes.y;

  vec4 cl = tap(tCloud, vUv);
  vec3 shafts = tap(tShaft, vUv).rgb;

  vec3 col;
  float tOcean = shellDown(ro, rd, 0.0);
  if (tOcean > 0.0) {
    vec3 p = ro + rd * tOcean;
    float grazing = max(-rd.y, 0.004);
    float footprint = tOcean * pixAng / grazing;
    float lost;
    vec2 sl = oceanSlope(p.xz + uOffset, footprint, lost);
    vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
    vec3 v = -rd;
    if (dot(n, v) < 0.02) n = normalize(n + v * (0.02 - dot(n, v)));
    vec3 r = reflect(rd, n);
    r.y = abs(r.y);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);

    // reflected sky + clouds (cloud buffer holds the mirrored march; distort by the wave normal)
    vec2 ruv = vUv + vec2(dot(n, uCamRight), -abs(dot(n.xz, normalize(uCamFwd.xz)))) * 0.25;
    vec4 rc = tap(tCloud, ruv);
    vec3 refl = (skyColor(r) * rc.a + rc.rgb) * 0.85;

    // sun glint (Beckmann lobe, roughness widened by sub-pixel waves)
    float sunVis = exp(-sunShadowOD(p));
    vec3 hv = normalize(uSunDir + v);
    float a2 = 0.004 + lost * 2.0;
    float nh = max(dot(n, hv), 1e-3);
    float tan2 = (1.0 - nh * nh) / (nh * nh);
    float D = exp(-tan2 / a2) / (PI * a2 * nh * nh * nh * nh);
    float spec = D * fres / (4.0 * max(dot(n, v), 0.05));
    vec3 glint = sunC * spec * max(dot(n, uSunDir), 0.0) * sunVis * 3.0;

    // water body: deep blue-green + forward subsurface on wave flanks facing the sun
    float sss = pow(max(dot(rd, uSunDir), 0.0), 3.0) * max(sl.x * uSunDir.x + sl.y * uSunDir.z, 0.0) * 6.0;
    vec3 body = vec3(0.004, 0.018, 0.026) * (skyAmbient() * 0.9 + sunC * 0.03 * sunVis)
              + vec3(0.02, 0.08, 0.07) * sunC * sss * sunVis * 0.05;

    col = mix(body, refl, fres) + glint;
    float fogT = exp(-tOcean / 22.0);
    col = mix(hazeColor(rd), col, fogT);
  } else {
    col = skyColor(rd);
    // sun disc + tight aureole
    float c = dot(rd, uSunDir);
    float disc = smoothstep(0.99996, 0.99999, c);
    col += sunC * (disc * 900.0 + pow(max(c, 0.0), 1800.0) * 6.0);
    col = col * cl.a + cl.rgb;
  }
  // bright shafts add light; shadowed air darkens the scene neutrally (no hue shift)
  float sLum = dot(shafts, vec3(0.3, 0.6, 0.1));
  float cLum = max(dot(col, vec3(0.3, 0.6, 0.1)), 1e-4);
  col = sLum >= 0.0 ? col + shafts : col * max(1.0 + sLum / cLum, 0.6);
  if (uDebug == 1) col = vec3(1.0 - cl.a) * 0.5;
  if (uDebug == 2) col = skyColor(rd) * 4.0;
  if (uDebug == 3) col = shafts * 4.0;
  if (uDebug == 4) col = cl.rgb * 4.0;

  col *= uExposure;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  // triangular dither against 8-bit banding
  float dn = hash12(gl_FragCoord.xy + fract(uFrame * 0.137) * 91.0) + hash12(gl_FragCoord.yx * 1.37 + 13.0) - 1.0;
  col += dn / 255.0;
  fragColor = vec4(col, 1.0);
}
