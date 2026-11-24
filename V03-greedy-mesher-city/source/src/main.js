import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { generateCity, NX, NY, NZ } from './city.js';
import { meshChunk, CHUNK } from './mesher.js';
import { createSky } from './sky.js';
import { patchCityMaterial } from './cityMaterial.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const W = 1280, H = 720;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false, // MSAA happens on the composer target
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(CAPTURE ? W : window.innerWidth, CAPTURE ? H : window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, (CAPTURE ? W / H : innerWidth / innerHeight), 0.5, 1500);

// ---------------------------------------------------------------- city
const CX = NX / 2, CZ = NZ / 2;
const t0 = performance.now();
const grid = generateCity(7);
const cityMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const cityUniforms = patchCityMaterial(cityMat);
const city = new THREE.Group();
let tris = 0;
for (let cy = 0; cy < Math.ceil(NY / CHUNK); cy++)
  for (let cz = 0; cz < Math.ceil(NZ / CHUNK); cz++)
    for (let cx = 0; cx < Math.ceil(NX / CHUNK); cx++) {
      const geo = meshChunk(grid, cx, cy, cz);
      if (!geo) continue;
      tris += geo.index.count / 3;
      const m = new THREE.Mesh(geo, cityMat);
      m.castShadow = true; m.receiveShadow = true;
      city.add(m);
    }
city.position.set(-CX, 0, -CZ); // centre the city on the origin
scene.add(city);
console.log(`city meshed in ${(performance.now() - t0).toFixed(0)} ms, ${tris} triangles, ${city.children.length} chunks`);

// dark ground plane past the edge of the grid
const outer = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x1c1c20 })
);
outer.position.y = -0.02;
outer.receiveShadow = true;
scene.add(outer);

// ---------------------------------------------------------------- lights & sky
const sun = new THREE.DirectionalLight(0xffa060, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 1; sc.far = 700;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.12;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0x8090c8, 0x2a2018, 0.9);
scene.add(hemi);

const sky = createSky();
scene.add(sky.mesh);
scene.fog = new THREE.FogExp2(0x553a50, 0.0028);

const SUN_AZ = THREE.MathUtils.degToRad(-35);
const sunDir = new THREE.Vector3();
const cA = new THREE.Color(), cB = new THREE.Color();

function applyDusk(p, time) {
  // p: 0 = late golden hour, 1 = blue hour
  const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(9, 1.2, p));
  sunDir.set(Math.cos(elev) * Math.sin(SUN_AZ), Math.sin(elev), -Math.cos(elev) * Math.cos(SUN_AZ));
  sun.position.copy(sunDir).multiplyScalar(320);
  sun.target.position.set(0, 0, 0);
  sun.intensity = 2.8 * Math.pow(1 - p, 1.4) + 0.08;
  sun.color.copy(cA.setHex(0xffb070)).lerp(cB.setHex(0xff5a3a), p);
  hemi.intensity = THREE.MathUtils.lerp(1.0, 0.38, p);
  hemi.color.copy(cA.setHex(0x9a8cc0)).lerp(cB.setHex(0x30407a), p);
  sky.update(sunDir, p, time);
  scene.fog.color.copy(sky.fogColor);
  cityUniforms.uProgress.value = p;
  cityUniforms.uTime.value = time;
}

// ---------------------------------------------------------------- post
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- camera path
// Slow crane move along an avenue towards the dusk sun.
const path = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-8, 26, 112),
  new THREE.Vector3(-4, 30, 92),
  new THREE.Vector3(2, 35, 72),
]);
const look = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-30, 18, -20),
  new THREE.Vector3(-26, 20, -36),
  new THREE.Vector3(-22, 22, -52),
]);
const ease = (x) => x * x * (3 - 2 * x);
function cameraAt(u) {
  const e = ease(THREE.MathUtils.clamp(u, 0, 1));
  path.getPoint(e, camera.position);
  camera.lookAt(look.getPoint(e));
}

// ---------------------------------------------------------------- run
const CAPTURE_SECONDS = 6;
function progressCapture(t) { return 0.12 + 0.76 * (t / CAPTURE_SECONDS); }

if (CAPTURE) {
  window.renderFrame = (n) => new Promise((resolve) => {
    const t = n / 30;
    applyDusk(progressCapture(t), t);
    cameraAt(t / CAPTURE_SECONDS);
    composer.render();
    renderer.getContext().finish();
    resolve(true);
  });
  window.sceneReady = true;
} else {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 10; controls.maxDistance = 400;
  let cinematic = true, paused = false, duskT = 0, last = performance.now();
  controls.addEventListener('start', () => {
    if (cinematic) { cinematic = false; controls.target.copy(look.getPoint(0.5)); }
  });
  const hud = document.getElementById('hud');
  addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') duskT = 0;
    if (e.key === ' ') paused = !paused;
    if (e.key === 'c' || e.key === 'C') cinematic = !cinematic;
    if (e.key === 'h' || e.key === 'H') hud.style.display = hud.style.display === 'none' ? '' : 'none';
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.getDrawingBufferSize(size);
    composer.setSize(innerWidth, innerHeight);
  });
  const DUSK_SECONDS = 40;
  const fpsEl = document.getElementById('fps');
  let frames = 0, fpsT = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!paused) duskT += dt;
    const p = 0.05 + 0.92 * Math.min(1, duskT / DUSK_SECONDS);
    applyDusk(p, now / 1000);
    if (cinematic) cameraAt((now / 1000 % 30) / 30 < 0.5 ? (now / 1000 % 30) / 15 : 2 - (now / 1000 % 30) / 15);
    else controls.update();
    composer.render();
    frames++;
    if (now - fpsT > 500) { fpsEl.textContent = `${Math.round(frames * 1000 / (now - fpsT))} fps`; frames = 0; fpsT = now; }
  });
  hud.style.display = '';
}
