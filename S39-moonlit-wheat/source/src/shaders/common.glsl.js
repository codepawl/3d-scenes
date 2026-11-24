// Shared GLSL: hashing, value noise, fbm, wind field, night-sky/fog colour. All original.
export const common = /* glsl */ `
uniform float uTime;
uniform vec3  uMoonDir;     // unit vector towards the moon
uniform vec2  uWindDir;     // unit xz direction the wind blows towards
uniform float uWindStrength;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; }
  return s / 0.875;
}
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; }
  return s / 0.96875;
}

// Rolling gust field: large scrolling patches + travelling wave fronts along the wind.
float gustField(vec2 p, float t) {
  vec2 q = p - uWindDir * t * 6.0;
  float patches = fbm3(q * vec2(0.11, 0.07));
  float along = dot(p, uWindDir);
  float warp = vnoise(p * 0.04 + 3.1) * 5.0;
  float front = 0.5 + 0.5 * sin(along * 0.45 - t * 2.4 + warp + vnoise(p * 0.12) * 2.5);
  front = front * front * front;
  float g = smoothstep(0.42, 0.72, patches) * 0.8 + front * 0.6 * smoothstep(0.3, 0.6, patches);
  return clamp(g, 0.0, 1.2) * uWindStrength;
}

// Night sky radiance along a direction (no disc / stars). Also the fog colour, so the field melts into it.
vec3 skyBase(vec3 dir) {
  float h = clamp(dir.y, -0.2, 1.0);
  vec3 zenith  = vec3(0.003, 0.005, 0.016);
  vec3 horizon = vec3(0.028, 0.040, 0.072);
  vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.75, h), 0.55));
  float mu = max(dot(dir, uMoonDir), 0.0);
  col += vec3(0.30, 0.36, 0.48) * pow(mu, 9.0) * 0.38;
  col += vec3(0.20, 0.25, 0.36) * pow(mu, 3.0) * 0.14;
  return col;
}

// Triangular dither to break banding after 8-bit quantisation.
float dither(vec2 fc, float t) {
  return (hash12(fc + fract(t * 7.13) * 91.7) + hash12(fc * 1.37 + 17.0) - 1.0) / 255.0;
}
`;
