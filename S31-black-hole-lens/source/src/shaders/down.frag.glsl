// Dual-filter downsample (technique: M. Bjorge, SIGGRAPH 2015). First pass also soft-thresholds.
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;     // 1 / source size
uniform float uPrefilter;
in vec2 vUv;
out vec4 fragColor;
vec3 pre(vec3 c) {
  if (uPrefilter < 0.5) return c;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - 0.6, 0.0);
  k = k * k / (k + 0.4 + 1e-4) + max(l - 1.0, 0.0) * 0.0;
  return c * (k / max(l, 1e-4));
}
void main() {
  vec2 o = uTexel;
  vec3 s = pre(texture(tSrc, vUv).rgb) * 4.0;
  s += pre(texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb);
  s += pre(texture(tSrc, vUv + vec2( o.x, -o.y)).rgb);
  s += pre(texture(tSrc, vUv + vec2(-o.x,  o.y)).rgb);
  s += pre(texture(tSrc, vUv + vec2( o.x,  o.y)).rgb);
  fragColor = vec4(s / 8.0, 1.0);
}
