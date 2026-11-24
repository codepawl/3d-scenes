// 9-tap tent upsample, added onto the next larger level. Original work.
uniform sampler2D tSmall;
uniform sampler2D tCur;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0);
  s += texture2D(tSmall, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  s += texture2D(tSmall, vUv + vec2( 0.0, -1.0) * uTexel).rgb * 2.0;
  s += texture2D(tSmall, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  s += texture2D(tSmall, vUv + vec2(-1.0,  0.0) * uTexel).rgb * 2.0;
  s += texture2D(tSmall, vUv).rgb * 4.0;
  s += texture2D(tSmall, vUv + vec2( 1.0,  0.0) * uTexel).rgb * 2.0;
  s += texture2D(tSmall, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  s += texture2D(tSmall, vUv + vec2( 0.0,  1.0) * uTexel).rgb * 2.0;
  s += texture2D(tSmall, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  gl_FragColor = vec4(s / 16.0 + texture2D(tCur, vUv).rgb, 1.0);
}
