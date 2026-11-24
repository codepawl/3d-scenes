// Terrain (patched MeshStandardMaterial), water and sky shaders.
import * as THREE from 'three';
import { N } from './world.js';

// Shared GLSL: hashes / value noise (original).
const NOISE = /* glsl */`
float h13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h12(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), f.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vn2(p); p=p*2.07+vec2(1.7,9.2); a*=0.5; } return s; }
`;

export const shared = {
  uTime: { value: 0 },
  uLevel: { value: 9 },
  uGrid: { value: null },
  uOffset: { value: new THREE.Vector2(-N / 2, -N / 2) },
  uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
  uFogColor: { value: new THREE.Color(0x9fc2d8) },
  uFogDensity: { value: 0.0019 },
};

export function makeTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMat; attribute float aAO;
        varying float vMat; varying float vAO; varying vec3 vVox; varying vec3 vLocal; varying vec3 vN; varying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMat = aMat; vAO = aAO; vN = normal; vLocal = position;
        vVox = floor(position - normal * 0.5);
        vWP = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uLevel; uniform sampler2D uGrid; uniform vec3 uSunDir;
        varying float vMat; varying float vAO; varying vec3 vVox; varying vec3 vLocal; varying vec3 vN; varying vec3 vWP;
        ${NOISE}
        vec3 matColor(int m, float j){
          if(m==1) return mix(vec3(0.76,0.64,0.45), vec3(0.85,0.74,0.54), j);     // sand
          if(m==2) return mix(vec3(0.30,0.48,0.17), vec3(0.42,0.56,0.21), j);     // grass
          if(m==3) return mix(vec3(0.42,0.30,0.20), vec3(0.50,0.37,0.24), j);     // dirt
          if(m==4) return mix(vec3(0.40,0.39,0.37), vec3(0.55,0.53,0.49), j);     // rock
          if(m==5) return mix(vec3(0.62,0.56,0.42), vec3(0.72,0.65,0.48), j);     // seabed
          if(m==6) return mix(vec3(0.34,0.23,0.14), vec3(0.42,0.29,0.17), j);     // wood
          if(m==7) return mix(vec3(0.18,0.38,0.14), vec3(0.28,0.47,0.17), j);     // leaves
          return mix(vec3(0.45,0.43,0.40), vec3(0.62,0.58,0.52), j);              // gravel
        }
        float gRough; float gWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          int m = int(vMat + 0.5);
          vec3 an = abs(vN);
          vec2 fuv = an.x > 0.5 ? vLocal.zy : (an.y > 0.5 ? vLocal.xz : vLocal.xy);
          float fax = dot(vLocal, vN);
          float vj = h13(vVox + 0.37);                           // per-voxel tint
          vec3 col = matColor(m, vj);
          // texel grain: 6 texels per voxel face, faded with screen footprint to avoid shimmer
          vec2 tx = floor(fuv * 6.0);
          float grain = h13(vec3(tx, fax * 7.13 + vMat));
          float fw = clamp(1.4 - length(fwidth(fuv)) * 6.0, 0.0, 1.0);
          col *= 1.0 + (grain - 0.5) * 0.3 * fw;
          // larger blotches: wear and grime across surfaces
          float blot = fbm2((vWP.xz + vWP.y * 0.7) * 0.18);
          col *= 0.78 + 0.42 * blot;
          // grass sides: dirt with a ragged grass lip
          if (m == 2 && vN.y < 0.5) {
            float lip = fract(vLocal.y) - (0.72 - 0.18 * h13(vec3(tx.x, vVox.y, fax)));
            col = lip > 0.0 ? col : matColor(3, vj) * (0.86 + 0.28 * blot);
          }
          // moss / lichen on rock tops, dark streaks on rock sides
          if (m == 4) {
            if (vN.y > 0.5) col = mix(col, vec3(0.33,0.40,0.20), smoothstep(0.55, 0.75, fbm2(vWP.xz * 0.3)) * 0.7);
            else col *= 0.85 + 0.2 * vn2(vec2(fuv.x * 3.0, fuv.y * 0.4));
          }
          if (m == 1 || m == 5) {
            float speck = step(0.93, h13(vec3(floor(fuv * 14.0), fax + 3.0)));
            col *= 1.0 - speck * 0.35 * fw;
            if (vN.y > 0.5) col *= 0.94 + 0.08 * sin(vWP.x * 2.6 + vWP.z * 1.1 + vn2(vWP.xz * 0.7) * 4.0) * fw;
          }
          // grime in AO creases
          float ao = mix(0.35, 1.0, vAO);
          col *= ao;
          gRough = 0.85 + 0.12 * grain;
          if (m == 7) gRough = 0.7;

          // ----- tide state from the grid -----
          vec2 cell = clamp(vVox.xz, 0.0, ${N - 1}.0);
          vec4 g = texture2D(uGrid, (cell + 0.5) / ${N}.0);
          float y = vLocal.y;
          gWet = clamp((g.y - vVox.y - 0.35) * 1.6, 0.0, 1.0);
          if (m == 6 || m == 7 || m == 2) gWet *= 0.3;
          // wet sand: darker, more saturated, glossy; puddle speckles of sheen
          float wetDark = (m == 1 || m == 5 || m == 8) ? 1.0 : 0.6;
          vec3 wetCol = col * vec3(0.40, 0.36, 0.30) * mix(1.0, 0.75, wetDark - 0.6);
          col = mix(col, wetCol, gWet);
          float puddle = smoothstep(0.62, 0.72, fbm2(vWP.xz * 0.45 + 3.1)) * step(0.5, vN.y);
          gRough = mix(gRough, mix(0.6 + 0.2 * vn2(fuv * 4.0 + fax), 0.25, puddle), gWet);
          // foam on the swash line
          float foamBand = g.z * clamp(1.0 - abs(y - uLevel - 0.15) * 1.6, 0.0, 1.0);
          float fn = fbm2(vWP.xz * 1.3 + vec2(uTime * 0.35, -uTime * 0.2));
          float foam = smoothstep(0.45, 0.75, foamBand * (0.55 + fn * 0.9));
          col = mix(col, vec3(0.93, 0.95, 0.94), foam * 0.9);
          gRough = mix(gRough, 0.55, foam);
          // underwater: tint + caustics
          float dep = uLevel - vWP.y;
          if (dep > 0.0) {
            vec2 cp = vWP.xz * 0.55;
            float c1 = vn2(cp + vec2(uTime * 0.6, uTime * 0.4));
            float c2 = vn2(cp * 1.3 - vec2(uTime * 0.5, -uTime * 0.3));
            float caus = pow(1.0 - abs(c1 - c2), 6.0);
            col *= 1.0 + caus * 1.4 * exp(-dep * 0.35) * max(vN.y, 0.3);
            col = mix(col, col * vec3(0.55, 0.85, 0.9), clamp(dep * 0.25, 0.0, 0.8));
          }
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`);
  };
  return mat;
}

export function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...shared, cameraPos: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      varying vec3 vWP;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uLevel; uniform sampler2D uGrid; uniform vec2 uOffset; uniform vec3 uSunDir;
      uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 cameraPos;
      varying vec3 vWP;
      ${NOISE}
      vec4 grid(vec2 c){ // manual bilinear over the nearest-filtered float grid
        vec2 p = c - 0.5; vec2 i = floor(p), f = fract(p);
        vec4 a = texture2D(uGrid, (clamp(i, 0.0, ${N - 1}.0) + 0.5) / ${N}.0);
        vec4 b = texture2D(uGrid, (clamp(i + vec2(1,0), 0.0, ${N - 1}.0) + 0.5) / ${N}.0);
        vec4 d = texture2D(uGrid, (clamp(i + vec2(0,1), 0.0, ${N - 1}.0) + 0.5) / ${N}.0);
        vec4 e = texture2D(uGrid, (clamp(i + vec2(1,1), 0.0, ${N - 1}.0) + 0.5) / ${N}.0);
        return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
      }
      float waves(vec2 p){
        return vn2(p * 0.35 + vec2(uTime * 0.45, uTime * 0.2)) * 0.6 + vn2(p * 0.9 - vec2(uTime * 0.3, -uTime * 0.55)) * 0.3
             + vn2(p * 2.3 + vec2(uTime * 0.9, uTime * 0.7)) * 0.12;
      }
      void main(){
        vec2 c = vWP.xz - uOffset;
        bool inside = all(greaterThan(c, vec2(0.0))) && all(lessThan(c, vec2(${N}.0)));
        vec4 g = inside ? grid(c) : vec4(1.0, 0.0, 0.0, 99.0);
        float depth = max(uLevel - g.x, 0.0);
        float edgeD = min(min(c.x, c.y), min(${N}.0 - c.x, ${N}.0 - c.y));
        depth = mix(14.0, depth, smoothstep(0.0, 24.0, inside ? edgeD : 0.0));
        // normal from wave field
        float e = 0.15, h0 = waves(vWP.xz);
        vec3 n = normalize(vec3(-(waves(vWP.xz + vec2(e,0)) - h0) / e * 0.35, 1.0, -(waves(vWP.xz + vec2(0,e)) - h0) / e * 0.35));
        vec3 V = normalize(cameraPos - vWP);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n);
        vec3 sky = mix(vec3(0.70,0.80,0.86), vec3(0.32,0.53,0.75), clamp(R.y * 1.5, 0.0, 1.0));
        float spec = pow(max(dot(R, uSunDir), 0.0), 220.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.12;
        vec3 shallow = vec3(0.18, 0.62, 0.60), deep = vec3(0.03, 0.20, 0.34);
        vec3 body = mix(shallow, deep, 1.0 - exp(-depth * 0.32));
        body *= 0.75 + 0.35 * max(dot(n, uSunDir), 0.0);
        float alpha = mix(0.22, 0.96, 1.0 - exp(-depth * 0.42));
        vec3 col = mix(body, sky, fres);
        alpha = max(alpha, fres * 0.9);
        // shore foam: edge + bands rolling in, broken up by noise
        float dist = g.w;
        float fn = fbm2(vWP.xz * 0.9 + vec2(uTime * 0.25, uTime * 0.1));
        float edge = smoothstep(0.55, 0.0, depth) * (0.6 + 0.6 * fn);
        float band = smoothstep(0.75, 0.95, sin(dist * 1.25 - uTime * 2.1 + fn * 2.5) * 0.5 + 0.5) * exp(-dist * 0.35) * step(0.5, dist);
        float foam = clamp(edge + band * smoothstep(0.35, 0.6, fn) + g.z * 0.5 * fn, 0.0, 1.0);
        foam = smoothstep(0.3, 0.7, foam);
        col = mix(col, vec3(0.92, 0.95, 0.95), foam);
        alpha = max(alpha, foam * 0.95);
        col += spec * (1.0 - foam);
        // fog
        float fd = length(cameraPos - vWP);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * fd * fd);
        col = mix(col, uFogColor, fogF);
        alpha = mix(alpha, 1.0, fogF);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSunDir: shared.uSunDir, uFogColor: shared.uFogColor },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uSunDir; uniform vec3 uFogColor; varying vec3 vD;
      void main(){
        float t = clamp(vD.y, 0.0, 1.0);
        vec3 c = mix(uFogColor, vec3(0.30, 0.52, 0.78), pow(t, 0.55));
        float s = max(dot(normalize(vD), uSunDir), 0.0);
        c += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.18);
        c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 128.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(geo, mat);
}
