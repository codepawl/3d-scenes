import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildGem } from './gem.js';
import common from './shaders/common.glsl?raw';
import objVert from './shaders/obj.vert?raw';
import gemFrag from './shaders/gem.frag?raw';
import plinthFrag from './shaders/plinth.frag?raw';
import pinFrag from './shaders/pin.frag?raw';
import backdropFrag from './shaders/backdrop.frag?raw';
import fsVert from './shaders/fs.vert?raw';
import bloomDownFrag from './shaders/bloomDown.frag?raw';
import bloomUpFrag from './shaders/bloomUp.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const SS = parseFloat(params.get('ss') || (CAPTURE ? '2' : '1')); // internal supersampling
const FPS = 30;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
});
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // composite shader encodes sRGB itself
document.body.appendChild(renderer.domElement);

let W = CAPTURE ? 1280 : window.innerWidth;
let H = CAPTURE ? 720 : window.innerHeight;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, W / H, 0.05, 100);
const target = new THREE.Vector3(0, 0.40, 0);

// ---------------------------------------------------------------- objects
const mat = (frag, uniforms = {}, defines = {}) =>
  new THREE.ShaderMaterial({ vertexShader: objVert, fragmentShader: common + '\n' + frag, uniforms, defines });

// backdrop
const backdrop = new THREE.Mesh(
  new THREE.SphereGeometry(40, 48, 24),
  new THREE.ShaderMaterial({
    vertexShader: objVert,
    fragmentShader: common + '\n' + backdropFrag,
    side: THREE.BackSide,
    depthWrite: false,
  }),
);
backdrop.renderOrder = -1;
scene.add(backdrop);

// plinth
const half = new THREE.Vector3(0.7, 1.5, 0.7);
const plinthMat = mat(plinthFrag, {
  uHalf: { value: half },
  uGemC: { value: new THREE.Vector3() },
  uGemR: { value: 0.4 },
  uGemAng: { value: 0 },
  uCaustic: { value: 1.0 },
});
const plinth = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), plinthMat);
plinth.position.y = -half.y;
scene.add(plinth);

// gem on a brass pin
const GEM_SCALE = 0.37;
const PIN_H = 0.2;
const TILT = 0.36;
const { geometry: gemGeo, planes, pavD } = buildGem();
const gemMat = mat(
  gemFrag,
  {
    uPlanes: { value: planes },
    uRot: { value: new THREE.Matrix3() },
    uCamObj: { value: new THREE.Vector3() },
    uDisp: { value: 3.0 },
    uFrame: { value: 0 },
  },
  { NPL: planes.length, MAXB: 6, NS: 7 },
);
const pivot = new THREE.Group();
pivot.position.y = PIN_H;
scene.add(pivot);
const tilt = new THREE.Group();
tilt.rotation.z = TILT;
pivot.add(tilt);
const gem = new THREE.Mesh(gemGeo, gemMat);
gem.scale.setScalar(GEM_SCALE);
gem.position.y = pavD * GEM_SCALE;
tilt.add(gem);

const pinMat = mat(pinFrag);
const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0105, PIN_H, 24), pinMat);
pin.position.y = PIN_H / 2;
scene.add(pin);
const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.014, 48), pinMat);
foot.position.y = 0.007;
scene.add(foot);
const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.006, 0.02, 24), pinMat);
cup.position.y = PIN_H + 0.004;
scene.add(cup);

// ---------------------------------------------------------------- post
const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
const sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true, samples: 4 });
const LEVELS = 5;
const down = [], up = [];
for (let i = 0; i < LEVELS; i++) down.push(new THREE.WebGLRenderTarget(1, 1, rtOpts));
for (let i = 0; i < LEVELS - 1; i++) up.push(new THREE.WebGLRenderTarget(1, 1, rtOpts));

const fsScene = new THREE.Scene();
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
fsQuad.frustumCulled = false;
fsScene.add(fsQuad);
const downMat = new THREE.ShaderMaterial({
  vertexShader: fsVert, fragmentShader: bloomDownFrag, depthTest: false, depthWrite: false,
  uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.2 }, uFirst: { value: 0 } },
});
const upMat = new THREE.ShaderMaterial({
  vertexShader: fsVert, fragmentShader: bloomUpFrag, depthTest: false, depthWrite: false,
  uniforms: { tSmall: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() } },
});
const compMat = new THREE.ShaderMaterial({
  vertexShader: fsVert, fragmentShader: compositeFrag, depthTest: false, depthWrite: false,
  uniforms: {
    tScene: { value: sceneRT.texture }, tBloom: { value: null }, uSceneTexel: { value: new THREE.Vector2() },
    uBloom: { value: 0.09 }, uExposure: { value: 0.88 }, uFrame: { value: 0 }, uSS: { value: SS },
  },
});
function blit(material, target) {
  fsQuad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(fsScene, fsCam);
}

