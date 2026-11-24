// Patches a MeshLambertMaterial so window / lamp / beacon voxels glow.
// The decision is made per voxel cell in the fragment shader, from the voxel coordinate,
// so greedy-merged window faces still light up one window at a time.
export function patchCityMaterial(mat) {
  const uniforms = {
    uProgress: { value: 0 },
    uTime: { value: 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aKind;
varying vec3 vVox;
varying vec3 vVoxN;
varying float vKind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vVox = transformed;
vVoxN = normal;
vKind = aKind;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uProgress;
uniform float uTime;
varying vec3 vVox;
varying vec3 vVoxN;
varying float vKind;
// pcg3d integer hash (Jarzynski & Olano 2020)
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3i(ivec3 c) { return vec3(pcg3d(uvec3(c + 4096)) & 0xffffffu) / 16777216.0; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 cityEmissive = vec3(0.0);
if (vKind > 0.5) {
  vec3 N = floor(vVoxN + 0.5); // exact axis normal (interpolation is not bit-exact)
  ivec3 cell = ivec3(floor(vVox - N * 0.5));
  vec2 f = abs(N.x) > 0.5 ? vVox.zy : (abs(N.z) > 0.5 ? vVox.xy : vVox.xz);
  vec2 g = fract(f);
  vec2 fw = max(fwidth(f), vec2(1e-4));
  if (vKind < 1.5) {
    // ---- window: pane inside a light frame; whole rooms switch on together
    vec2 m = smoothstep(vec2(0.1) - fw, vec2(0.1) + fw, g) * (1.0 - smoothstep(vec2(0.9) - fw, vec2(0.9) + fw, g));
    float pane = m.x * m.y * step(abs(N.y), 0.5);
    // fade the frame detail out where the pattern gets sub-pixel (prevents moire)
    float detail = 1.0 - smoothstep(0.1, 0.3, max(fw.x, fw.y));
    pane = mix(0.8, pane, detail);
    diffuseColor.rgb = mix(diffuseColor.rgb * 2.6, diffuseColor.rgb, pane);
    ivec3 room = ivec3(cell.x / 3, (cell.y - 2) / 3, cell.z / 3) + ivec3(N * 997.0);
    vec3 h = hash3i(room);
    float on = smoothstep(h.x, h.x + 0.006, uProgress * 0.8 - 0.04);
    vec3 warm = mix(vec3(1.0, 0.62, 0.30), vec3(1.0, 0.85, 0.62), h.y);
    vec3 lightCol = h.z > 0.88 ? vec3(0.55, 0.72, 1.0) : warm;
    float inner = 0.8 + 0.4 * g.y;                // a bit brighter near the ceiling
    float bright = mix(0.9, 2.0, fract(h.y * 7.31));
    cityEmissive = pane * on * lightCol * bright * inner;
    // unlit glass catches a little sky
    cityEmissive += pane * (1.0 - on) * vec3(0.02, 0.028, 0.05);
  } else if (vKind < 2.5) {
    // ---- street lamp
    vec3 h = hash3i(cell);
    float on = smoothstep(0.0, 0.02, uProgress - 0.18 - h.x * 0.1);
    cityEmissive = on * vec3(1.0, 0.78, 0.45) * 4.0;
  } else {
    // ---- aircraft warning beacon
    vec3 h = hash3i(cell);
    float blink = smoothstep(0.55, 0.6, fract(uTime * 0.7 + h.x)) * (1.0 - smoothstep(0.9, 0.95, fract(uTime * 0.7 + h.x)));
    cityEmissive = (0.15 + blink) * vec3(1.0, 0.12, 0.05) * 9.0;
  }
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += cityEmissive;`);
  };
  return uniforms;
}
