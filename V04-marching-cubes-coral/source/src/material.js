import * as THREE from 'three';

// Shared GLSL: hashing, value/gradient noise, Worley, and the water colour used for fog + backdrop.
export const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uSunTint;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { f += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return f;
}
// F1, F2 cellular distances
vec2 worley(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z);
    vec3 o = hash33(i + g) * 0.85 + 0.075;
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
vec3 waterColor(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uWaterDeep, uWaterShallow, smoothstep(0.25, 0.95, up));
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunTint * (pow(s, 6.0) * 0.25 + pow(s, 60.0) * 0.6);
  return c;
}
// animated caustic web, projected along the sun direction
float caustic(vec3 wp) {
  vec2 p = (wp.xz - wp.y * uSunDir.xz / max(uSunDir.y, 0.2)) * 0.075;
  float t = uTime * 0.35;
  vec2 w1 = worley(vec3(p, t)).xy;
  vec2 w2 = worley(vec3(p * 1.7 + 3.1, t * 1.3 + 5.0)).xy;
  float c1 = pow(1.0 - smoothstep(0.0, 0.16, w1.y - w1.x), 3.0);
  float c2 = pow(1.0 - smoothstep(0.0, 0.12, w2.y - w2.x), 3.0);
  float patchy = smoothstep(0.3, 0.7, vnoise(vec3(p * 0.6, t * 0.2)));
  return (c1 * 0.6 + c2 * 0.4) * (0.35 + 0.65 * patchy);
}
`;

const VERT_PARS = /* glsl */`
attribute vec2 aux;
varying vec3 vWPos;
varying vec3 vWNor;
varying float vCoral;
varying float vAO;
`;

const FRAG_PARS = /* glsl */`
varying vec3 vWPos;
varying vec3 vWNor;
varying float vCoral;
varying float vAO;
uniform float uTopY;
uniform float uFloorY;
uniform vec3 uAbsorb;
uniform float uFogDensity;
uniform vec3 uCamPos;
float gCaustic = 1.0;
float gCavity = 0.0;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

vec3 coralRamp(float t) {
  // t: 0 = deep base, 1 = shallow tips
  vec3 c0 = srgb(vec3(0.27, 0.13, 0.42));
  vec3 c1 = srgb(vec3(0.62, 0.18, 0.42));
  vec3 c2 = srgb(vec3(0.90, 0.36, 0.30));
  vec3 c3 = srgb(vec3(0.96, 0.60, 0.29));
  vec3 c4 = srgb(vec3(1.00, 0.85, 0.60));
  if (t < 0.3) return mix(c0, c1, t / 0.3);
  if (t < 0.58) return mix(c1, c2, (t - 0.3) / 0.28);
  if (t < 0.84) return mix(c2, c3, (t - 0.58) / 0.26);
  return mix(c3, c4, (t - 0.84) / 0.16);
}

vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}

// Surface height field (world units) plus material outputs, evaluated once per fragment.
float gHeight = 0.0;
float gRough = 0.8;
vec3 gAlbedo = vec3(0.5);

