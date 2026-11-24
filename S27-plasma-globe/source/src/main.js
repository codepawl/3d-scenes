import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as S from './shaders.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const N = S.N_ARCS;
const BRANCHES = 3;
const SEG = 140;
const R_GLASS = 1.0;

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
});
if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 100);
camera.position.set(0.6, 0.45, 5.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.15, 0);
controls.enableDamping = true;
controls.minDistance = 2.4;
controls.maxDistance = 9;
controls.enabled = !CAPTURE;

// ------------------------------------------------------------------ shared uniforms
const ends = Array.from({ length: N }, () => new THREE.Vector3(0, 1, 0));
const shared = {
  uTime: { value: 0 },
  uEnd: { value: ends },
  uPull: { value: new Array(N).fill(0) },
  uLevel: { value: new Array(N).fill(1) },
  uFingerDir: { value: new THREE.Vector3(1, 0, 0) },
  uTouch: { value: 0 },
};

// ------------------------------------------------------------------ backdrop + floor
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(40, 32, 16),
  new THREE.ShaderMaterial({ vertexShader: S.skyVert, fragmentShader: S.skyFrag, side: THREE.BackSide, depthWrite: false })
);
sky.renderOrder = -10;
scene.add(sky);

const FLOOR_Y = -1.62;
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
  new THREE.ShaderMaterial({
    vertexShader: S.coreVert, fragmentShader: S.floorFrag,
    uniforms: { uTouch: shared.uTouch, uTime: shared.uTime },
  })
);
floor.position.y = FLOOR_Y;
scene.add(floor);

// ------------------------------------------------------------------ lit solids
function solid(albedo, rough, skin, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: S.solidVert, fragmentShader: S.solidFrag,
    uniforms: {
      uAlbedo: { value: new THREE.Color(...albedo) },
      uRough: { value: rough }, uSkin: { value: skin }, uPlasma: { value: 1.0 },
      uTouch: shared.uTouch, uTime: shared.uTime,
      uTaper: { value: extra.taper ?? 0 },
      uTipGlow: { value: extra.tipGlow ?? 0 },
      uTipPos: extra.tipPos ?? { value: new THREE.Vector3(9, 9, 9) },
      uNail: { value: extra.nail ?? 0 }, uFingerR: { value: extra.fingerR ?? 0.1 },
    },
  });
}

// base: lathe profile of a black plastic pedestal with a metal collar
const prof = [
  [0.0, -1.62], [0.78, -1.62], [0.80, -1.60], [0.80, -1.52], [0.74, -1.40],
  [0.56, -1.12], [0.50, -1.02], [0.47, -0.96], [0.0, -0.96],
].map(([x, y]) => new THREE.Vector2(x, y));
const base = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), solid([0.02, 0.02, 0.025], 0.35, 0.0));
scene.add(base);
const collar = new THREE.Mesh(
  new THREE.TorusGeometry(0.43, 0.035, 16, 96).rotateX(Math.PI / 2),
  solid([0.35, 0.33, 0.36], 0.15, 0.0)
);
collar.position.y = -0.94;
scene.add(collar);
const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 0.8, 24), solid([0.08, 0.08, 0.09], 0.3, 0));
stem.position.y = -0.56;
scene.add(stem);

// core electrode
const core = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 48, 32),
  new THREE.ShaderMaterial({
    vertexShader: S.coreVert, fragmentShader: S.coreFrag,
    uniforms: { uTime: shared.uTime, uTouch: shared.uTouch },
  })
);
scene.add(core);

// fingertip prop: tapered capsule, local +y points away from the globe
const tipPos = { value: new THREE.Vector3() };
const FINGER_R = 0.105;
const FINGER_LEN = 2.4;
const fingerGeo = new THREE.CapsuleGeometry(FINGER_R, FINGER_LEN, 12, 32);
fingerGeo.translate(0, FINGER_LEN / 2 + FINGER_R, 0); // tip at origin
// normalise y for taper: scale positions so taper uses y/len (done via uTaper small)
const finger = new THREE.Mesh(fingerGeo, solid([0.58, 0.34, 0.26], 0.5, 0.7, { taper: 0.10, tipGlow: 1, tipPos, nail: 1, fingerR: FINGER_R }));
scene.add(finger);

