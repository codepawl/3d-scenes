import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World, SX, SZ, CX, CZ, WL, CHUNK } from './world.js';
import { meshChunk, OCEAN_COLOR, WATER_TOP } from './mesher.js';
import { makeTerrainMaterial, makeWaterMaterial } from './materials.js';
import { Weather } from './weather.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const W = Number(params.get('w')) || window.innerWidth;
const H = Number(params.get('h')) || window.innerHeight;
const FPS = 30, DT = 1 / FPS;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H, !CAPTURE);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
if (CAPTURE) document.getElementById('hud')?.remove();

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xc9d3d6);
scene.fog = new THREE.Fog(HORIZON, 170, 520);

// ---- sky dome (gradient + sun glow), also baked into the environment map
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.45).normalize();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uSun: { value: SUN_DIR } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
  fragmentShader: `varying vec3 vDir; uniform vec3 uSun;
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 zen = vec3(0.20, 0.38, 0.66), hor = vec3(0.78, 0.82, 0.83), gnd = vec3(0.42, 0.45, 0.46);
      vec3 c = h > 0.0 ? mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(hor, gnd, clamp(-h * 4.0, 0.0, 1.0));
      float s = max(dot(d, uSun), 0.0);
      c += vec3(1.0, 0.85, 0.6) * (pow(s, 12.0) * 0.35 + pow(s, 900.0) * 6.0);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMat);
scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat.clone());
  envScene.add(envSky);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  pm.dispose();
}

// ---- lights
const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
sun.position.copy(SUN_DIR).multiplyScalar(140).add(new THREE.Vector3(CX, 0, CZ));
sun.target.position.set(CX, WL, CZ);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -92; sc.right = 92; sc.top = 92; sc.bottom = -92; sc.near = 20; sc.far = 300;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd2ee, 0x6a5a48, 0.75));

// ---- world + meshes
const shared = { uTime: { value: 0 } };
const terrainMat = makeTerrainMaterial(shared);
const waterMat = makeWaterMaterial(shared);
const world = new World(7);
const NCX = SX / CHUNK, NCZ = SZ / CHUNK;
const chunkMeshes = new Array(NCX * NCZ).fill(null).map(() => ({ t: null, w: null }));
const chunkGroup = new THREE.Group();
scene.add(chunkGroup);

function rebuildChunk(id) {
  const cx = id % NCX, cz = Math.floor(id / NCX);
  const { terrain, water } = meshChunk(world, cx, cz);
  const slot = chunkMeshes[id];
  for (const k of ['t', 'w']) if (slot[k]) { chunkGroup.remove(slot[k]); slot[k].geometry.dispose(); slot[k] = null; }
  if (terrain) {
    const m = new THREE.Mesh(terrain, terrainMat);
    m.castShadow = true; m.receiveShadow = true;
    chunkGroup.add(m); slot.t = m;
  }
  if (water) {
    const m = new THREE.Mesh(water, waterMat);
    m.receiveShadow = true; m.renderOrder = 1;
    chunkGroup.add(m); slot.w = m;
  }
}
for (let i = 0; i < NCX * NCZ; i++) rebuildChunk(i);
world.dirty.clear();

function flushDirty(limit) {
  let n = 0;
  for (const id of world.dirty) {
    rebuildChunk(id); world.dirty.delete(id);
    if (++n >= limit) break;
  }
}

// open ocean outside the grid: four slabs around the grid footprint + a dark sea floor
{
  const oc = new THREE.Color(OCEAN_COLOR[0], OCEAN_COLOR[1], OCEAN_COLOR[2]);
  const g = new THREE.BufferGeometry();
  const E = 1400, y = WL + WATER_TOP;
  const rects = [[-E, -E, SX + E, 0], [-E, SZ, SX + E, SZ + E], [-E, 0, 0, SZ], [SX, 0, SX + E, SZ]];
  const pos = [], col = [], info = [], nor = [];
  for (const [x0, z0, x1, z1] of rects) {
    const quad = [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]];
    for (const [x, z] of quad) { pos.push(x, y, z); col.push(oc.r, oc.g, oc.b, 1); info.push(0, 0); nor.push(0, 1, 0); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
  const ocean = new THREE.Mesh(g, waterMat);
  ocean.receiveShadow = true; ocean.renderOrder = 1;
  scene.add(ocean);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * E, 2 * E), new THREE.MeshStandardMaterial({ color: 0x223a3c, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(CX, WL - 6, CZ);
  scene.add(floor);
}

const weather = new Weather(world, scene, 11);

// ---- camera
const camera = new THREE.PerspectiveCamera(36, W / H, 0.5, 1500);
const target = new THREE.Vector3(CX, WL + 2, CZ);
function captureCamera(t) {
  const u = t / 6;
  const a = -1.05 - u * 0.6;                       // sweep ~35 degrees around the ring
  const rad = 128 - u * 10, hgt = 70 - u * 6;
  camera.position.set(CX + Math.cos(a) * rad, hgt, CZ + Math.sin(a) * rad);
  camera.lookAt(target.x, target.y - 4 + u * 2, target.z);
}

let controls = null;
if (!CAPTURE) {
  captureCamera(0);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 25; controls.maxDistance = 260;
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

let paused = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') paused = !paused;
  if (e.code === 'KeyA' && controls) controls.autoRotate = !controls.autoRotate;
  if (e.code === 'KeyR') world.reset();
});

// pre-warm the weather so particles fill the air at frame 0
for (let i = 0; i < 45; i++) weather.step(DT);
flushDirty(Infinity);

if (CAPTURE) {
  let simFrame = 0;
  window.renderFrame = async (n) => {
    while (simFrame < n) { weather.step(DT); simFrame++; }
    flushDirty(Infinity);
    weather.sync();
    shared.uTime.value = 10 + n * DT;
    captureCamera(n * DT);
    renderer.render(scene, camera);
    return true;
  };
  window.captureReady = true;
} else {
  const clock = new THREE.Clock();
  let acc = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!paused) {
      acc += dt;
      let steps = 0;
      const SDT = 1 / 60;
      while (acc >= SDT && steps < 4) { weather.step(SDT); acc -= SDT; steps++; }
      if (steps === 4) acc = 0;
      shared.uTime.value += dt;
    }
    flushDirty(3);
    weather.sync();
    controls.update();
    renderer.render(scene, camera);
  });
}