void evalSurface(vec3 wp, vec3 wn, float coral, float pix) {
  float depthT = clamp((wp.y - uFloorY) / (uTopY - uFloorY), 0.0, 1.0);
  // fade high-frequency detail with pixel footprint to keep it from shimmering
  float fineFade = 1.0 - smoothstep(0.08, 0.35, pix);
  float midFade = 1.0 - smoothstep(0.25, 0.9, pix);

  float m = smoothstep(0.35, 0.65, coral);
  vec3 cC = vec3(0.0), cR = vec3(0.0);
  float hC = 0.0, hR = 0.0, rC = 0.5, rR = 0.9, cupC = 0.0, pits = 0.0;
  if (m > 0.001) {
  // ---- coral: polyp cups on a fleshy, gritty surface
  vec2 wc = worley(wp * 2.3);
  float cup = smoothstep(0.42, 0.05, wc.x);          // 1 inside a polyp cup
  float rim = smoothstep(0.05, 0.0, abs(wc.y - wc.x - 0.12)) ; // septa ridges between cups
  float grain = vnoise(wp * 11.0) * fineFade;
  float lumps = fbm(wp * 0.55);
  hC = (-cup * 0.10 + rim * 0.03) * midFade + grain * 0.025 + lumps * 0.05;

  float hue = fbm(vec3(wp.xz * 0.025, 3.0));          // colony-scale variation
  float tC = clamp(depthT + (hue - 0.5) * 0.35, 0.0, 1.0);
  cC = coralRamp(tC);
  cC *= mix(1.0, 0.55, cup * midFade);                // cups are deeper, darker
  cC = mix(cC, cC * vec3(1.15, 1.05, 0.95) + 0.03, rim * midFade);
  // bleached / worn patches and a brown algal film low down and in crevices
  float wear = smoothstep(0.62, 0.78, fbm(wp * 0.35 + 11.0));
  cC = mix(cC, srgb(vec3(0.86, 0.80, 0.72)), wear * 0.45);
  float film = smoothstep(0.45, 0.75, fbm(wp * 0.8 + 4.0) + (1.0 - depthT) * 0.35 + (1.0 - vAO) * 0.5);
  cC = mix(cC, srgb(vec3(0.30, 0.25, 0.14)), film * 0.55);
  cC *= (0.85 + grain * 0.3) * (0.78 + 0.44 * fbm(wp * 0.3 + 2.0));
  rC = mix(0.62, 0.35, cup * midFade) + film * 0.25 + wear * 0.15 + (grain - 0.5) * 0.15;
  cupC = cup * midFade;
  }
  if (m < 0.999) {

  // ---- rock: pitted limestone with algae on top faces and crusts of coralline pink
  float rf = fbm(wp * 0.35);
  pits = smoothstep(0.25, 0.0, worley(wp * 1.3).x) * midFade;
  hR = rf * 0.6 - pits * 0.18 + vnoise(wp * 7.0) * 0.05 * fineFade;
  cR = mix(srgb(vec3(0.42, 0.40, 0.34)), srgb(vec3(0.58, 0.55, 0.47)), rf);
  cR *= 1.0 - pits * 0.45;
  float algae = smoothstep(0.35, 0.8, wn.y) * smoothstep(0.42, 0.62, fbm(wp * 0.22 + 9.0));
  cR = mix(cR, srgb(vec3(0.20, 0.30, 0.12)) * (0.7 + 0.6 * vnoise(wp * 3.0)), algae * 0.85);
  float crust = smoothstep(0.66, 0.74, fbm(wp * 0.5 + 21.0));
  cR = mix(cR, srgb(vec3(0.62, 0.36, 0.42)), crust * 0.7);
  cR *= mix(0.55, 1.0, depthT * 0.6 + 0.4);
  rR = 0.88 - algae * 0.12 - crust * 0.2 + (rf - 0.5) * 0.2;
  }

  gAlbedo = mix(cR, cC, m);
  gRough = clamp(mix(rR, rC, m), 0.25, 1.0);
  gHeight = mix(hR, hC, m);
  gCavity = mix(pits, cupC, m);
}
`;

export function makeReefMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vWNor = normalize(mat3(modelMatrix) * objectNormal);
       vCoral = aux.x; vAO = aux.y;`
    );
    const lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= gCaustic;'
    );
    shader.fragmentShader = GLSL_COMMON + FRAG_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 wn0 = normalize(vWNor);
        float pix = length(fwidth(vWPos));
        evalSurface(vWPos, wn0, vCoral, pix);
        diffuseColor.rgb = gAlbedo * mix(0.55, 1.0, vAO);
        gCaustic = 0.75 + 1.3 * caustic(vWPos) * smoothstep(-0.2, 0.6, wn0.y);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 dH = vec2(dFdx(gHeight), dFdy(gHeight)) * 1.0;
          normal = perturbN(-vViewPosition, normal, dH, faceDirection);
        }`)
      .replace('#include <lights_fragment_begin>', lightsBegin)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float occl = vAO * (1.0 - gCavity * 0.5);
        reflectedLight.indirectDiffuse *= occl;
        reflectedLight.indirectSpecular *= occl;
        reflectedLight.directDiffuse *= mix(1.0, vAO, 0.35);`)
      .replace('#include <fog_fragment>', `
        {
          vec3 toFrag = vWPos - uCamPos;
          float dist = length(toFrag);
          vec3 dir = toFrag / max(dist, 1e-3);
          gl_FragColor.rgb *= exp(-dist * uAbsorb);
          float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, waterColor(dir), fogF);
        }`);
  };
  return mat;
}
