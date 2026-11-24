// Shader patches on MeshStandardMaterial: per-texel grain, grime, cracks, sparkle, wetness, water ripples.
import * as THREE from 'three';

// hash13 from "Hash without Sine" by Dave Hoskins (MIT), plus value noise built on it.
const GLSL_NOISE = /* glsl */`
float h13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vn3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = h13(i), b = h13(i+vec3(1,0,0)), c = h13(i+vec3(0,1,0)), d = h13(i+vec3(1,1,0));
  float e = h13(i+vec3(0,0,1)), g = h13(i+vec3(1,0,1)), h = h13(i+vec3(0,1,1)), k = h13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y), mix(mix(e,g,f.x),mix(h,k,f.x),f.y), f.z);
}
`;

export function makeTerrainMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.55 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aInfo; varying vec2 vInfo; varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vInfo = aInfo; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vInfo; varying vec3 vWPos; varying vec3 vWN; uniform float uTime;
${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float tRough = 0.9;
{
  vec3 N = normalize(vWN); vec3 an = abs(N);
  float axis = an.y > 0.5 ? 1.0 : (an.x > 0.5 ? 2.0 : 3.0);
  vec2 fuv = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
  float plane = floor(dot(vWPos, N) + 0.5);
  vec2 loc = fract(fuv);
  vec2 tx = floor(fuv * 8.0);
  float g = h13(vec3(tx, plane * 7.0 + axis * 131.0));
  float g2 = h13(vec3(floor(fuv * 4.0), plane * 3.0 + axis * 71.0 + 5.0));
  float L = vn3(vWPos * 0.16) * 0.6 + vn3(vWPos * 0.55 + 3.0) * 0.4;
  float e = min(min(loc.x, 1.0 - loc.x), min(loc.y, 1.0 - loc.y));
  int m = int(vInfo.x + 0.5);
  vec3 col = diffuseColor.rgb;
  if (m == 0) {           // rock / stone / gravel
    col *= 0.82 + 0.3 * g * g2 + 0.08 * g;
    float cr = abs(vn3(vWPos * vec3(2.3, 1.1, 2.3)) - 0.5);
    col *= mix(0.62, 1.0, smoothstep(0.012, 0.04, cr));
    if (g > 0.94) col *= 0.7;
    col *= mix(0.86, 1.0, smoothstep(0.0, 0.09, e));
    tRough = 0.72 + 0.22 * g2;
  } else if (m == 1) {    // sand
    col *= 0.92 + 0.14 * g;
    if (N.y > 0.5) col *= 0.93 + 0.07 * sin(vWPos.x * 4.1 - vWPos.z * 3.0 + L * 9.0);
    if (g > 0.975) { col *= 1.25; }
    tRough = 0.93 - 0.08 * g;
  } else if (m == 2) {    // snow
    col *= 0.95 + 0.07 * g2;
    if (N.y < 0.5) col *= mix(0.88, 1.0, smoothstep(0.0, 0.5, loc.y));
    tRough = 0.78 - 0.12 * g2;
    if (g > 0.982) { col += 0.18; tRough = 0.15; }
  } else if (m == 3) {    // ice
    float cr = abs(vn3(vWPos * 1.4 + 11.0) - 0.5);
    float crack = 1.0 - smoothstep(0.006, 0.02, cr);
    col *= 0.9 + 0.12 * L;
    col = mix(col, vec3(0.92, 0.96, 1.0), crack * 0.65 + step(0.96, g) * 0.3);
    tRough = mix(0.06 + 0.18 * L, 0.55, crack);
  } else if (m == 4) {    // wood / dry stems
    float stripe = h13(vec3(an.y > 0.5 ? tx : vec2(tx.x, 0.0), plane + axis * 17.0));
    col *= 0.72 + 0.32 * stripe + 0.06 * g;
    col *= mix(0.8, 1.0, smoothstep(0.0, 0.1, e));
    tRough = 0.82;
  } else if (m == 5) {    // needles, leaves, cactus, reeds
    col *= 0.7 + 0.45 * g * (0.7 + 0.3 * g2);
    col *= mix(0.82, 1.0, smoothstep(0.0, 0.1, e));
    tRough = 0.6 + 0.3 * g;
  } else if (m == 6) {    // mud / dirt
    col *= 0.82 + 0.22 * g;
    float pud = smoothstep(0.55, 0.62, L);
    col *= mix(1.0, 0.8, pud);
    tRough = mix(0.9 - 0.1 * g, 0.35, pud);
  } else {                // grass / moss
    col *= 0.76 + 0.36 * g;
    if (g > 0.82) col *= vec3(1.18, 1.15, 0.85);
    col *= mix(0.85, 1.0, smoothstep(0.0, 0.08, e));
    tRough = 0.82;
  }
  col *= 0.84 + 0.3 * L;                       // large-scale grime / staining
  float wet = vInfo.y;                          // wetland sector: darkened, glossier surfaces
  col *= mix(1.0, 0.8, wet);
  tRough = mix(tRough, tRough * 0.72, wet);
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = tRough;`);
  };
  return m;
}

export function makeWaterMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 1.0, envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aInfo; varying vec2 vInfo; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vInfo = aInfo; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vInfo; varying vec3 vWPos; uniform float uTime;
${GLSL_NOISE}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
// world units per pixel; drives both band-limiting of the ripples and a rougher, filtered far field
float wf = max(length(dFdx(vWPos)), length(dFdy(vWPos)));
roughnessFactor = mix(0.13, 0.28, smoothstep(0.04, 0.45, wf));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vWPos.xz; float t = uTime;
  // each wave band fades out before its wavelength drops below ~5 pixels (analytic band-limiting)
  float a1 = 1.0 - smoothstep(0.4, 1.0, wf * 0.5);
  float a2 = 1.0 - smoothstep(0.4, 1.0, wf * 1.3);
  float a3 = 1.0 - smoothstep(0.4, 1.0, wf * 2.6);
  vec2 d = vec2(0.0);
  vec2 k1 = vec2(0.8, 0.6), k2 = vec2(-0.5, 0.866), k3 = vec2(0.31, -0.95), k4 = vec2(0.97, 0.24), k5 = vec2(-0.8, -0.6);
  d += k1 * cos(dot(p, k1) * 0.5 + t * 0.9) * 0.03 * a1;
  d += k2 * cos(dot(p, k2) * 0.45 - t * 0.7) * 0.025 * a1;
  d += k3 * cos(dot(p, k3) * 1.3 + t * 1.7) * 0.016 * a2;
  d += k4 * cos(dot(p, k4) * 1.25 - t * 1.5) * 0.016 * a2;
  d += k5 * cos(dot(p, k5) * 2.6 + t * 2.3) * 0.01 * a3;
  // rain impact rings (wetland only), also band-limited
  float wet = vInfo.y;
  float aR = 1.0 - smoothstep(0.4, 1.0, wf * 9.0);
  if (wet * aR > 0.01) {
    for (int k = 0; k < 2; k++) {
      vec2 q = p * 0.5 + float(k) * 0.43;
      vec2 cell = floor(q); vec2 lp = fract(q);
      float ph = h13(vec3(cell, float(k) * 9.0 + 1.0));
      float age = fract(t * 0.9 + ph);
      vec2 c = vec2(h13(vec3(cell, 3.0 + float(k))), h13(vec3(cell, 5.0 + float(k)))) * 0.4 + 0.3;
      vec2 v = (lp - c) * 2.0; float r = length(v);
      float rr = age * 0.9;
      float ring = sin((r - rr) * 9.0) * smoothstep(0.35, 0.0, abs(r - rr)) * (1.0 - age);
      d += (v / max(r, 1e-3)) * ring * 0.12 * wet * aR;
    }
  }
  vec3 dn = normalize(vec3(-d.x, 1.0, -d.y));
  normal = normalize((viewMatrix * vec4(dn, 0.0)).xyz);
}`);
  };
  return m;
}
