import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld, prefill, NX, NY, NZ, SKY, CH, F } from './world.js';
import { Water } from './water.js';
import { buildTerrainMesh, WaterMesher, bakeWetMoss } from './mesher.js';
import { makeRockTextures } from './textures.js';
import { Foam, Mist } from './particles.js';
import { rng } from './noise.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const SIM_HZ = 60;
const WARMUP = 1400;

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(CAPTURE ? 1280 : window.innerWidth, CAPTURE ? 720 : window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY_COL = new THREE.Color(0xdfeaf2).multiplyScalar(1.6);
scene.background = SKY_COL;
const FOG_COL = new THREE.Color(0x1b2428);
scene.fog = new THREE.FogExp2(FOG_COL, 0.018);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.22;

const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);

// ---------------- lights ----------------
const sunDir = new THREE.Vector3(-0.24, 1, 0.1).normalize();
const sun = new THREE.DirectionalLight(0xfff0d6, 13);
const sunTarget = new THREE.Vector3(SKY.x + 9, 9, SKY.z - 4);
sun.position.copy(sunTarget).addScaledVector(sunDir, 70);
sun.target.position.copy(sunTarget);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 5, far: 150 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x8fa6b8, 0x2a2420, 0.28));
const tunnelLight = new THREE.PointLight(0xffe2b8, 140, 34, 1.6);
tunnelLight.position.set(CH[0], F[0] + 5, 4);
scene.add(tunnelLight);
const poolLight = new THREE.PointLight(0x9fd0e0, 60, 30, 1.6);
poolLight.position.set(24, 14, 46);
scene.add(poolLight);
const fillLight = new THREE.PointLight(0xb8c8d8, 40, 26, 1.8);
fillLight.position.set(28, 20, 58);
scene.add(fillLight);

// ---------------- world + water ----------------
const world = buildWorld();
const water = new Water(world.mat, world.sink, world.sources);
water.bias = world.bias;
water.drain = world.drain;
prefill(world.mat, water.mass);
const lips = [], impacts = [];
for (let i = 0; i < WARMUP; i++) water.step();
water.updateFoam(lips, impacts);
const { wet, moss } = bakeWetMoss(world.mat, water);

// GLSL value noise (hash: Dave Hoskins "Hash without Sine", MIT)
const NOISE_GLSL = /* glsl */`
float vh13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(vh13(i), vh13(i+vec3(1,0,0)), f.x), mix(vh13(i+vec3(0,1,0)), vh13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(vh13(i+vec3(0,0,1)), vh13(i+vec3(1,0,1)), f.x), mix(vh13(i+vec3(0,1,1)), vh13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float vfbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s/0.9375; }
`;

// ---------------- rock material ----------------
const tex = makeRockTextures(renderer.capabilities.getMaxAnisotropy());
const rockMat = new THREE.MeshStandardMaterial({
  vertexColors: true, map: tex.albedo, roughnessMap: tex.rh, bumpMap: tex.rh, bumpScale: 2.2,
  roughness: 1.0, metalness: 0.0, envMapIntensity: 0.6, dithering: true,
});
const timeU = { value: 0 };
rockMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = timeU;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aLocal; attribute float aWet; varying vec2 vLocal; varying float vWet; varying vec3 vWPos;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLocal = aLocal; vWet = aWet; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vLocal; varying float vWet; varying vec3 vWPos; uniform float uTime;\n' + NOISE_GLSL)
    .replace('#include <map_fragment>', `#include <map_fragment>
      {
        // grout seams between voxels, broken up by noise
        vec2 e2 = min(vLocal, 1.0 - vLocal);
        float e = min(e2.x, e2.y);
        float seamN = vnoise(vWPos * 3.1);
        diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.015, 0.07 + 0.05 * seamN, e));
        // chipped, lighter worn edges
        diffuseColor.rgb *= 1.0 + 0.12 * (1.0 - smoothstep(0.0, 0.05, e)) * step(0.6, seamN);
        // large-scale grime and mineral streaks running down walls
        float g = vfbm(vWPos * vec3(0.18, 0.12, 0.18));
        float streak = vfbm(vec3(vWPos.x * 1.3, vWPos.y * 0.08, vWPos.z * 1.3));
        diffuseColor.rgb *= 0.7 + 0.6 * g;
        diffuseColor.rgb *= mix(1.0, 0.72, smoothstep(0.55, 0.75, streak) * (1.0 - abs(vNormal.y)));
        // calcite whitening high up
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.53, 0.5), smoothstep(0.62, 0.8, vfbm(vWPos * 0.31 + 7.0)) * 0.35);
        // wet rock is darker
        diffuseColor.rgb *= mix(1.0, 0.5, vWet);
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.14 + 0.2 * vnoise(vWPos * 2.0), clamp(vWet * 1.1, 0.0, 1.0));`);
};

