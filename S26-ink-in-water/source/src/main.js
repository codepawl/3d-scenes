import * as THREE from 'three';
import { Fluid } from './fluid.js';
import { sceneVert, sceneFrag, postFrag } from './sceneShader.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;
const SUBSTEPS = 2;            // fluid steps per 1/30 s frame
const SIM_SPEED = 1.0;

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
if (CAPTURE) document.getElementById('hud')?.remove();

const fluid = new Fluid(renderer, { simW: 288, dyeScale: 3 });
const WATER_H = 2.14; // sim domain height (tank floor to water level)

// ---------- render targets & passes ----------
let W = 1280, H = 720;
const ssaa = params.get('ssaa') ? Number(params.get('ssaa')) : (CAPTURE ? 2 : 1);
const hdr = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
});

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadScene = new THREE.Scene();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
quadScene.add(quad);

const sceneMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, vertexShader: sceneVert, fragmentShader: sceneFrag,
  uniforms: {
    uDye: { value: null }, uDyeBlur: { value: null },
    uRes: { value: new THREE.Vector2() }, uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() }, uCamRot: { value: new THREE.Matrix3() },
    uFovY: { value: THREE.MathUtils.degToRad(34) }, uFrame: { value: 0 },
  },
  depthTest: false, depthWrite: false,
});
const postMat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, vertexShader: sceneVert, fragmentShader: postFrag,
  uniforms: { uSrc: { value: hdr.texture }, uSrcTexel: { value: new THREE.Vector2() }, uScale: { value: ssaa }, uFrame: { value: 0 } },
  depthTest: false, depthWrite: false,
});

function resize() {
  if (CAPTURE) { W = 1280; H = 720; } else { W = innerWidth; H = innerHeight; }
  renderer.setSize(W, H, !CAPTURE);
  if (CAPTURE) { renderer.domElement.style.width = '1280px'; renderer.domElement.style.height = '720px'; }
  hdr.setSize(W * ssaa, H * ssaa);
  sceneMat.uniforms.uRes.value.set(W * ssaa, H * ssaa);
  postMat.uniforms.uSrcTexel.value.set(1 / (W * ssaa), 1 / (H * ssaa));
}
resize();
addEventListener('resize', resize);

// ---------- camera ----------
const camObj = new THREE.PerspectiveCamera();
function setCamera(t, mouse) {
  // slow push-in and orbit; the camera sits below the water line so the surface is seen from beneath
  const a = THREE.MathUtils.degToRad(-7 + 9 * Math.min(t / 6, 1.0) + (mouse ? mouse.x * 14 : 0));
  const r = 6.4 - 0.35 * Math.min(t / 6, 1.0);
  const y = 1.32 + (mouse ? mouse.y * 0.4 : 0);
  camObj.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
  camObj.lookAt(0, 1.18, 0);
  camObj.updateMatrixWorld();
  sceneMat.uniforms.uCamPos.value.copy(camObj.position);
  sceneMat.uniforms.uCamRot.value.setFromMatrix4(camObj.matrixWorld);
}

// ---------- ink drops ----------
// A drop: dense ink injected just under the surface with a downward jet over a few frames,
// which rolls up into a vortex ring (a vortex pair in the sim plane) and then falls as a heavy plume.
const schedule = [
  { t: 0.10, x: -0.22, ink: [1.0, 0.0], s: 1.0 },
  { t: 1.55, x: 0.38, ink: [0.0, 1.0], s: 0.9 },
  { t: 3.10, x: -0.02, ink: [0.75, 0.25], s: 0.7 },
];
const active = [];
function spawnDrop(x, ink, s, depth = 0.08) { active.push({ x, ink, s, age: 0, depth }); }

