import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Garden, S, B, NX, NZ, CH, ROCKS, buildPath, pathAt, xOf, zOf } from './garden.js';
import { buildRock, buildWall, buildTree, buildRake } from './props.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.get('capture') === '1';
const FPS = 30;
const SPEED = 20;     // rake speed, cells per second
const T0 = 8.3;       // shot starts with row 0 raked and the rake turning into row 1

// ---------- soft shadow filter ----------
// three's PCF uses 5 noise-rotated taps; at a wide radius that turns to grain. Replace it with a 5x5 tent of
// hardware-compared (bilinear) taps, which gives smooth penumbrae with no per-pixel noise.
{
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = chunk.indexOf('float phi = interleavedGradientNoise');
  const b = chunk.indexOf(') * 0.2;', a) + ') * 0.2;'.length;
  if (a < 0 || b < a) throw new Error('shadow chunk layout changed');
  const tent = `
        shadow = 0.0; float wsum = 0.0;
        for (int sy = -2; sy <= 2; sy++) for (int sx = -2; sx <= 2; sx++) {
          float w = (3.0 - abs(float(sx))) * (3.0 - abs(float(sy)));
          shadow += w * texture( shadowMap, vec3( shadowCoord.xy + vec2(float(sx), float(sy)) * radius * 0.5, shadowCoord.z ) );
          wsum += w;
        }
        shadow /= wsum;`;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, a) + tent + chunk.slice(b);
}

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(window.devicePixelRatio, 2));
const W = CAPTURE ? 1280 : window.innerWidth, H = CAPTURE ? 720 : window.innerHeight;
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, W / H, 0.05, 120);

// ---------- light: low warm sun from the left, cool sky fill ----------
const sunDir = new THREE.Vector3(-1, 0.19, 0.1).normalize();
const horizon = new THREE.Color(0.95, 0.58, 0.36);
const zenith = new THREE.Color(0.22, 0.36, 0.62);
scene.fog = new THREE.Fog(new THREE.Color(0.86, 0.6, 0.45), 14, 60);

const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.64, 0.36), 5.6);
sun.position.copy(sunDir).multiplyScalar(20);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 2048);
const sc = sun.shadow.camera;
// the shadow camera's vertical axis is nearly world-up, so a low sun only needs a short vertical extent
sc.left = -7.5; sc.right = 7.5; sc.top = 4.2; sc.bottom = -2.2; sc.near = 4; sc.far = 40;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.012;
sun.shadow.radius = 9; // ~3 cm across, ~15 cm along the shadow on the ground
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.66, 0.85), new THREE.Color(0.45, 0.36, 0.26), 0.5));

