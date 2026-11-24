// Shared GLSL snippets: hashing, noise, voronoi, caustics and the sky radiance model.

export const noiseGlsl = /* glsl */ `
float creekHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 creekHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float creekHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float creekNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = creekHash12(i);
  float b = creekHash12(i + vec2(1.0, 0.0));
  float c = creekHash12(i + vec2(0.0, 1.0));
  float d = creekHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float creekNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = creekHash13(i);
  float n100 = creekHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = creekHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = creekHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = creekHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = creekHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = creekHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = creekHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
float creekFbm2(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    total += amplitude * creekNoise2(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return total;
}
float creekFbm3(vec3 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 3; octave++) {
    total += amplitude * creekNoise3(p);
    p = p * 2.07 + vec3(11.3, 5.1, 7.7);
    amplitude *= 0.5;
  }
  return total;
}
// Distance to the nearest and second nearest cell point, plus the nearest cell id.
vec3 creekVoronoi(vec2 p, out vec2 cellId) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float nearest = 8.0;
  float second = 8.0;
  cellId = cell;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 point = creekHash22(cell + offset) * 0.8 + 0.1;
      float distance = length(offset + point - local);
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
        cellId = cell + offset;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  return vec3(nearest, second, second - nearest);
}
// Animated caustic network (iterated trigonometric warp), returns roughly 0..1.
float creekCaustics(vec2 p, float time) {
  vec2 i = p;
  float c = 1.0;
  float intensity = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / intensity), p.y / (cos(i.y + t) / intensity)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 4.0);
}
`;

// Sky radiance shared by the sky dome, the environment map and water reflections.
export const skyUniformsGlsl = /* glsl */ `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec3 uSkyGlow;
uniform float uSunGlow;
uniform float uSunDisc;
uniform float uStars;
uniform float uMoon;
uniform float uClouds;
uniform float uSkyTime;
`;

export const skyFunctionGlsl = /* glsl */ `
vec3 creekSky(vec3 direction, bool detailed) {
  direction = normalize(direction);
  float height = direction.y;
  float horizonBlend = pow(1.0 - clamp(height, 0.0, 1.0), 3.2);
  vec3 sky = mix(uSkyZenith, uSkyHorizon, horizonBlend);
  float sunAmount = max(dot(direction, uSunDirection), 0.0);
  float horizonBand = exp(-abs(height) * 7.0);
  sky += uSkyGlow * horizonBand * (0.35 + 0.65 * pow(sunAmount, 3.0));
  sky += uSunColor * uSunGlow * (pow(sunAmount, 12.0) * 0.35 + pow(sunAmount, 120.0) * 1.2);
  if (detailed) {
    if (uClouds > 0.001 && height > 0.0) {
      vec2 cloudUv = direction.xz / (height + 0.12) * 1.6 + vec2(uSkyTime * 0.004, uSkyTime * 0.002);
      float cloud = creekFbm2(cloudUv * 1.3);
      cloud = smoothstep(0.52 - uClouds * 0.25, 0.85, cloud) * smoothstep(0.0, 0.15, height);
      vec3 cloudColor = mix(uSkyHorizon * 1.15, uSunColor * 1.1 + uSkyHorizon * 0.4, pow(sunAmount, 4.0));
      sky = mix(sky, cloudColor, cloud * 0.85);
    }
    sky += uSunColor * uSunDisc * smoothstep(0.99955, 0.99975, sunAmount);
    if (uMoon > 0.001) {
      float moon = smoothstep(0.99935, 0.9996, sunAmount);
      sky += vec3(0.9, 0.95, 1.0) * moon * uMoon * 6.0 + vec3(0.6, 0.7, 1.0) * pow(sunAmount, 300.0) * uMoon * 0.6;
    }
    if (uStars > 0.001 && height > 0.0) {
      vec3 starDirection = direction * 180.0;
      vec3 cell = floor(starDirection);
      float star = creekHash13(cell);
      vec3 local = fract(starDirection) - 0.5;
      float twinkle = 0.6 + 0.4 * sin(uSkyTime * 2.0 + star * 40.0);
      float point = smoothstep(0.18, 0.0, length(local)) * step(0.985, star);
      sky += vec3(0.85, 0.9, 1.0) * point * twinkle * uStars * smoothstep(0.02, 0.25, height) * 3.0;
    }
  }
  float below = smoothstep(0.0, -0.08, height);
  sky = mix(sky, uSkyGround, below);
  return sky;
}
`;
