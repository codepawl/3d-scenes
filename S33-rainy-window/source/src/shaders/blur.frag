// separable Gaussian (9 weights folded into 5 bilinear taps)
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;   // texel step * direction
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 0.2270270;
  c += texture(tSrc, vUv + uDir * 1.3846154).rgb * 0.3162162;
  c += texture(tSrc, vUv - uDir * 1.3846154).rgb * 0.3162162;
  c += texture(tSrc, vUv + uDir * 3.2307692).rgb * 0.0702703;
  c += texture(tSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
  fragColor = vec4(c, 1.0);
}
