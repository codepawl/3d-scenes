// 5-tap box/bilinear downsample with soft threshold on the first level. Original work.
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uFirst;
varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = tap(vec2(-1.0, -1.0)), b = tap(vec2(1.0, -1.0)), c = tap(vec2(-1.0, 1.0)), d = tap(vec2(1.0, 1.0));
  vec3 e = tap(vec2(0.0));
  vec3 col = (a + b + c + d) * 0.125 + e * 0.5;
  if (uFirst > 0.5) {
    col = min(col, vec3(64.0));
    float l = max(col.r, max(col.g, col.b));
    float k = max(l - uThreshold, 0.0);
    col *= k * k / (k + 0.5) / max(l, 1e-4);
  }
  gl_FragColor = vec4(col, 1.0);
}