// ------------------------------------------------------------------ arcs
function buildArcs() {
  const strands = N * BRANCHES;
  const vpr = (SEG + 1) * 2;
  const aT = new Float32Array(strands * vpr);
  const aSide = new Float32Array(strands * vpr);
  const aArc = new Float32Array(strands * vpr);
  const aBranch = new Float32Array(strands * vpr);
  const idx = [];
  let v = 0;
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < BRANCHES; b++) {
      const start = v;
      for (let s = 0; s <= SEG; s++) {
        for (const side of [-1, 1]) {
          aT[v] = s / SEG; aSide[v] = side; aArc[v] = a; aBranch[v] = b; v++;
        }
        if (s < SEG) {
          const i0 = start + s * 2;
          idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strands * vpr * 3), 3));
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  g.setAttribute('aArc', new THREE.BufferAttribute(aArc, 1));
  g.setAttribute('aBranch', new THREE.BufferAttribute(aBranch, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  const m = new THREE.ShaderMaterial({
    vertexShader: S.arcVert, fragmentShader: S.arcFrag,
    uniforms: {
      ...shared,
      uCoreR: { value: 0.15 }, uGlassR: { value: R_GLASS * 0.975 }, uWidth: { value: 0.032 },
    },
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}
scene.add(buildArcs());

// ------------------------------------------------------------------ glass (back faces, then front faces)
function glass(back) {
  const m = new THREE.ShaderMaterial({
    vertexShader: S.glassVert, fragmentShader: S.glassFrag,
    uniforms: {
      ...shared,
      uCenter: { value: new THREE.Vector3() }, uRadius: { value: R_GLASS }, uBack: { value: back ? 1 : 0 },
    },
    side: back ? THREE.BackSide : THREE.FrontSide,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R_GLASS, 128, 64), m);
  mesh.renderOrder = back ? 4 : 6;
  return mesh;
}
scene.add(glass(true));
scene.add(glass(false));

// ------------------------------------------------------------------ animation (pure function of t)
const baseDirs = [];
const phases = [];
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const y = 0.95 - (i + 0.5) / N * 1.45; // keep away from the pedestal
    const th = i * 2.39996323;
    baseDirs.push({ el: Math.asin(y), az: th });
    phases.push([rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, 0.7 + rnd() * 0.6, 0.7 + rnd() * 0.6, rnd()]);
  }
}
const sph = (el, az, out) => out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));

function slerpDir(a, b, t, out) {
  const d = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const ang = Math.acos(d);
  if (ang < 1e-4) return out.copy(a);
  if (Math.PI - ang < 0.02) { // nearly opposite: route over the top
    const mid = new THREE.Vector3(0, 1, 0).addScaledVector(a, -a.y).normalize();
    return t < 0.5 ? slerpDir(a, mid, t * 2, out) : slerpDir(mid, b, t * 2 - 1, out);
  }
  const s = Math.sin(ang);
  return out.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s).normalize();
}

const tmp = new THREE.Vector3();
const fingerDir = new THREE.Vector3();
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 8 s loop: approach (0-1.8), touch & slide (1.8-4.4), retreat (4.4-5.4), free orbit.
function fingerState(t) {
  const tm = ((t % 8) + 8) % 8;
  const env = smooth(0.4, 1.8, tm) * (1 - smooth(4.4, 5.4, tm));
  const az = 0.55 + t * 0.32 - 0.25 * Math.sin(t * 0.32);
  const el = 0.32 + 0.22 * Math.sin(t * 0.5 + 0.6);
  sph(el, az, fingerDir);
  const gap = 0.55 * (1 - env);
  return { gap, touch: smooth(0.06, 0.0, gap), near: smooth(0.5, 0.0, gap) };
}

function update(t) {
  shared.uTime.value = t;
  const f = fingerState(t);
  shared.uFingerDir.value.copy(fingerDir);
  shared.uTouch.value = f.touch;

  // finger transform: tip sits just outside the glass, shaft points away from the centre
  const tipDist = R_GLASS + 0.008 + f.gap;
  tipPos.value.copy(fingerDir).multiplyScalar(tipDist);
  finger.position.copy(tipPos.value);
  // tilt the shaft upward a bit so it reads like a hand reaching in from above-side
  const shaft = tmp.copy(fingerDir).add(new THREE.Vector3(0, 0.3, 0)).normalize();
  // roll so the nail (local +z) faces up and slightly toward the camera
  const want = new THREE.Vector3(0, 1, 0).addScaledVector(camera.position.clone().normalize(), 0.6);
  const zAx = want.addScaledVector(shaft, -want.dot(shaft)).normalize();
  const xAx = new THREE.Vector3().crossVectors(shaft, zAx).normalize();
  finger.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, shaft, zAx));

  for (let i = 0; i < N; i++) {
    const b = baseDirs[i], p = phases[i];
    const el = THREE.MathUtils.clamp(
      b.el + 0.32 * Math.sin(t * 0.37 * p[3] + p[0]) + 0.12 * Math.sin(t * 1.1 + p[2]), -0.75, 1.35);
    const az = b.az + 0.6 * Math.sin(t * 0.23 * p[4] + p[1]) + 0.18 * Math.sin(t * 0.9 * p[3] + p[2]) + t * 0.05;
    sph(el, az, ends[i]);
    // most filaments are drawn to the finger; earlier for those already close to it
    const closeness = 0.5 + 0.5 * ends[i].dot(fingerDir);
    const thresh = p[5] * 0.75 * (1.2 - closeness);
    const captured = i % 4 !== 3; // a few stay free
    const pull = captured ? smooth(thresh, thresh + 0.3, f.near * (0.4 + 0.6 * f.touch)) : 0;
    slerpDir(ends[i], fingerDir, pull, ends[i]);
    shared.uPull.value[i] = pull;
    const lvl = 0.75 + 0.25 * Math.sin(t * 1.7 * p[3] + p[0] * 3);
    shared.uLevel.value[i] = lvl * (1 - 0.55 * f.touch * (1 - pull));
  }

  // camera drift in capture / idle
  if (CAPTURE) {
    const a = 0.12 + t * 0.045;
    const r = 5.2;
    camera.position.set(Math.sin(a) * r, 0.42 + 0.08 * Math.sin(t * 0.4), Math.cos(a) * r);
    camera.lookAt(controls.target);
  }
}