const terrainGeo = buildTerrainMesh(world.mat, wet, moss);
const terrain = new THREE.Mesh(terrainGeo, rockMat);
terrain.castShadow = true;
terrain.receiveShadow = true;
scene.add(terrain);

// ---------------- water material ----------------
const waterMesher = new WaterMesher(world.mat);
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x1d5560, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.8,
  envMapIntensity: 1.6, dithering: true,
});
waterMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = timeU;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 aFlow; varying vec3 vFlow; varying vec3 vWPos2;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFlow = aFlow; vWPos2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFlow; varying vec3 vWPos2; uniform float uTime;\n' + NOISE_GLSL)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float fall = vFlow.x, foam = vFlow.y;
      // falling sheets: streaks that scroll downward
      float streak = vnoise(vec3(vWPos2.x * 4.0 + vWPos2.z * 4.0, vWPos2.y * 0.35 + uTime * 5.5, vWPos2.z * 2.0));
      float streak2 = vnoise(vec3(vWPos2.x * 9.0, vWPos2.y * 0.8 + uTime * 8.0, vWPos2.z * 9.0));
      // surface churn
      float churn = vfbm(vec3(vWPos2.x * 1.6, uTime * 0.9, vWPos2.z * 1.6) + vec3(0.0, vWPos2.y, 0.0));
      float fwhite = clamp(fall * (0.35 + 0.9 * smoothstep(0.35, 0.8, streak * 0.6 + streak2 * 0.5)), 0.0, 1.0);
      float swhite = smoothstep(0.75 - foam * 0.6, 0.95 - foam * 0.5, churn) * foam;
      float white = clamp(max(fwhite, swhite), 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.92, 0.93), white);
      diffuseColor.a = mix(diffuseColor.a, 0.97, white);`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        // ripple normals from animated noise (top surfaces mostly)
        vec3 q = vec3(vWPos2.x * 1.4, uTime * 0.8, vWPos2.z * 1.4);
        float h0 = vfbm(q), hx = vfbm(q + vec3(0.15, 0.0, 0.0)), hz = vfbm(q + vec3(0.0, 0.0, 0.15));
        vec3 pert = vec3(h0 - hx, 0.0, h0 - hz) * (2.2 + 4.0 * vFlow.y);
        normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.55, white);`);
};
const waterMesh = new THREE.Mesh(waterMesher.geometry, waterMat);
waterMesh.receiveShadow = true;
waterMesh.renderOrder = 2;
scene.add(waterMesh);

// ---------------- particles ----------------
const rand = rng(1234);
const foam = new Foam(1600, rand);
scene.add(foam.mesh);
const shaftO = new THREE.Vector3(SKY.x, NY + 2, SKY.z);
const shaftD = sunDir.clone().negate();
const mistUniforms = {
  uMist: { value: new THREE.Color(0x7d8f98) },
  uSun: { value: new THREE.Color(0xfff0d0).multiplyScalar(0.9) },
  uShaftO: { value: shaftO }, uShaftD: { value: shaftD }, uShaftR: { value: SKY.r * 1.1 },
  uFogColor: { value: FOG_COL }, uFogDensity: { value: scene.fog.density }, uCam: { value: camera.position },
};
const mist = new Mist(1800, rand, mistUniforms);
scene.add(mist.mesh);

