// Display pass: bloom from mip chain, ACES tone map, vignette, dither. Original work except the ACES fit
// (Krzysztof Narkowicz, "ACES Filmic Tone Mapping Curve", public domain/CC0 style blog snippet).
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform int uFrame;
uniform float uExposure;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec3 col = textureLod(uTex, vUv, 0.0).rgb;
  vec3 bloom = textureLod(uTex, vUv, 2.0).rgb * 0.30 + textureLod(uTex, vUv, 3.5).rgb * 0.30
             + textureLod(uTex, vUv, 5.0).rgb * 0.25 + textureLod(uTex, vUv, 6.5).rgb * 0.15;
  col += max(bloom - 0.6, 0.0) * 0.12 + bloom * 0.015;
  col *= uExposure;
  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.55 * dot(q * vec2(1.1, 1.3), q * vec2(1.1, 1.3));
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  // triangular dither against banding in the dark gradients
  float n = h12(gl_FragCoord.xy + float(uFrame % 64) * 17.0) + h12(gl_FragCoord.yx * 1.37 + 3.1) - 1.0;
  col += n / 255.0;
  fragColor = vec4(col, 1.0);
}
