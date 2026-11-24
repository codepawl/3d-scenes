// Face-culling voxel mesher with per-vertex ambient occlusion, one geometry per 4-layer slab.
import * as THREE from 'three';
import { NX, NY, NZ, VS, SLAB } from './grid.js';

// corners in CCW order seen from outside; u/v = tangent axes
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
const AO_CURVE = [0.42, 0.62, 0.81, 1.0];

export function meshSlab(grid, s) {
  const j0 = s * SLAB, j1 = Math.min(NY, j0 + SLAB);
  const pos = [], nor = [], ao = [], dep = [], ind = [];
  const P = (i, j, k) => grid.isPrinted(i, j, k) ? 1 : 0;
  let v = 0;
  for (let j = j0; j < j1; j++)
    for (let k = 0; k < NZ; k++)
      for (let i = 0; i < NX; i++) {
        if (!grid.isPrinted(i, j, k)) continue;
        const d = grid.dep[i + NX * (k + NZ * j)];
        for (const f of FACES) {
          const [nx, ny, nz] = f.n;
          if (P(i + nx, j + ny, k + nz)) continue;
          const axis = nx ? 0 : ny ? 1 : 2;
          const ua = (axis + 1) % 3, va = (axis + 2) % 3;
          const a4 = [0, 0, 0, 0];
          for (let q = 0; q < 4; q++) {
            const c = f.c[q];
            const base = [i + nx, j + ny, k + nz];
            const du = [0, 0, 0], dv = [0, 0, 0];
            du[ua] = c[ua] ? 1 : -1; dv[va] = c[va] ? 1 : -1;
            const s1 = P(base[0] + du[0], base[1] + du[1], base[2] + du[2]);
            const s2 = P(base[0] + dv[0], base[1] + dv[1], base[2] + dv[2]);
            const cc = P(base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2]);
            const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            a4[q] = a;
            pos.push((i + c[0] - NX / 2) * VS, (j + c[1]) * VS, (k + c[2] - NZ / 2) * VS);
            nor.push(nx, ny, nz);
            ao.push(AO_CURVE[a]);
            dep.push(d);
          }
          if (a4[0] + a4[2] >= a4[1] + a4[3]) ind.push(v, v + 1, v + 2, v, v + 2, v + 3);
          else ind.push(v + 1, v + 2, v + 3, v + 1, v + 3, v);
          v += 4;
        }
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('aDep', new THREE.Float32BufferAttribute(dep, 1));
  g.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (j0 + j1) * 0.5 * VS, 0), 3.0);
  return g;
}

// PLA material: per-voxel tint, FDM layer grooves, dust, varying roughness, cooling heat glow.
export function makePlaMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({ color: 0xb24a18, roughness: 0.55, metalness: 0.0, dithering: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aAO; attribute float aDep;
varying float vAO; varying float vDep; varying vec3 vObj; varying vec3 vObjN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vAO = aAO; vDep = aDep; vObj = position; vObjN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vAO; varying float vDep; varying vec3 vObj; varying vec3 vObjN;
float h13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vn3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h13(i),h13(i+vec3(1,0,0)),f.x),mix(h13(i+vec3(0,1,0)),h13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h13(i+vec3(0,0,1)),h13(i+vec3(1,0,1)),f.x),mix(h13(i+vec3(0,1,1)),h13(i+vec3(1,1,1)),f.x),f.y),f.z); }
float plaN, plaGroove, plaTop;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  const float VS = ${VS.toFixed(3)};
  vec3 cell = floor(vObj / VS - vObjN * 0.5 + 1e-3);
  float h = h13(cell + 17.0);
  vec3 base = diffuseColor.rgb * (0.84 + 0.3 * h);
  float side = 1.0 - abs(vObjN.y);
  plaTop = max(vObjN.y, 0.0);
  // two extrusion beads per voxel layer, faded by screen-space frequency to avoid moire
  float ly = vObj.y / VS * 2.0;
  float fw = fwidth(ly);
  float g = abs(fract(ly) - 0.5) * 2.0;
  plaGroove = mix(smoothstep(0.55, 1.0, g), 0.25, smoothstep(0.25, 0.6, fw));
  base *= mix(1.0, 1.0 - 0.28 * plaGroove, side);
  float lt = (vObj.x + vObj.z) / VS * 1.5;
  float ft = abs(fract(lt) - 0.5) * 2.0;
  float tg = mix(smoothstep(0.6, 1.0, ft), 0.2, smoothstep(0.25, 0.6, fwidth(lt)));
  base *= mix(1.0, 1.0 - 0.16 * tg, plaTop);
  plaN = vn3(vObj * 9.0) * 0.6 + vn3(vObj * 37.0) * 0.4;
  base *= 0.8 + 0.3 * plaN;
  base *= 1.0 - 0.25 * smoothstep(0.55, 0.85, vn3(vObj * vec3(4.0, 1.5, 4.0) + 3.0));
  // dust settles on upward faces, soot near the bed
  base = mix(base, vec3(0.42, 0.40, 0.37), plaTop * smoothstep(0.55, 0.8, vn3(vObj * 14.0)) * 0.35);
  base *= mix(0.78, 1.0, smoothstep(0.0, 0.35, vObj.y));
  diffuseColor.rgb = base * vAO;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(0.38 + 0.3 * plaN + 0.18 * plaGroove + 0.12 * plaTop, 0.2, 0.95);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ float age = uTime - vDep;
  float heat = age >= 0.0 ? exp(-age * 22.0) : 0.0;
  totalEmissiveRadiance += vec3(1.0, 0.42, 0.12) * heat * 1.1; }`);
  };
  return m;
}