function resize(w, h) {
  W = w; H = h;
  renderer.setSize(W, H, !CAPTURE);
  if (CAPTURE) { renderer.domElement.style.width = W + 'px'; renderer.domElement.style.height = H + 'px'; }
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  sceneRT.setSize(Math.round(W * SS), Math.round(H * SS));
  let bw = Math.max(1, W >> 1), bh = Math.max(1, H >> 1);
  for (let i = 0; i < LEVELS; i++) {
    down[i].setSize(bw, bh);
    if (i < LEVELS - 1) up[i].setSize(bw, bh);
    bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
  }
  compMat.uniforms.uSceneTexel.value.set(1 / (W * SS), 1 / (H * SS));
}
resize(W, H);
if (!CAPTURE) window.addEventListener('resize', () => resize(window.innerWidth, window.innerHeight));

// ---------------------------------------------------------------- controls
let controls = null;
let spin = true;
let spinAngle = 0.0;
const dispModes = [3.0, 1.0, 0.0];
let dispIdx = 0;
const hud = document.getElementById('hud');
if (!CAPTURE) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.53;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') spin = !spin;
    if (e.code === 'KeyD') { dispIdx = (dispIdx + 1) % dispModes.length; gemMat.uniforms.uDisp.value = dispModes[dispIdx]; }
    if (e.code === 'KeyH') hud.style.display = hud.style.display === 'none' ? '' : 'none';
  });
  hud.textContent = 'drag: orbit · wheel: zoom · space: pause spin · D: dispersion 3x / 1x / off · H: hide';
} else {
  hud.style.display = 'none';
}

function cameraPath(t) {
  // slow push-in and drift around the plinth
  const az = -0.32 + t * 0.045;
  const pol = 1.30 - t * 0.006;
  const r = 4.0 - t * 0.07;
  camera.position.set(
    target.x + r * Math.sin(pol) * Math.sin(az),
    target.y + r * Math.cos(pol),
    target.z + r * Math.sin(pol) * Math.cos(az),
  );
  camera.lookAt(target);
}
cameraPath(0);

// ---------------------------------------------------------------- frame
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
let frameNo = 0;

function update(t, dt) {
  if (CAPTURE) {
    spinAngle = 0.5 + t * 0.42;
    cameraPath(t);
  } else {
    if (spin) spinAngle += dt * 0.42;
    controls.update();
  }
  pivot.rotation.y = spinAngle;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  tmpM.extractRotation(gem.matrixWorld);
  gemMat.uniforms.uRot.value.setFromMatrix4(tmpM);
  gemMat.uniforms.uCamObj.value.copy(gem.worldToLocal(tmpV.copy(camera.position)));
  gemMat.uniforms.uFrame.value = frameNo;
  gem.getWorldPosition(plinthMat.uniforms.uGemC.value);
  plinthMat.uniforms.uGemR.value = GEM_SCALE;
  plinthMat.uniforms.uGemAng.value = spinAngle;
}

function draw() {
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);

  // bloom chain
  downMat.uniforms.uFirst.value = 1;
  downMat.uniforms.tSrc.value = sceneRT.texture;
  downMat.uniforms.uTexel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
  blit(downMat, down[0]);
  downMat.uniforms.uFirst.value = 0;
  for (let i = 1; i < LEVELS; i++) {
    downMat.uniforms.tSrc.value = down[i - 1].texture;
    downMat.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
    blit(downMat, down[i]);
  }
  for (let i = LEVELS - 2; i >= 0; i--) {
    const small = i === LEVELS - 2 ? down[LEVELS - 1] : up[i + 1];
    upMat.uniforms.tSmall.value = small.texture;
    upMat.uniforms.tCur.value = down[i].texture;
    upMat.uniforms.uTexel.value.set(1 / small.width, 1 / small.height);
    blit(upMat, up[i]);
  }
  compMat.uniforms.tBloom.value = up[0].texture;
  compMat.uniforms.uFrame.value = frameNo;
  blit(compMat, null);
  frameNo++;
}

if (CAPTURE) {
  window.renderFrame = (n) =>
    new Promise((resolve) => {
      frameNo = n;
      update(n / FPS, 1 / FPS);
      draw();
      const gl = renderer.getContext();
      gl.finish();
      requestAnimationFrame(() => resolve(n));
    });
  window.__ready = true;
} else {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    update(clock.elapsedTime, dt);
    draw();
  });
}
