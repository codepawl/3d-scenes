import * as THREE from 'three';
import vert from './shaders/fullscreen.vert.glsl?raw';
import bhFrag from './shaders/blackhole.frag.glsl?raw';
import downFrag from './shaders/down.frag.glsl?raw';
import upFrag from './shaders/up.frag.glsl?raw';
import compFrag from './shaders/composite.frag.glsl?raw';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;
const SUBFRAMES = CAPTURE ? Number(params.get('spp') || 6) : 1; // jittered samples per frame in capture
const SHUTTER = 0.5; // fraction of a frame the shutter is open (motion blur in capture)

const W = CAPTURE ? 1280 : window.innerWidth;
const H = CAPTURE ? 720 : window.innerHeight;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: CAPTURE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1));
renderer.setSize(W, H, !CAPTURE);
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
if (CAPTURE) {
  renderer.domElement.style.width = '1280px';
  renderer.domElement.style.height = '720px';
}

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
const scene = new THREE.Scene();
scene.add(quad);
const cam = new THREE.Camera();

function raw(frag, uniforms, extra = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

function makeRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

// ---------------------------------------------------------------- materials
const bhUniforms = {
  uRes: { value: new THREE.Vector2() },
  uTime: { value: 0 },
  uDiskTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uCamRight: { value: new THREE.Vector3() },
  uCamUp: { value: new THREE.Vector3() },
  uCamFwd: { value: new THREE.Vector3() },
  uTanFov: { value: Math.tan(THREE.MathUtils.degToRad(19)) },
  uJitter: { value: new THREE.Vector2() },
  uWeight: { value: 1 },
  uBeamExp: { value: 3.0 },
};
const bhMat = raw(bhFrag, bhUniforms, {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  transparent: true,
});
const downMat = raw(downFrag, {
  tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 },
});
const upMat = raw(upFrag, {
  tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() },
});
const compMat = raw(compFrag, {
  tHdr: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2() },
  uFrame: { value: 0 }, uExposure: { value: 1.15 }, uBloom: { value: 0.3 },
});

// ---------------------------------------------------------------- targets
let hdrRT = null;
let downs = [];
let ups = [];
const LEVELS = 6;
function allocate(w, h) {
  if (hdrRT) hdrRT.dispose();
  downs.forEach((r) => r.dispose());
  ups.forEach((r) => r.dispose());
  hdrRT = makeRT(w, h);
  downs = [];
  ups = [];
  let cw = w, ch = h;
  for (let i = 0; i < LEVELS; i++) {
    cw = Math.max(1, cw >> 1);
    ch = Math.max(1, ch >> 1);
    downs.push(makeRT(cw, ch));
    ups.push(makeRT(cw, ch));
  }
  bhUniforms.uRes.value.set(w, h);
  compMat.uniforms.uRes.value.set(w, h);
}
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
allocate(size.x, size.y);

function pass(mat, target) {
  quad.material = mat;
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
}

// ---------------------------------------------------------------- camera
const ctl = { az: 0, el: 0, zoom: 1 };
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _wup = new THREE.Vector3();
const _target = new THREE.Vector3(0, -0.35, 0); // aim slightly below the hole

function cameraAt(t) {
  const az = 0.55 + 0.05 * t + ctl.az;
  const el = THREE.MathUtils.clamp(0.105 + 0.035 * Math.sin(t * 0.21) + ctl.el, -1.4, 1.4);
  const dist = (25.0 - 2.2 * Math.sin(t * 0.14)) * ctl.zoom;
  _pos.set(dist * Math.cos(el) * Math.cos(az), dist * Math.sin(el), dist * Math.cos(el) * Math.sin(az));
  _fwd.copy(_target).sub(_pos).normalize();
  const roll = 0.06 * Math.sin(t * 0.17) - 0.05; // slight roll for a less static frame
  _wup.set(Math.sin(roll), Math.cos(roll), 0);
  _right.crossVectors(_fwd, _wup).normalize();
  _up.crossVectors(_right, _fwd).normalize();
  bhUniforms.uCamPos.value.copy(_pos);
  bhUniforms.uCamFwd.value.copy(_fwd);
  bhUniforms.uCamRight.value.copy(_right);
  bhUniforms.uCamUp.value.copy(_up);
}

// ---------------------------------------------------------------- frame
const DISK_SPEED = 2.6;
const T0 = 2.0; // start offset into the motion path
let frameCounter = 0;

function drawScene(t, frameIndex) {
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  const n = SUBFRAMES;
  for (let s = 0; s < n; s++) {
    // R2 low-discrepancy sub-pixel jitter
    const jx = ((0.5 + s * 0.7548776662) % 1) - 0.5;
    const jy = ((0.5 + s * 0.5698402909) % 1) - 0.5;
    const ts = t + (n > 1 ? ((s + 0.5) / n - 0.5) * SHUTTER / FPS : 0);
    cameraAt(ts);
    bhUniforms.uTime.value = ts;
    bhUniforms.uDiskTime.value = ts * DISK_SPEED;
    bhUniforms.uJitter.value.set(n > 1 ? jx : 0, n > 1 ? jy : 0);
    bhUniforms.uWeight.value = 1 / n;
    pass(bhMat, hdrRT);
  }
  // bloom: down chain
  let src = hdrRT;
  for (let i = 0; i < LEVELS; i++) {
    downMat.uniforms.tSrc.value = src.texture;
    downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    downMat.uniforms.uPrefilter.value = i === 0 ? 1 : 0;
    pass(downMat, downs[i]);
    src = downs[i];
  }
  // bloom: up chain
  let coarse = downs[LEVELS - 1];
  for (let i = LEVELS - 2; i >= 0; i--) {
    upMat.uniforms.tSrc.value = coarse.texture;
    upMat.uniforms.tBase.value = downs[i].texture;
    upMat.uniforms.uTexel.value.set(1 / coarse.width, 1 / coarse.height);
    pass(upMat, ups[i]);
    coarse = ups[i];
  }
  compMat.uniforms.tHdr.value = hdrRT.texture;
  compMat.uniforms.tBloom.value = ups[0].texture;
  compMat.uniforms.uFrame.value = frameIndex;
  pass(compMat, null);
}

if (CAPTURE) {
  // Deterministic capture: time comes from the frame index, 1/30 s per frame.
  window.renderFrame = (n) => new Promise((resolve) => {
    drawScene(T0 + n / FPS, n);
    renderer.getContext().finish();
    resolve(true);
  });
  window.captureReady = true;
} else {
  // ------------------------------------------------------------ interaction
  let dragging = false, lx = 0, ly = 0, paused = false, t = 0, last = performance.now();
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    dragging = true; lx = e.clientX; ly = e.clientY;
    el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing';
  });
  el.addEventListener('pointerup', () => { dragging = false; el.style.cursor = 'grab'; });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    ctl.az += (e.clientX - lx) * 0.004;
    ctl.el += (e.clientY - ly) * 0.003;
    lx = e.clientX; ly = e.clientY;
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    ctl.zoom = THREE.MathUtils.clamp(ctl.zoom * Math.exp(e.deltaY * 0.001), 0.45, 2.2);
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.key === 'r' || e.key === 'R') { ctl.az = 0; ctl.el = 0; ctl.zoom = 1; }
    if (e.key === 'b' || e.key === 'B') bhUniforms.uBeamExp.value = bhUniforms.uBeamExp.value > 0 ? 0 : 3.0;
  });
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.getDrawingBufferSize(size);
    allocate(size.x, size.y);
  });
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) t += dt;
    drawScene(T0 + t, frameCounter++);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
