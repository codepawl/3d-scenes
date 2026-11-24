import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import commonGlsl from './shaders/common.glsl?raw';
import envGlsl from './shaders/env.glsl?raw';
import loopGlsl from './shaders/loop.glsl?raw';
import filmVert from './shaders/film.vert?raw';
import filmFrag from './shaders/film.frag?raw';
import basicVert from './shaders/basic.vert?raw';
import skyFrag from './shaders/sky.frag?raw';
import wireFrag from './shaders/wire.frag?raw';
import quadVert from './shaders/quad.vert?raw';
import blurFrag from './shaders/blur.frag?raw';
import postFrag from './shaders/post.frag?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const W = 1280, H = 720, FPS = 30, T0 = 2.0;

// resolve our own includes before three sees the source
const chunks = { common: commonGlsl, env: envGlsl, loop: loopGlsl };
const inc = (src) => src.replace(/#include <(common|env|loop)>/g, (_, k) => chunks[k]);

// keep in sync with loopR() in loop.glsl
const loopRadius = (th) => 1.0 + 0.022 * Math.sin(3 * th + 0.7) + 0.014 * Math.sin(5 * th + 2.1) + 0.01 * Math.sin(2 * th - 0.4);

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(CAPTURE ? W : innerWidth, CAPTURE ? H : innerHeight);
document.body.appendChild(renderer.domElement);
if (CAPTURE) document.getElementById('hud').style.display = 'none';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, CAPTURE ? W / H : innerWidth / innerHeight, 0.05, 200);
camera.position.set(1.0, 0.2, 3.55);
const target = new THREE.Vector3(0, -0.04, 0);
camera.lookAt(target);

const uTime = { value: T0 };

// background dome: the same analytic environment the film and wire reflect
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(60, 64, 32),
  new THREE.ShaderMaterial({ vertexShader: basicVert, fragmentShader: inc(skyFrag), uniforms: { uTime }, side: THREE.BackSide, depthWrite: false })
);
sky.renderOrder = -1;
scene.add(sky);

// wire: hand-bent loop + twisted stem
const loopPts = [];
for (let i = 0; i < 160; i++) {
  const th = (i / 160) * Math.PI * 2;
  const r = loopRadius(th);
  loopPts.push(new THREE.Vector3(r * Math.cos(th), r * Math.sin(th), 0));
}
const loopCurve = new THREE.CatmullRomCurve3(loopPts, true);
const wireRadius = 0.03;
const wireMat = (len) => new THREE.ShaderMaterial({ vertexShader: basicVert, fragmentShader: inc(wireFrag), uniforms: { uTime, uLen: { value: len } } });
scene.add(new THREE.Mesh(new THREE.TubeGeometry(loopCurve, 600, wireRadius, 20, true), wireMat(loopCurve.getLength())));

const yb = -loopRadius(-Math.PI / 2);
for (const off of [0, Math.PI]) {
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const s = i / 80;
    const y = yb - 0.02 - s * 3.0;
    const ph = off + s * 3.0 * 9.0;
    const a = wireRadius * 1.05 * Math.min(1, s * 25 + 0.3);
    pts.push(new THREE.Vector3(a * Math.cos(ph), y, a * Math.sin(ph)));
  }
  const c = new THREE.CatmullRomCurve3(pts);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(c, 400, wireRadius, 14, false), wireMat(c.getLength())));
}

