import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Sim, CN, SAND, WATER, LAVA, MATERIAL_NAMES } from './sim.js';
import { meshChunk } from './mesher.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const PREWARM = 900;          // ticks simulated before frame 0 (15 s of material already poured)
const TICKS_PER_SEC = 60;

// ---------- renderer / scene ----------
const W = CAPTURE ? 1280 : innerWidth, H = CAPTURE ? 720 : innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
{ // vertical gradient sky (dithered to avoid banding)
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#1b2433'); gr.addColorStop(0.55, '#3a4658'); gr.addColorStop(1, '#6b6a70');
  x.fillStyle = gr; x.fillRect(0, 0, 4, 512);
  const img = x.getImageData(0, 0, 4, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 3;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}
scene.fog = new THREE.Fog(0x3a4658, 260, 520);

const camera = new THREE.PerspectiveCamera(40, W / H, 1, 1200);
camera.position.set(170, 130, 170);
const target = new THREE.Vector3(0, 58, 0);

const hemi = new THREE.HemisphereLight(0xbcd2ff, 0x4a3c30, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
sun.position.set(90, 160, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 20; sc.far = 420;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun); scene.add(sun.target);

// ---------- materials (vertex colors + emissive attribute for lava) ----------
const timeU = { value: 0 };
function patch(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float emis;\nvarying float vEmis;\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmis = emis;\nvWp = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vEmis;\nvarying vec3 vWp;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fl = 0.75 + 0.25 * sin(uTime * 3.1 + vWp.x * 0.9 + vWp.z * 0.7 + vWp.y * 0.5)
                        * sin(uTime * 1.7 - vWp.x * 0.4 + vWp.y * 0.8);
        totalEmissiveRadiance += vColor.rgb * vEmis * 3.2 * fl;`);
  };
  return mat;
}
const opaqueMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }));
const waterMat = patch(new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.72,
}));

// ---------- simulation + chunk meshes ----------
const sim = new Sim(20261123);
const world = new THREE.Group();
scene.add(world);
const chunkMeshes = new Array(CN * CN * CN).fill(null).map(() => ({ opaque: null, water: null }));

function toGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(d.col, 3, true));
  g.setAttribute('emis', new THREE.BufferAttribute(d.emi, 1, true));
  g.setIndex(new THREE.BufferAttribute(d.idx, 1));
  g.computeBoundingSphere();
  return g;
}

function setPart(slot, key, data, mat, isWater) {
  const old = slot[key];
  if (old) { world.remove(old); old.geometry.dispose(); slot[key] = null; }
  if (!data) return;
  const m = new THREE.Mesh(toGeometry(data), mat);
  m.castShadow = !isWater; m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  world.add(m);
  slot[key] = m;
}

// budgetMs: live mode spreads remeshing over frames (round-robin) to hold 60 fps; capture meshes everything
let meshCursor = 0;
function remesh(budgetMs = Infinity) {
  const d = sim.dirtyMesh;
  const t0 = performance.now();
  let n = 0;
  for (let j = 0; j < d.length; j++) {
    const k = (meshCursor + j) % d.length;
    if (!d[k]) continue;
    if (performance.now() - t0 > budgetMs) { meshCursor = k; return n; }
    d[k] = 0; n++;
    const cx = k % CN, cz = Math.floor(k / CN) % CN, cy = Math.floor(k / (CN * CN));
    const r = meshChunk(sim.grid, cx, cy, cz);
    setPart(chunkMeshes[k], 'opaque', r.opaque, opaqueMat, false);
    setPart(chunkMeshes[k], 'water', r.water, waterMat, true);
  }
  return n;
}

// ---------- nozzle (decorative housing above the emitter) ----------
const MAT_COLORS = { [SAND]: 0xe8c27a, [WATER]: 0x3d8de0, [LAVA]: 0xff5a10 };
const nozzle = new THREE.Group();
const housing = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 7), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 }));
housing.position.y = 4.5; housing.castShadow = true;
const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xe8c27a, emissiveIntensity: 2 });
const ring = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 5), ringMat);
ring.position.y = 2;
const pipe = new THREE.Mesh(new THREE.BoxGeometry(2, 20, 2), housing.material);
pipe.position.y = 16;
nozzle.add(housing, ring, pipe);
scene.add(nozzle);

function updateNozzle() {
  nozzle.position.set(sim.nozzle.x - 63.5, sim.nozzle.y, sim.nozzle.z - 63.5);
  ringMat.emissive.setHex(MAT_COLORS[sim.emitMaterial] || 0xffffff);
}

// ---------- post: MSAA target -> bloom (lava only, high threshold) -> output ----------
const rt = new THREE.WebGLRenderTarget(W * renderer.getPixelRatio(), H * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- camera ----------
function orbitCamera(t) {
  const a = 0.75 + t * 0.16;
  const r = 238;
  camera.position.set(Math.cos(a) * r, 128 + Math.sin(t * 0.35) * 8, Math.sin(a) * r);
  camera.lookAt(target);
}

// ---------- run ----------
const hud = document.getElementById('hud');
for (let i = 0; i < PREWARM; i++) sim.step();
remesh();
updateNozzle();

if (CAPTURE) {
  hud.style.display = 'none';
  window.renderFrame = async (n) => {
    const want = PREWARM + Math.round(n * TICKS_PER_SEC / 30);
    while (sim.tick < want) sim.step();
    remesh();
    updateNozzle();
    const t = n / 30;
    timeU.value = t;
    orbitCamera(t);
    composer.render();
    renderer.getContext().finish();
    return true;
  };
  window.captureReady = true;
} else {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  orbitCamera(0);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.maxDistance = 450; controls.minDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.49;

  let paused = false, acc = 0, last = performance.now(), hudOn = true;
  let fps = 60, simMs = 0, meshMs = 0;
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    else if (e.key === '1') sim.forcedMaterial = SAND;
    else if (e.key === '2') sim.forcedMaterial = WATER;
    else if (e.key === '3') sim.forcedMaterial = LAVA;
    else if (e.key === '0') sim.forcedMaterial = 0;
    else if (e.key === 'r' || e.key === 'R') { sim.reset(); for (let i = 0; i < PREWARM; i++) sim.step(); }
    else if (e.key === 'h' || e.key === 'H') { hudOn = !hudOn; hud.style.display = hudOn ? '' : 'none'; }
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  });

  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    if (!paused) {
      acc += dt;
      let steps = 0;
      const t0 = performance.now();
      while (acc >= 1 / TICKS_PER_SEC && steps < 2) { sim.step(); acc -= 1 / TICKS_PER_SEC; steps++; }
      if (steps === 2) acc = 0;
      const t1 = performance.now();
      remesh(7);
      simMs += (t1 - t0 - simMs) * 0.1; meshMs += (performance.now() - t1 - meshMs) * 0.1;
      // keep the basin from overfilling during long sessions
      if (sim.tick > PREWARM + 60 * 240) { sim.reset(); for (let i = 0; i < PREWARM; i++) sim.step(); }
    }
    timeU.value = now / 1000;
    updateNozzle();
    controls.update();
    composer.render();
    if (hudOn) hud.textContent = `${fps.toFixed(0)} fps · sim ${simMs.toFixed(1)} ms · mesh ${meshMs.toFixed(1)} ms · nozzle: ${sim.forcedMaterial ? MATERIAL_NAMES[sim.forcedMaterial] + ' (locked)' : MATERIAL_NAMES[sim.emitMaterial]}${paused ? ' · paused' : ''}  —  drag orbit · wheel zoom · 1/2/3 lock sand/water/lava · 0 cycle · space pause · R reset · H hide`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
