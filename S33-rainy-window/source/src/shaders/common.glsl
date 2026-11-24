// ---- shared helpers -------------------------------------------------------
// PCG-style integer hash (after Jarzynski & Olano, JCGT 2020).
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash32(vec2 p) {
  uvec3 u = pcg3(uvec3(ivec3(floor(p), 17)));
  return vec3(u) * (1.0 / 4294967295.0);
}
float hash12(vec2 p) { return hash32(p).x; }
float hash11(float p) { return hash32(vec2(p, 3.17)).y; }

// value noise + fbm (original)
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