// ---------- sky dome with sun glow + dither ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(100, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir }, uH: { value: horizon }, uZ: { value: zenith } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 uSun, uH, uZ; varying vec3 vDir;
      float h12(vec2 p){ uvec2 q = uvec2(ivec2(p)); uint h = q.x * 1597334677u ^ q.y * 3812015801u; h = (h ^ (h >> 16)) * 2246822519u; h ^= h >> 13; return float(h) / 4294967295.0; }
      void main(){
        vec3 d = normalize(vDir);
        float e = clamp(d.y, -0.2, 1.0);
        vec3 mid = mix(uH, uZ, 0.45) + vec3(0.04, 0.02, 0.06);
        float g = max(e, 0.0);
        vec3 c = mix(uH, mid, smoothstep(0.0, 0.1, g));
        c = mix(c, uZ, smoothstep(0.05, 0.32, g));
        c = mix(c, uH * 0.8, smoothstep(0.0, -0.2, e));
        float s = max(dot(d, normalize(uSun)), 0.0);
        c += vec3(1.0, 0.62, 0.32) * (pow(s, 6.0) * 0.55 * (1.0 - smoothstep(0.0, 0.5, g)) + pow(s, 400.0) * 6.0);
        c += (h12(gl_FragCoord.xy) - 0.5) / 255.0 * 2.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -1;
scene.add(sky);

// ---------- material with sub-voxel grain + roughness variation ----------
// angular size of one pixel, used to filter the grooves by their on-screen footprint
const pixAngle = { value: 0 };
const updatePix = () => { pixAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / renderer.domElement.height; };
updatePix();
function voxelMaterial({ grain = 0.2, rough = 0.9, roughVar = 0.1, cell = S / 4, filter = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 });
  if (filter) m.defines = { GROOVE_FILTER: 1 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrain = { value: grain };
    sh.uniforms.uRVar = { value: roughVar };
    sh.uniforms.uCell = { value: cell };
    sh.uniforms.uPix = pixAngle;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <common>', `#include <common>
        #ifdef GROOVE_FILTER
        attribute vec3 base; varying vec3 vBase;
        #endif`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef GROOVE_FILTER
        vBase = base;
        #endif`)
      // far away, look up shadows from above the ridge tops so groove self-shadowing (sub-pixel stripes) fades out
      .replace('#include <shadowmap_vertex>', `
        #ifdef GROOVE_FILTER
        worldPosition.y += ${(3.6 * S).toFixed(4)} * smoothstep(4.0, 7.5, length(worldPosition.xyz - cameraPosition));
        #endif
        #include <shadowmap_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN; uniform float uGrain, uRVar, uCell, uPix;
        float vh(ivec3 p){ uvec3 q = uvec3(p); uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ q.z * 2798796415u; h = (h ^ (h >> 16)) * 2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16; return float(h) / 4294967295.0; }
        float gN, gF, gFilt;
        #ifdef GROOVE_FILTER
        varying vec3 vBase;
        #endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vWP - vWN * uCell * 0.5;
          gN = vh(ivec3(floor(p / uCell)));
          float g2 = vh(ivec3(floor(p / (uCell * 3.0))) + ivec3(17));
          float dist = length(vWP - cameraPosition);
          gF = clamp(1.4 - dist / 9.0, 0.35, 1.0);
          gFilt = 0.0;
          #ifdef GROOVE_FILTER
          // pixel footprint vs the 15 cm groove period: blend toward the groove-free (pre-filtered) colour
          // footprint of one pixel on the ground plane (not on the face itself: groove risers face the camera)
          vec3 vd = vWP - cameraPosition;
          float fw = length(vd) * uPix / max(abs(vd.y) / length(vd), 0.04);
          gFilt = smoothstep(0.02, 0.05, fw);
          diffuseColor.rgb = mix(diffuseColor.rgb, vBase * 0.93, gFilt);
          #endif
          diffuseColor.rgb *= 1.0 + ((gN - 0.5) * uGrain + (g2 - 0.5) * uGrain * 0.6) * gF;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (gN - 0.5) * uRVar * 2.0 * gF, 0.05, 1.0);`)
      // and the average groove normal is simply 'up'
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef GROOVE_FILTER
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), gFilt));
        #endif`);
  };
  return m;
}

const sandMat = voxelMaterial({ grain: 0.22, rough: 0.92, roughVar: 0.08, filter: true });
const rockMat = voxelMaterial({ grain: 0.3, rough: 0.78, roughVar: 0.2 });
const wallMat = voxelMaterial({ grain: 0.18, rough: 0.95, roughVar: 0.05 });
const treeMat = voxelMaterial({ grain: 0.25, rough: 0.85, roughVar: 0.1, cell: S * 1.25 });
const rakeMat = voxelMaterial({ grain: 0.22, rough: 0.7, roughVar: 0.2, cell: S / 8 });

// ---------- garden grid ----------
const garden = new Garden();
const chunkMeshes = [];
for (let cz = 0; cz < NZ / CH; cz++) for (let cx = 0; cx < NX / CH; cx++) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), sandMat);
  m.castShadow = true; m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  chunkMeshes.push(m); scene.add(m);
}
function remesh() {
  for (let k = 0; k < chunkMeshes.length; k++) {
    if (!garden.dirty[k]) continue;
    garden.dirty[k] = 0;
    const cx = k % (NX / CH), cz = Math.floor(k / (NX / CH));
    const old = chunkMeshes[k].geometry;
    chunkMeshes[k].geometry = garden.meshChunk(cx, cz);
    old.dispose();
  }
}
remesh();

