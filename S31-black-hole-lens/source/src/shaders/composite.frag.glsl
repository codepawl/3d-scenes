// Final composite: HDR + bloom -> filmic tonemap -> grain + dither. Original work.
precision highp float;
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uFrame;
uniform float uExposure;
uniform float uBloom;
in vec2 vUv;
out vec4 fragColor;

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// Filmic curve (Hable-style rational, re-fit by hand)
vec3 filmic(vec3 x) {
  x = max(x, 0.0);
  vec3 a = x * (2.51 * x + 0.03);
  vec3 b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / b, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 hdr = texture(tHdr, vUv).rgb;
  vec3 bloom = texture(tBloom, vUv).rgb;
  vec3 c = hdr + bloom * uBloom;
  // gentle vignette
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.35 * dot(q, q);
  c = filmic(c * uExposure);
  c = toSRGB(c);
  vec3 h = vec3(pcg3d(uvec3(uvec2(gl_FragCoord.xy), uint(uFrame)))) / 4294967295.0;
  // luminance-weighted film grain + triangular dither against banding
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += (h.x - 0.5) * 0.035 * (1.0 - lum) * sqrt(lum + 0.02);
  c += (h.y + h.z - 1.0) / 255.0;
  fragColor = vec4(c, 1.0);
}
