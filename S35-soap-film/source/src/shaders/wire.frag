precision highp float;
#include <common>
#include <env>
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec2 vUv;
uniform float uLen;

// Prefiltered env lookup for a rough metal: a few jittered taps in a cone around R.
vec3 envRough(vec3 R, float rough) {
  vec3 t = normalize(cross(abs(R.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0), R));
  vec3 b = cross(R, t);
  float a = rough * rough * 0.6;
  vec3 s = envColor(R, a) * 0.4;
  s += envColor(R + a * (t * 0.7 + b * 0.3), a) * 0.15;
  s += envColor(R + a * (-t * 0.7 - b * 0.3), a) * 0.15;
  s += envColor(R + a * (b * 0.8 - t * 0.2), a) * 0.15;
  s += envColor(R + a * (-b * 0.8 + t * 0.2), a) * 0.15;
  return s;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 p = vObj;
  float along = vUv.x * uLen;

  // drawn-wire grooves: fine lines along the length perturb the normal around the tube
  float groove = vnoise2(vec2(along * 3.0, vUv.y * 420.0)) - 0.5;
  // direction around the tube = direction along which u (length) stays constant
  vec3 dpdx = dFdx(vWorld), dpdy = dFdy(vWorld);
  vec3 around = dpdx * dFdy(vUv.x) - dpdy * dFdx(vUv.x);
  float al = length(around);
  if (al > 1e-9) N = normalize(N + (around / al) * groove * 0.08);

  // zinc spangle crystals: patchy reflectance and roughness
  float spangle = vnoise3(floor(p * 55.0 + vnoise3(p * 25.0) * 2.0));
  // wear: rust in small blooms, dark grime, bright worn scratches
  float rustN = fbm3(p * 9.0) + 0.3 * fbm3(p * 45.0);
  float rust = smoothstep(0.70, 0.86, rustN);
  float grime = fbm3(p * 20.0 + 4.0);
  float scr = vnoise2(vec2(along * 5.0, vUv.y * 300.0));
  scr = smoothstep(0.75, 0.92, scr) * smoothstep(0.4, 0.7, vnoise2(vec2(along * 1.3, vUv.y * 7.0)));

  // zinc / steel: F0 is the metal colour; slightly warm, darker where grimy
  vec3 F0 = mix(vec3(0.40, 0.40, 0.39), vec3(0.55, 0.54, 0.52), spangle);
  F0 *= mix(0.55, 1.0, smoothstep(0.25, 0.65, grime));
  F0 = mix(F0, vec3(0.72, 0.72, 0.73), scr * 0.7);
  float rough = 0.12 + 0.14 * spangle + 0.25 * (1.0 - smoothstep(0.25, 0.65, grime)) - 0.1 * scr;

  vec3 rustCol = mix(vec3(0.10, 0.035, 0.012), vec3(0.30, 0.12, 0.04), fbm3(p * 70.0));
  float metallic = 1.0 - rust;
  rough = mix(rough, 0.85, rust);
  vec3 spec0 = mix(vec3(0.04), F0, metallic);

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  // Schlick Fresnel, damped by roughness
  vec3 F = spec0 + (max(vec3(1.0 - rough), spec0) - spec0) * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  // the window is very close and huge; keep the wire's view of it in range so the round profile reads
  vec3 spec = F * envRough(R, rough) * 0.22;
  vec3 diff = rustCol * rust * envColor(N, 1.0) * 0.25;
  // tight extra highlight from the lamp so the round profile reads
  vec3 L = normalize(vec3(-0.75, 0.55, 0.35));
  vec3 Hh = normalize(L + V);
  float ggxA = max(rough * rough, 0.02);
  float nh = max(dot(N, Hh), 0.0);
  float dn = ggxA * ggxA / (PI * pow(nh * nh * (ggxA * ggxA - 1.0) + 1.0, 2.0));
  spec += F * vec3(1.0, 0.7, 0.4) * dn * max(dot(N, L), 0.0) * 0.08;
  gl_FragColor = vec4(spec + diff, 1.0);
}