// sun shaft: additive open cylinder along the light direction, fading with depth and at its rim
const shaftLen = 42;
const shaftGeo = new THREE.CylinderGeometry(SKY.r * 0.95, SKY.r * 1.25, shaftLen, 40, 1, true);
shaftGeo.translate(0, -shaftLen / 2, 0);
const shaftMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uTime: timeU, uCol: { value: new THREE.Color(0xffe8c0) }, uO: { value: shaftO }, uD: { value: shaftD }, uR0: { value: SKY.r * 0.95 }, uR1: { value: SKY.r * 1.25 } },
  vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
    void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vY = -position.y / ${shaftLen.toFixed(1)};
      vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uCol; uniform vec3 uO; uniform vec3 uD; uniform float uR0; uniform float uR1; varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
    ${NOISE_GLSL}
    void main(){
      vec3 rd = normalize(vW - cameraPosition);
      vec3 nn = normalize(cross(rd, uD));
      float dist = abs(dot(vW - uO, nn));
      float R = mix(uR0, uR1, vY);
      float a = pow(clamp(1.0 - (dist / R) * (dist / R), 0.0, 1.0), 1.2);
      float n = vfbm(vec3(vW.x * 0.6, vW.y * 0.15 - uTime * 0.25, vW.z * 0.6));
      a *= smoothstep(0.04, 0.35, vY) * (1.0 - smoothstep(0.88, 1.0, vY)) * (0.45 + 0.9 * n) * 0.26;
      gl_FragColor = vec4(uCol, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const shaft = new THREE.Mesh(shaftGeo, shaftMat);
shaft.position.copy(shaftO);
shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
shaft.renderOrder = 4;
scene.add(shaft);

// ---------------- simulation step ----------------
const DT = 1 / SIM_HZ;
let simSteps = 0;
function simStep() {
  water.step();
  water.updateFoam(lips, impacts);
  const t = simSteps * DT;
  foam.step(DT, lips, impacts, water.mass);
  mist.step(DT, impacts, water.mass, t);
  simSteps++;
}
// pre-roll particles so mist exists at frame 0
for (let i = 0; i < 240; i++) simStep();
const PREROLL = simSteps;

// ---------------- camera ----------------
const camA = { p: new THREE.Vector3(34, 23, 59), t: new THREE.Vector3(23, 18.5, 26) };
const camB = { p: new THREE.Vector3(16.5, 21.5, 56), t: new THREE.Vector3(25.5, 19, 26) };
const DBG_CAM = params.get('cam') ? params.get('cam').split(',').map(Number) : null;
function cinematic(t) {
  if (DBG_CAM) { camera.position.set(DBG_CAM[0], DBG_CAM[1], DBG_CAM[2]); camera.lookAt(DBG_CAM[3], DBG_CAM[4], DBG_CAM[5]); return; }
  const u = Math.min(1, t / 6);
  const e = u * u * (3 - 2 * u);
  camera.position.lerpVectors(camA.p, camB.p, e);
  camera.position.y += Math.sin(t * 0.9) * 0.15;
  const tg = new THREE.Vector3().lerpVectors(camA.t, camB.t, e);
  camera.lookAt(tg);
}

let controls = null;
if (!CAPTURE) {
  controls = new OrbitControls(camera, renderer.domElement);
  camera.position.copy(camA.p);
  controls.target.copy(camA.t);
  controls.enableDamping = true;
  controls.update();
}

function render(t) {
  timeU.value = t;
  waterMesher.build(water);
  renderer.render(scene, camera);
}

if (CAPTURE) {
  cinematic(0);
  window.renderFrame = async (n) => {
    const target = PREROLL + Math.round(n * SIM_HZ / 30);
    while (simSteps < target) simStep();
    const t = n / 30;
    cinematic(t);
    render(t);
    return true;
  };
  window.captureReady = true;
} else {
  let acc = 0, last = performance.now(), paused = false, cine = false, cineT = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyC') { cine = !cine; cineT = 0; controls.enabled = !cine; }
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 4) { simStep(); acc -= DT; n++; }
      if (n === 4) acc = 0;
    }
    if (cine) { cineT = (cineT + dt) % 6; cinematic(cineT); } else controls.update();
    render(simSteps * DT);
  });
}
