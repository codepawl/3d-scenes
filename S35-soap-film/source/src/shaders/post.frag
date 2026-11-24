precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uFrame;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// ACES filmic fit (Krzysztof Narkowicz, 2015)
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * 0.06;
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  c *= 1.0 - 0.35 * dot(q, q);
  c = aces(c * 1.7);
  c = toSRGB(c);
  // film grain + dither to stop banding in the dark gradients
  float g = hash(gl_FragCoord.xy + fract(uFrame * 0.618) * 100.0) + hash(gl_FragCoord.xy * 1.7 + uFrame) - 1.0;
  c += g * (1.5 / 255.0) + g * 0.012 * (1.0 - c);
  gl_FragColor = vec4(c, 1.0);
}
