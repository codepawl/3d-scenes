import * as THREE from 'three';

// Original value-noise / fbm helpers (hash on a wrapped lattice to keep sin() precise).
export const NOISE_GLSL = /* glsl */`
float vhash(vec3 p){ p = mod(p, 289.0); return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = vhash(i), b = vhash(i+vec3(1,0,0)), c = vhash(i+vec3(0,1,0)), d = vhash(i+vec3(1,1,0));
  float e = vhash(i+vec3(0,0,1)), g = vhash(i+vec3(1,0,1)), h = vhash(i+vec3(0,1,1)), k = vhash(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float fbm(vec3 p){ float s = 0.0, a = 0.5; for(int o=0;o<4;o++){ s += a*vnoise(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; } return s / 0.9375; }
// screen-space derivative bump (Mikkelsen-style surface gradient)
vec3 bumpNormal(vec3 surfPos, vec3 N, float h, float scale){
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, N), r2 = cross(N, sx);
  float det = dot(sx, r1);
  float dhx = dFdx(h) * scale, dhy = dFdy(h) * scale;
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - grad);
}
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
`;

export function makeVoxelMaterial(S, GX, GY, GZ) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uS = { value: S };
    sh.uniforms.uGrid = { value: new THREE.Vector3(GX, GY, GZ) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aGrid; uniform float uS; varying vec3 vGridPos; varying vec3 vObjN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGridPos = aGrid + position / uS + 0.5; vObjN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGrid; varying vec3 vGridPos; varying vec3 vObjN;
        ${NOISE_GLSL}
        float gH; float gRough;`)
      .replace('#include <map_fragment>', `
        vec3 gp = vGridPos;
        vec3 an = abs(vObjN);
        float row = floor(gp.y);
        float bxf = (gp.x + mod(row, 2.0)) * 0.5;
        vec3 bid = vec3(floor(bxf), row, floor(gp.z * 0.4));
        float dy = min(fract(gp.y), 1.0 - fract(gp.y));
        float dx = min(fract(bxf), 1.0 - fract(bxf)) * 2.0;
        float zf = gp.z * 0.4;
        float dz = min(fract(zf), 1.0 - fract(zf)) * 2.5;
        float md = an.x > 0.5 ? min(dy, dz) : (an.y > 0.5 ? min(dx, dz) : min(dx, dy));
        float mw = 0.07 + 0.05 * vnoise(gp * 5.0);
        float mortar = 1.0 - smoothstep(mw, mw + 0.05, md);
        // is this face on the original outer skin of the wall, or a freshly broken interior face?
        float outer = 0.0;
        if (an.z > 0.5) outer = step(gp.z, 0.02) + step(uGrid.z - 0.02, gp.z);
        else if (an.x > 0.5) outer = step(gp.x, 0.02) + step(uGrid.x - 0.02, gp.x);
        else outer = 1.0;
        float fresh = 1.0 - clamp(outer, 0.0, 1.0);
        float rb = vhash(bid), rb2 = vhash(bid + 17.0);
        vec3 brick = mix(vec3(0.44, 0.25, 0.19), vec3(0.60, 0.39, 0.29), rb);
        brick = mix(brick, vec3(0.34, 0.18, 0.13), step(0.86, rb2));
        brick = mix(brick, vec3(0.70, 0.52, 0.38), step(rb2, 0.07));
        float grain = fbm(gp * 7.0);
        float speck = smoothstep(0.72, 0.8, vnoise(gp * 23.0));
        float pits = smoothstep(0.75, 0.85, vnoise(gp * 11.0 + 5.0));
        brick *= 0.78 + 0.42 * grain;
        brick = mix(brick, brick * 0.5, speck * 0.7);
        vec3 freshBrick = mix(vec3(0.72, 0.40, 0.27), vec3(0.62, 0.33, 0.22), grain) * (0.85 + 0.3 * vnoise(gp * 31.0));
        vec3 mort = vec3(0.60, 0.57, 0.52) * (0.75 + 0.4 * fbm(gp * 12.0));
        vec3 col = mix(mix(brick, freshBrick, fresh * 0.75), mort, mortar);
        float hgt = gp.y / uGrid.y;
        // weathering only on the old skin
        float w = 1.0 - fresh * 0.85;
        float base = 1.0 - smoothstep(0.0, 0.2 + 0.14 * fbm(vec3(gp.x * 0.25, 0.0, gp.z * 0.3)), hgt);
        col = mix(col, col * vec3(0.42, 0.44, 0.34), base * 0.8 * w);
        float streak = fbm(vec3(gp.x * 1.1, gp.y * 0.07, gp.z * 0.4));
        float soot = smoothstep(0.4, 0.75, streak) * smoothstep(0.1, 0.9, hgt);
        col *= 1.0 - 0.6 * soot * w;
        // rain run-off: thin dark vertical drips
        float drip = smoothstep(0.6, 0.9, vnoise(vec3(gp.x * 4.0, gp.y * 0.12, 1.0))) * smoothstep(0.3, 1.0, hgt);
        col *= 1.0 - 0.3 * drip * w;
        float blot = fbm(gp * 0.3 + 3.0);
        col *= mix(1.0, 0.62 + 0.5 * blot, w);
        col = mix(col, vec3(dot(col, vec3(0.33))), 0.25 * w * blot);
        // efflorescence (pale salt bloom) in patches near the mortar
        float eff = smoothstep(0.62, 0.8, fbm(gp * 0.9 + 9.0)) * w;
        col = mix(col, vec3(0.78, 0.76, 0.70), eff * 0.35 * (0.4 + mortar));
        col *= 1.0 - 0.35 * pits;
        diffuseColor.rgb = toLin(col);
        gRough = mix(0.80 + 0.15 * grain, 0.96, mortar);
        gRough = mix(gRough, 0.55, base * 0.6 * w);
        gRough = clamp(gRough + 0.06 * soot - 0.12 * speck, 0.35, 1.0);
        gH = -mortar * 0.55 + grain * 0.35 - pits * 0.25 + vnoise(gp * 19.0) * 0.12;
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = bumpNormal(-vViewPosition, normal, gH, 0.035);`);
  };
  mat.customProgramCacheKey = () => 'voxel-brick-v1';
  return mat;
}

export function makeGroundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; ${NOISE_GLSL} float gH; float gRough;`)
      .replace('#include <map_fragment>', `
        vec2 q = vWP.xz;
        float n1 = fbm(vec3(q * 0.25, 0.0));
        float n2 = fbm(vec3(q * 1.9, 1.0));
        float n3 = vnoise(vec3(q * 11.0, 2.0));
        vec3 col = mix(vec3(0.40, 0.37, 0.32), vec3(0.54, 0.50, 0.43), n2);
        float wet = smoothstep(0.56, 0.72, n1);
        col = mix(col, vec3(0.25, 0.24, 0.21), wet * 0.85);
        // gravel: jittered cells
        vec2 gq = q * 5.0; vec2 gc = floor(gq);
        float pr = vhash(vec3(gc, 4.0));
        vec2 off = vec2(vhash(vec3(gc, 5.0)), vhash(vec3(gc, 6.0))) * 0.5 + 0.25;
        float pd = length(fract(gq) - off);
        float peb = (1.0 - smoothstep(0.08 + 0.14 * pr, 0.12 + 0.14 * pr, pd)) * step(0.55, pr);
        vec3 pebCol = mix(vec3(0.46, 0.45, 0.42), vec3(0.62, 0.58, 0.52), vhash(vec3(gc, 7.0)));
        col = mix(col, pebCol * (0.85 + 0.3 * n3), peb);
        // brick dust & tyre-ish tracks
        float nearWall = 1.0 - smoothstep(0.6, 4.0, abs(vWP.z));
        col = mix(col, vec3(0.55, 0.36, 0.27), nearWall * 0.35 * smoothstep(0.3, 0.7, n2));
        float track = smoothstep(0.35, 0.0, abs(fract((vWP.x + 2.0 * sin(vWP.z * 0.15)) * 0.22) - 0.5) - 0.3);
        col *= 1.0 - 0.12 * track * (1.0 - nearWall);
        col *= 0.85 + 0.25 * n3;
        diffuseColor.rgb = toLin(col);
        gRough = clamp(mix(0.92 - 0.08 * n2, 0.5, wet) - peb * 0.15, 0.3, 1.0);
        gH = n2 * 0.6 + peb * (0.9 - pd * 2.0) + n3 * 0.2;
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = bumpNormal(-vViewPosition, normal, gH, 0.03);`);
  };
  mat.customProgramCacheKey = () => 'ground-v1';
  return mat;
}

