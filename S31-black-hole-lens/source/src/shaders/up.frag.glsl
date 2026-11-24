// Dual-filter upsample, added onto the next finer level.
precision highp float;
uniform sampler2D tSrc;   // coarser level
uniform sampler2D tBase;  // same-size finer level from the down chain
uniform vec2 uTexel;      // 1 / coarse size
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 o = uTexel;
  vec3 s = vec3(0.0);
  s += texture(tSrc, vUv + vec2(-2.0 * o.x, 0.0)).rgb;
  s += texture(tSrc, vUv + vec2( 2.0 * o.x, 0.0)).rgb;
  s += texture(tSrc, vUv + vec2(0.0, -2.0 * o.y)).rgb;
  s += texture(tSrc, vUv + vec2(0.0,  2.0 * o.y)).rgb;
  s += texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2( o.x, -o.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2(-o.x,  o.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2( o.x,  o.y)).rgb * 2.0;
  fragColor = vec4(s / 12.0 + texture(tBase, vUv).rgb, 1.0);
}
