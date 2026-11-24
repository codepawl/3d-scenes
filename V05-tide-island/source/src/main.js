import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { N, generate, buildMesh, initSim, stepSim, tideLevel, sim, TIDE } from './world.js';
import { shared, makeTerrainMaterial, makeWaterMaterial, makeSky } from './materials.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const W = 1280, Hh = 720;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(CAPTURE ? W : innerWidth, CAPTURE ? Hh : innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(shared.uFogColor.value, shared.uFogDensity.value);
const camera = new THREE.PerspectiveCamera(40, (CAPTURE ? W / Hh : innerWidth / innerHeight), 0.5, 2000);

// ---- world ----
generate(7);
const { geometry, quads } = buildMesh();
const terrain = new THREE.Mesh(geometry, makeTerrainMaterial());
terrain.position.set(-N / 2, 0, -N / 2);
terrain.castShadow = terrain.receiveShadow = true;
scene.add(terrain);

// tide clock (seconds of tide time); capture runs one full cycle in 6 s, starting at high tide
const TIDE_SPEED = CAPTURE ? TIDE.period / 6 : 1;
let tideTime = 0, tideRate = TIDE_SPEED, paused = false;
initSim(tideLevel(0));
// pre-roll so the wet line and foam are in a settled state at frame 0
for (let i = 0; i < 90; i++) { stepSim(tideLevel(0), 1 / 30 * 4, i / 30); }
shared.uGrid.value = sim.texture;

const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), makeWaterMaterial());
water.renderOrder = 1;
scene.add(water);
const sky = makeSky();
scene.add(sky);
// sky-only environment map so glossy wet sand reflects the sky
{
  const envScene = new THREE.Scene(); envScene.add(makeSky());
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0, 1, 1000).texture;
  scene.environmentIntensity = 0.45;
}

// ---- lights ----
const sun = new THREE.DirectionalLight(0xffe9cc, 2.6);
sun.position.copy(shared.uSunDir.value).multiplyScalar(160);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbfdcf0, 0x6b5a40, 0.6));

// ---- camera ----
const target = new THREE.Vector3(0, 8, 4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 20; controls.maxDistance = 400;
camera.position.set(110, 72, 120);
let autoOrbit = true;
controls.addEventListener('start', () => { autoOrbit = false; });

function cameraAt(t) {
  const a = 0.6 + t * 0.05;
  const r = 112 - t * 2.0;
  camera.position.set(Math.cos(a) * r, 46 - t * 1.0, Math.sin(a) * r);
  camera.lookAt(target);
}

// ---- HUD (hidden in capture) ----
const hud = document.getElementById('hud');
if (CAPTURE) hud.style.display = 'none';
addEventListener('keydown', (e) => {
  if (e.code === 'Space') paused = !paused;
  if (e.key === ']') tideRate = Math.min(tideRate * 2, 32);
  if (e.key === '[') tideRate = Math.max(tideRate / 2, 0.125);
  if (e.key === 'o' || e.key === 'O') autoOrbit = !autoOrbit;
});
addEventListener('resize', () => {
  if (CAPTURE) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function update(dtReal, time) {
  const dtT = paused ? 0 : dtReal * tideRate;
  tideTime += dtT;
  const L = tideLevel(tideTime);
  stepSim(L, dtT, time);
  // keep the plane off exact integer heights so it never z-fights a voxel top face
  const f = L - Math.floor(L);
  shared.uLevel.value = Math.floor(L) + 0.04 + f * 0.92;
  water.position.y = shared.uLevel.value;
  shared.uTime.value = time;
  water.material.uniforms.cameraPos.value.copy(camera.position);
}

if (CAPTURE) {
  let simFrame = -1;
  window.renderFrame = async (n) => {
    // deterministic: step the simulation one 1/30 s frame at a time up to n
    while (simFrame < n) { simFrame++; update(simFrame === 0 ? 0 : 1 / 30, simFrame / 30); }
    cameraAt(n / 30);
    water.material.uniforms.cameraPos.value.copy(camera.position);
    renderer.render(scene, camera);
    return true;
  };
  window.renderReady = true;
} else {
  const clock = new THREE.Clock();
  let time = 0, frames = 0, acc = 0, fps = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    time += dt;
    if (autoOrbit) cameraAt(time * 0.6 % 60); else controls.update();
    update(dt, time);
    renderer.render(scene, camera);
    frames++; acc += dt;
    if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }
    hud.textContent = `tide ${sim.level.toFixed(2)} · x${tideRate} ${paused ? '(paused)' : ''} · ${quads} quads · ${fps.toFixed(0)} fps · drag: orbit · space: pause tide · [ ]: tide speed · O: auto-orbit`;
  });
}
