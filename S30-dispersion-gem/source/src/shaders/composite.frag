// HDR composite: bloom, exposure, ACES fit (Narkowicz 2015, see CREDITS.md),
// vignette, film grain and triangular dither against banding, sRGB encode.
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uSceneTexel;
uniform float uBloom;
uniform float uExposure;
uniform float uFrame;
uniform float uSS;   // supersampling factor of tScene
varying vec2 vUv;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float h(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 col;
  if (uSS > 1.5) {
    // tScene is 2x: four bilinear taps cover a 4x4 block -> clean downsample
    col = 0.25 * (texture2D(tScene, vUv + uSceneTexel * vec2(-1.0, -1.0)).rgb +
                  texture2D(tScene, vUv + uSceneTexel * vec2( 1.0, -1.0)).rgb +
                  texture2D(tScene, vUv + uSceneTexel * vec2(-1.0,  1.0)).rgb +
                  texture2D(tScene, vUv + uSceneTexel * vec2( 1.0,  1.0)).rgb);
    col = mix(col, texture2D(tScene, vUv).rgb, 0.0);
  } else {
    col = texture2D(tScene, vUv).rgb;
  }
  col += texture2D(tBloom, vUv).rgb * uBloom;
  col *= uExposure;
  vec2 c = vUv - 0.5;
  col *= mix(1.0, 0.55, smoothstep(0.25, 0.95, dot(c * vec2(1.4, 1.0), c * vec2(1.4, 1.0)) * 2.0));
  col = aces(col);
  float g = h(gl_FragCoord.xy + fract(uFrame * 0.618) * 97.0) - 0.5;
  col *= 1.0 + g * 0.035;
  col = toSRGB(col);
  float dth = h(gl_FragCoord.xy * 1.37 + uFrame) + h(gl_FragCoord.xy * 0.73 - uFrame) - 1.0;
  col += dth / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