// soap film: polar grid built from the loop shape, so the outer ring lies exactly on the wire centreline
function makeFilmGeometry(rings, segs) {
  const pos = [0, 0, 0];
  const idx = [];
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    const s = 1 - Math.pow(1 - t, 1.5); // denser rings toward the rim
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const r = s * loopRadius(th);
      pos.push(r * Math.cos(th), r * Math.sin(th), 0);
    }
  }
  const v = (i, j) => 1 + (i - 1) * segs + (j % segs);
  for (let j = 0; j < segs; j++) idx.push(0, v(1, j), v(1, j + 1));
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j), d = v(i + 1, j + 1);
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
const film = new THREE.Mesh(
  makeFilmGeometry(160, 420),
  new THREE.ShaderMaterial({
    vertexShader: inc(filmVert), fragmentShader: inc(filmFrag), uniforms: { uTime },
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
);
film.renderOrder = 2;
scene.add(film);

// render targets: MSAA HDR scene -> quarter-res bloom -> tonemap
const rtOpts = { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace, depthBuffer: true };
let sceneRT, bloomA, bloomB;
function makeTargets(w, h) {
  sceneRT?.dispose(); bloomA?.dispose(); bloomB?.dispose();
  sceneRT = new THREE.WebGLRenderTarget(w, h, { ...rtOpts, samples: 4 });
  bloomA = new THREE.WebGLRenderTarget(w >> 2, h >> 2, { ...rtOpts, depthBuffer: false });
  bloomB = new THREE.WebGLRenderTarget(w >> 2, h >> 2, { ...rtOpts, depthBuffer: false });
}
const quadScene = new THREE.Scene();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
quadScene.add(quad);
const blurMat = new THREE.ShaderMaterial({
  vertexShader: quadVert, fragmentShader: blurFrag, depthTest: false, depthWrite: false,
  uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uThresh: { value: 0 } },
});
const postMat = new THREE.ShaderMaterial({
  vertexShader: quadVert, fragmentShader: postFrag, depthTest: false, depthWrite: false,
  uniforms: { tScene: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2() }, uFrame: { value: 0 } },
});

function resize() {
  const w = CAPTURE ? W : innerWidth, h = CAPTURE ? H : innerHeight;
  if (!CAPTURE) renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  makeTargets(v.x, v.y);
  postMat.uniforms.uRes.value.copy(v);
}
resize();
addEventListener('resize', resize);

let controls = null;
if (!CAPTURE) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.minDistance = 1.6;
  controls.maxDistance = 7;
}

function cameraPath(t) {
  // slow drift, used in capture and until the user grabs the controls
  const a = 0.27 + 0.07 * Math.sin(t * 0.42) - 0.03 * (t - T0) / 6;
  const r = 3.75 - 0.12 * Math.sin(t * 0.3);
  camera.position.set(r * Math.sin(a), 0.2 + 0.06 * Math.sin(t * 0.33), r * Math.cos(a));
  camera.lookAt(target);
}

let frame = 0;
function draw() {
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  const bw = bloomA.width, bh = bloomA.height;
  quad.material = blurMat;
  blurMat.uniforms.tSrc.value = sceneRT.texture;
  blurMat.uniforms.uDir.value.set(1.5 / bw, 0);
  blurMat.uniforms.uThresh.value = 1.2;
  renderer.setRenderTarget(bloomA);
  renderer.render(quadScene, quadCam);
  blurMat.uniforms.tSrc.value = bloomA.texture;
  blurMat.uniforms.uDir.value.set(0, 1.5 / bh);
  blurMat.uniforms.uThresh.value = 0;
  renderer.setRenderTarget(bloomB);
  renderer.render(quadScene, quadCam);
  quad.material = postMat;
  postMat.uniforms.tScene.value = sceneRT.texture;
  postMat.uniforms.tBloom.value = bloomB.texture;
  postMat.uniforms.uFrame.value = frame++;
  renderer.setRenderTarget(null);
  renderer.render(quadScene, quadCam);
}

if (CAPTURE) {
  window.renderFrame = (n) => new Promise((resolve) => {
    uTime.value = T0 + n / FPS;
    cameraPath(uTime.value);
    frame = n;
    draw();
    renderer.getContext().finish();
    requestAnimationFrame(() => resolve(true));
  });
  window.captureReady = true;
} else {
  let paused = false, userMoved = false, last = performance.now();
  controls.addEventListener('start', () => { userMoved = true; });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyH') {
      const h = document.getElementById('hud');
      h.style.display = h.style.display === 'none' ? '' : 'none';
    }
  });
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) uTime.value += dt;
    if (!userMoved) cameraPath(uTime.value);
    controls.update();
    draw();
  });
}
