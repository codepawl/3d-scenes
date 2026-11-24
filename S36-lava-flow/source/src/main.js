import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { terrainVert, terrainFrag } from './shaders/terrain.js';
import { skyVert, skyFrag, fsVert, downFrag, upFrag, compositeFrag } from './shaders/post.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const CAP_W = 1280, CAP_H = 720, FPS = 30;
const T0 = 1.0; // capture start time (inside a pure flow-map window, see setTime)

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
renderer.autoClear = false;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

let W = CAPTURE ? CAP_W : window.innerWidth;
let H = CAPTURE ? CAP_H : window.innerHeight;
renderer.setSize(W, H);

// ------------------------------------------------------------------ scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 600);

const sunDir = new THREE.Vector3(0.85, 0.06, 0.5).normalize();
const shared = {
  uTime: { value: 0 },
  uSunDir: { value: sunDir },
};

const terrainUniforms = {
  ...shared,
  uTauA: { value: 0 },
  uTauB: { value: 0 },
  uWA: { value: 1 },
  uSunCol: { value: new THREE.Color(1.0, 0.5, 0.28).multiplyScalar(0.45) },
};

function buildTerrain() {
  const nu = 380, nv = 720;
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  let k = 0;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const z = -24 + 170 * (0.33 * v + 0.67 * v * v);
    const hw = 20 + 0.75 * (z + 24);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      pos[k++] = (u * 2 - 1) * hw;
      pos[k++] = 0;
      pos[k++] = z;
    }
  }
  const idx = new Uint32Array(nu * nv * 6);
  k = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms: terrainUniforms,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}
scene.add(buildTerrain());

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(400, 48, 24),
  new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: shared,
    side: THREE.BackSide,
    depthWrite: false,
  }),
);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

// ------------------------------------------------------------------ post chain
const fsGeo = new THREE.BufferGeometry();
fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const fsCam = new THREE.Camera();
function makePass(frag, uniforms, extra = {}) {
  const m = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
  const mesh = new THREE.Mesh(fsGeo, m);
  mesh.frustumCulled = false;
  const s = new THREE.Scene();
  s.add(mesh);
  return { m, s };
}
const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
const sceneRT = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthBuffer: true, samples: 4 });
const LEVELS = 6;
const bloomRTs = [];
for (let i = 0; i < LEVELS; i++) bloomRTs.push(new THREE.WebGLRenderTarget(1, 1, rtOpts));
function sizeTargets() {
  sceneRT.setSize(W, H);
  let w = W, h = H;
  for (const rt of bloomRTs) {
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    rt.setSize(w, h);
  }
}
sizeTargets();

const down = makePass(downFrag, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
const up = makePass(upFrag, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, {
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, transparent: true,
});
const comp = makePass(compositeFrag, {
  tScene: { value: sceneRT.texture },
  tBloom: { value: bloomRTs[0].texture },
  uTime: { value: 0 },
  uFrame: { value: 0 },
  uBloom: { value: 0.012 },
  uExposure: { value: 1.25 },
  uRes: { value: new THREE.Vector2(W, H) },
});

function renderAll(frame) {
  renderer.setRenderTarget(sceneRT);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);

  let src = sceneRT.texture, sw = W, sh = H;
  for (let i = 0; i < LEVELS; i++) {
    down.m.uniforms.tSrc.value = src;
    down.m.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    down.m.uniforms.uFirst.value = i === 0 ? 1 : 0;
    renderer.setRenderTarget(bloomRTs[i]);
    renderer.render(down.s, fsCam);
    src = bloomRTs[i].texture; sw = bloomRTs[i].width; sh = bloomRTs[i].height;
  }
  for (let i = LEVELS - 1; i > 0; i--) {
    up.m.uniforms.tSrc.value = bloomRTs[i].texture;
    up.m.uniforms.uTexel.value.set(1 / bloomRTs[i].width, 1 / bloomRTs[i].height);
    renderer.setRenderTarget(bloomRTs[i - 1]);
    renderer.render(up.s, fsCam);
  }
  comp.m.uniforms.uTime.value = shared.uTime.value;
  comp.m.uniforms.uFrame.value = frame % 997;
  comp.m.uniforms.uRes.value.set(W, H);
  renderer.setRenderTarget(null);
  renderer.render(comp.s, fsCam);
}

// ------------------------------------------------------------------ time + flow-map phases
const PERIOD = 16;
const sstep = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
function setTime(t) {
  shared.uTime.value = t;
  const sA = (((t / PERIOD) % 1) + 1) % 1;
  const sB = (sA + 0.5) % 1;
  terrainUniforms.uTauA.value = sA * PERIOD;
  terrainUniforms.uTauB.value = sB * PERIOD;
  terrainUniforms.uWA.value = sstep(0, 0.06, sA) * (1 - sstep(0.5, 0.56, sA));
}

// ------------------------------------------------------------------ camera
const camA = new THREE.Vector3(-5.8, -0.5, -14.0), camB = new THREE.Vector3(-4.3, -0.9, -11.8);
const tgtA = new THREE.Vector3(0.2, -1.5, 0.5), tgtB = new THREE.Vector3(0.9, -1.3, 1.8);
function cameraAt(u) {
  const e = u * u * (3 - 2 * u);
  camera.position.lerpVectors(camA, camB, e);
  const t = new THREE.Vector3().lerpVectors(tgtA, tgtB, e);
  camera.lookAt(t);
  return t;
}

if (CAPTURE) {
  cameraAt(0);
  setTime(T0);
  renderAll(0);
  window.renderFrame = (n) => new Promise((resolve) => {
    const t = n / FPS;
    setTime(T0 + t);
    cameraAt(Math.min(1, t / 6));
    renderAll(n);
    renderer.getContext().finish();
    requestAnimationFrame(() => resolve(true));
  });
  window.captureReady = true;
} else {
  const target = cameraAt(0.4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2;
  controls.maxDistance = 60;
  controls.update();
  const home = { pos: camera.position.clone(), tgt: target.clone() };

  let paused = false, t = T0, last = performance.now(), frame = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyR') { camera.position.copy(home.pos); controls.target.copy(home.tgt); controls.update(); }
  });
  window.addEventListener('resize', () => {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    sizeTargets();
  });
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) t += dt;
    if (t > 120) t -= 112; // keeps toe growth bounded; flow-map phase stays continuous (112 = 7 * 16)
    setTime(t);
    controls.update();
    renderAll(frame++);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
