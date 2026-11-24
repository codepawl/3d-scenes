precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform float uThresh;
varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / 18.0);
    vec3 c = texture2D(tSrc, vUv + uDir * float(i)).rgb;
    c = max(c - uThresh, 0.0);
    s += c * w; wsum += w;
  }
  gl_FragColor = vec4(s / wsum, 1.0);
}