function applyDrops(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const d = active[i];
    const y = WATER_H - d.depth - d.age * 1.4;
    const k = d.s * dt * 60;
    if (d.age < 0.12) {
      fluid.addVelocity(d.x, y, 0.05, 0.07, 0, -2.6 * k * 0.6);
      fluid.addDye(d.x, y, 0.045, 0.05, d.ink[0] * 0.38 * k, d.ink[1] * 0.38 * k);
    } else if (d.age < 0.45) {
      // thin trailing thread from the surface
      const f = 1 - (d.age - 0.12) / 0.33;
      fluid.addDye(d.x + 0.004 * Math.sin(d.age * 40), WATER_H - 0.05, 0.012, 0.04, d.ink[0] * 0.12 * k * f, d.ink[1] * 0.12 * k * f);
      fluid.addVelocity(d.x, WATER_H - 0.06, 0.02, 0.05, 0, -0.5 * k * f);
    }
    d.age += dt;
    if (d.age > 0.45) active.splice(i, 1);
  }
}

let simTime = 0;
let schedIdx = 0;
function simulate(dt) {
  while (schedIdx < schedule.length && schedule[schedIdx].t <= simTime) {
    const s = schedule[schedIdx++];
    spawnDrop(s.x, s.ink, s.s);
  }
  applyDrops(dt);
  fluid.step(dt);
  simTime += dt;
}

function draw(t, frame, mouse) {
  fluid.updateBlur();
  setCamera(t, mouse);
  sceneMat.uniforms.uDye.value = fluid.dye.read.texture;
  sceneMat.uniforms.uDyeBlur.value = fluid.blur.texture;
  sceneMat.uniforms.uTime.value = t;
  sceneMat.uniforms.uFrame.value = frame;
  quad.material = sceneMat;
  renderer.setRenderTarget(hdr);
  renderer.render(quadScene, cam);
  postMat.uniforms.uFrame.value = frame;
  quad.material = postMat;
  renderer.setRenderTarget(null);
  renderer.render(quadScene, cam);
}

function reset() {
  fluid.clear();
  active.length = 0;
  simTime = 0;
  schedIdx = 0;
}

if (CAPTURE) {
  let simFrame = 0;
  window.renderFrame = async (n) => {
    if (n < simFrame) { reset(); simFrame = 0; }
    while (simFrame < n) {
      for (let s = 0; s < SUBSTEPS; s++) simulate(SIM_SPEED / FPS / SUBSTEPS);
      simFrame++;
    }
    draw(n / FPS, n, null);
    const gl = renderer.getContext();
    // read one pixel back so the promise resolves only after the GPU has finished this frame
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return true;
  };
  window.captureReady = true;
} else {
  let paused = false;
  let acc = 0;
  let last = performance.now();
  let frame = 0;
  let wallT = 0;
  const mouse = { x: 0, y: 0 };
  let inkChoice = 0;
  const inks = [[1, 0], [0, 1], [0.6, 0.4]];
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyR') { reset(); wallT = 0; }
    if (e.code === 'KeyC') inkChoice = (inkChoice + 1) % inks.length;
  });
  addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / innerWidth - 0.5) * 0.3;
    mouse.y = -(e.clientY / innerHeight - 0.5) * 0.3;
  });
  addEventListener('pointerdown', (e) => {
    // drop ink at the clicked horizontal position (approximate projection onto the tank front)
    const nx = (e.clientX / innerWidth) * 2 - 1;
    const x = THREE.MathUtils.clamp(nx * 1.9, -0.85, 0.85);
    spawnDrop(x, inks[inkChoice], 0.8);
  });
  const fixed = 1 / (FPS * SUBSTEPS);
  function loop(now) {
    requestAnimationFrame(loop);
    const dtw = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) {
      acc += dtw * SIM_SPEED;
      wallT += dtw;
      let n = 0;
      while (acc >= fixed && n < 4) { simulate(fixed); acc -= fixed; n++; }
      if (n === 4) acc = 0;
      // auto-loop: after 40 s start over
      if (simTime > 40) { reset(); wallT = 0; }
    }
    draw(wallT, frame++, mouse);
  }
  requestAnimationFrame(loop);
}
