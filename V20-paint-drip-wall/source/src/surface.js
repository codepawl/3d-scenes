// Shader patch for MeshStandard/PhysicalMaterial. All variation is texel-matched to the voxel grid:
// one texel per voxel cell (albedo + roughness), so wall and paint share one scale. Faces stay flat;
// relief comes from the voxel geometry itself. Wet paint gets clearcoat and slight per-voxel tilt (glints).
const NOISE = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;
#ifdef WET_PAINT
varying float vWet;
#endif
// hash13 by Dave Hoskins ("Hash without Sine", MIT)
float h13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
// value noise sampled on integer cells only (blocky, voxel-matched)
float cellNoise(vec3 c, float s) {
  vec3 p = c / s;
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

export function patchSurface(mat, o) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = { value: o.grain };
    shader.uniforms.uRough = { value: o.rough };
    if (o.wet) shader.defines = { ...(shader.defines || {}), WET_PAINT: '' };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
#ifdef WET_PAINT
attribute float aWet;
varying float vWet;
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  wn = mat3(instanceMatrix) * wn;
  #endif
  vWPos = (modelMatrix * wp).xyz;
  vWNrm = normalize(mat3(modelMatrix) * wn);
  #ifdef WET_PAINT
  vWet = aWet;
  #endif
}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uGrain, uRough;
${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 cell = floor(vWPos - vWNrm * 0.02 + 0.5);
float nCell = h13(cell + 17.0);
float nPatch = cellNoise(cell, 7.0);
diffuseColor.rgb *= 1.0 + uGrain * ((nCell - 0.5) + (nPatch - 0.5) * 0.8);
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef WET_PAINT
roughnessFactor = mix(0.7, 0.12, vWet);
#endif
roughnessFactor = clamp(roughnessFactor + uRough * ((nCell - 0.5) * 1.2 + (nPatch - 0.5)), 0.04, 1.0);
`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef WET_PAINT
{
  // wet paint bulges: tilt each voxel face slightly so running paint catches glints
  vec2 tilt = vec2(h13(cell + 3.1), h13(cell + 9.7)) - 0.5;
  normal = normalize(normal + (viewMatrix * vec4(tilt * 0.14 * vWet, 0.0, 0.0)).xyz);
}
#endif
`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#if defined(WET_PAINT) && defined(USE_CLEARCOAT)
material.clearcoat *= vWet;
#endif
`);
  };
  mat.customProgramCacheKey = () => (o.wet ? 'paint-v2' : 'wall-v2');
}