export function makeBallMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vOP = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOP; ${NOISE_GLSL} float gH; float gRough; float gMetal;`)
      .replace('#include <map_fragment>', `
        vec3 p = vOP * 3.0;
        float n = fbm(p);
        float rust = smoothstep(0.48, 0.66, fbm(p * 0.8 + 4.0));
        float scratch = smoothstep(0.92, 0.98, vnoise(vec3(vOP.x * 60.0, vOP.y * 3.0, vOP.z * 3.0)));
        vec3 iron = vec3(0.30, 0.30, 0.31) * (0.75 + 0.5 * n);
        vec3 rc = mix(vec3(0.42, 0.20, 0.09), vec3(0.30, 0.15, 0.08), vnoise(p * 6.0));
        vec3 col = mix(iron, rc, rust);
        col = mix(col, vec3(0.6), scratch * (1.0 - rust));
        diffuseColor.rgb = toLin(col);
        gMetal = mix(0.85, 0.15, rust);
        gRough = mix(0.32 + 0.25 * n, 0.9, rust);
        gH = rust * 0.6 + n * 0.3;
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = gMetal;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = bumpNormal(-vViewPosition, normal, gH, 0.02);`);
  };
  mat.customProgramCacheKey = () => 'ball-v1';
  return mat;
}

export function makeSky() {
  const geo = new THREE.SphereGeometry(200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(-0.5, 0.6, 0.6).normalize() } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `varying vec3 vD; uniform vec3 uSun;
      void main(){
        float y = clamp(vD.y, -0.2, 1.0);
        vec3 hor = vec3(0.80, 0.78, 0.72), zen = vec3(0.45, 0.56, 0.70);
        vec3 c = mix(hor, zen, smoothstep(0.0, 0.6, y));
        c = mix(c, vec3(0.55, 0.52, 0.47), smoothstep(0.0, -0.2, y));
        c += vec3(1.0, 0.85, 0.6) * pow(max(dot(vD, uSun), 0.0), 24.0) * 0.35;
        gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(geo, mat);
}
