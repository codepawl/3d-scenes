// Brushed brass pin and foot: lengthwise brushing, tarnish patches, fingermarks. Original work.
varying vec3 vObjPos;
varying vec3 vObjN;
varying vec3 vWorldPos;

void main() {
  vec3 p = vWorldPos;
  vec3 N = normalize(vObjN); // pin parts are unrotated
  float ang = atan(p.z, p.x);
  float brush = vnoise(vec3(ang * 40.0, p.y * 3.0, 0.0)) * 0.6 + vnoise(vec3(ang * 160.0, p.y * 6.0, 4.0)) * 0.4;
  float tarnish = smoothstep(0.45, 0.8, fbm(p * 30.0));
  vec3 F0 = mix(vec3(0.95, 0.74, 0.42), vec3(0.32, 0.25, 0.18), tarnish * 0.8);
  F0 *= 0.85 + 0.25 * brush;
  float rough = mix(0.22, 0.6, tarnish) + brush * 0.1;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 T = vec3(0.0, 1.0, 0.0);
  vec3 Nb = normalize(N + T * (brush - 0.5) * 0.15);
  vec3 R = reflect(-V, Nb);
  float NoV = max(dot(Nb, V), 0.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0) * 0.6;
  vec3 col = env(R, rough) * F + envIrradiance(Nb) * 0.01 * tarnish;
  gl_FragColor = vec4(col, 1.0);
}