// ------------------------------------------------------------------ post-processing
const fsGeo = new THREE.BufferGeometry();
fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsMesh = new THREE.Mesh(fsGeo);
fsMesh.frustumCulled = false;
const fsScene = new THREE.Scene();
fsScene.add(fsMesh);

const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
let rtScene = null;
let mips = [];
const MIPS = 6;
const downMat = new THREE.ShaderMaterial({
  vertexShader: S.fsVert, fragmentShader: S.downFrag, depthTest: false, depthWrite: false,
  uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } },
});
const upMat = new THREE.ShaderMaterial({
  vertexShader: S.fsVert, fragmentShader: S.upFrag, depthTest: false, depthWrite: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
});
const compMat = new THREE.ShaderMaterial({
  vertexShader: S.fsVert, fragmentShader: S.compositeFrag, depthTest: false, depthWrite: false,
  uniforms: {
    tScene: { value: null }, tBloom: { value: null },
    uBloom: { value: 0.32 }, uExposure: { value: 1.0 }, uFrame: { value: 0 },
  },
});

function resize(w, h) {
  renderer.setSize(w, h, !CAPTURE);
  const pr = renderer.getPixelRatio();
  const W = Math.floor(w * pr), H = Math.floor(h * pr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  rtScene?.dispose();
  mips.forEach((m) => m.dispose());
  rtScene = new THREE.WebGLRenderTarget(W, H, { ...rtOpts, depthBuffer: true, samples: 4 });
  mips = [];
  let mw = W, mh = H;
  for (let i = 0; i < MIPS; i++) {
    mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    mips.push(new THREE.WebGLRenderTarget(mw, mh, rtOpts));
  }
}

function blit(mat, target) {
  fsMesh.material = mat;
  renderer.setRenderTarget(target);
  renderer.render(fsScene, fsCam);
}

let frameNo = 0;
function draw() {
  renderer.setRenderTarget(rtScene);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  // bloom: downsample chain
  let src = rtScene;
  for (let i = 0; i < MIPS; i++) {
    downMat.uniforms.tSrc.value = src.texture;
    downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
    blit(downMat, mips[i]);
    src = mips[i];
  }
  // upsample, accumulating into the larger mip
  for (let i = MIPS - 1; i > 0; i--) {
    upMat.uniforms.tSrc.value = mips[i].texture;
    upMat.uniforms.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
    upMat.uniforms.uWeight.value = 0.75;
    blit(upMat, mips[i - 1]);
  }
  compMat.uniforms.tScene.value = rtScene.texture;
  compMat.uniforms.tBloom.value = mips[0].texture;
  compMat.uniforms.uFrame.value = frameNo++ % 64;
  blit(compMat, null);
}

// ------------------------------------------------------------------ loop / capture
const hud = document.getElementById('hud');
if (CAPTURE) {
  hud.remove();
  resize(1280, 720);
  window.renderFrame = (n) => new Promise((resolve) => {
    update(n / 30);
    draw();
    renderer.getContext().finish();
    requestAnimationFrame(() => resolve(n));
  });
  window.captureReady = true;
} else {
  resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => resize(window.innerWidth, window.innerHeight));
  let paused = false, t = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0;
  hud.textContent = 'drag: orbit · scroll: zoom · space: pause · H: hide this text';
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyH') hud.style.display = hud.style.display === 'none' ? '' : 'none';
  });
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) t += dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
      hud.textContent = `${fps} fps · drag: orbit · scroll: zoom · space: pause · H: hide`; }
    controls.update();
    update(t);
    draw();
  });
}