// ---------- props ----------
for (const r of ROCKS) {
  const m = new THREE.Mesh(buildRock(r, garden), rockMat);
  m.castShadow = m.receiveShadow = true; scene.add(m);
}
{
  const wg = buildWall();
  const m = new THREE.Mesh(wg, wallMat);
  m.castShadow = m.receiveShadow = true; scene.add(m);
  // same wall turned 90 degrees closes the left (sun) side; its foot sits on the outer soil
  const m2 = new THREE.Mesh(wg, wallMat);
  m2.rotation.y = Math.PI / 2;
  m2.position.set(xOf(22) - zOf(24) - 0.4, 0, 0);
  m2.castShadow = false; m2.receiveShadow = true; // would shade the whole garden at this sun angle
  scene.add(m2);
}
const trees = [
  { i: 60, j: -40, kind: 'pine', seed: 3 }, { i: 165, j: -52, kind: 'maple', seed: 7 },
  { i: 265, j: -36, kind: 'pine', seed: 11 }, { i: 345, j: -46, kind: 'pine', seed: 5 },
];
for (const t of trees) {
  const { geo } = buildTree(t.seed, t.kind);
  const m = new THREE.Mesh(geo, treeMat);
  m.position.set(xOf(t.i), (B + 2) * S, zOf(t.j));
  m.scale.setScalar(0.5);
  m.castShadow = m.receiveShadow = true; scene.add(m);
}
// ground beyond the grid (four slabs around it)
{
  const gm = voxelMaterial({ grain: 0.35, rough: 0.95, cell: S });
  const col = new THREE.Color(0.11, 0.1, 0.06);
  const y = (B + 2) * S;
  const gx = NX * S / 2, gz = NZ * S / 2, F = 60;
  const slabs = [[-gx - F / 2, 0, F, gz * 2 + F * 2], [gx + F / 2, 0, F, gz * 2 + F * 2], [0, -gz - F / 2, gx * 2, F], [0, gz + F / 2, gx * 2, F]];
  for (const [x, z, w, d] of slabs) {
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.Mesh(g, gm);
    m.position.set(x, y, z); m.receiveShadow = true; scene.add(m);
  }
}

// ---------- rake ----------
const rake = new THREE.Mesh(buildRake(), rakeMat);
rake.castShadow = rake.receiveShadow = true;
scene.add(rake);
const path = buildPath();
let simD = 0;
function advanceTo(t) {
  const target = Math.min(t * SPEED, path.total);
  while (simD < target) {
    simD = Math.min(target, simD + 0.35);
    const p = pathAt(path, simD);
    garden.stamp(p.i, p.j, p.dx, p.dz);
  }
  const p = pathAt(path, simD);
  rake.position.set(xOf(p.i), (B - 1) * S, zOf(p.j));
  rake.rotation.y = Math.atan2(p.dx, p.dz);
  remesh();
  return p;
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
function cinematic(t, p) {
  const rz = zOf(p.j);
  const k = (t - T0) / 6;
  camTarget.set(0.1 - k * 0.8, 0.22, rz * 0.62 - 1.2);
  camera.position.set(3.75 - k * 0.3, 1.22 + k * 0.1, 2.9 + rz * 0.62);
  camera.lookAt(camTarget);
  sun.target.position.set(0, 0, 0);
  sun.position.copy(sunDir).multiplyScalar(20);
}

let controls = null, autoCam = true;
if (!CAPTURE) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 1; controls.maxDistance = 16;
  renderer.domElement.addEventListener('pointerdown', () => {
    if (autoCam) { autoCam = false; controls.target.copy(camTarget); }
  });
}

// ---------- loop ----------
if (CAPTURE) {
  advanceTo(T0);
  window.renderFrame = (n) => new Promise((resolve) => {
    const t = T0 + n / FPS;
    const p = advanceTo(t);
    cinematic(t, p);
    renderer.render(scene, camera);
    requestAnimationFrame(() => resolve(true));
  });
  window.captureReady = true;
} else {
  let t = T0, paused = false, last = performance.now();
  const loopLen = path.total / SPEED + 4;
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyR') { garden.reset(); simD = 0; t = 0; }
    if (e.code === 'KeyC') { autoCam = !autoCam; if (!autoCam) controls.target.copy(camTarget); }
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    updatePix();
  });
  advanceTo(t);
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (!paused) t += dt;
    if (t > loopLen) { garden.reset(); simD = 0; t = 0; }
    const p = advanceTo(t);
    if (autoCam) {
      cinematic(T0 + 3 + Math.sin(t * 0.05) * 3, p); // framing that follows the rake
    } else controls.update();
    renderer.render(scene, camera);
  });
}
