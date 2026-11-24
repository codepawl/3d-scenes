// Roach Glow viewer: loads the cockroach, lights it for a rim glow, frames one of the named shots and poses the
// rig from the film clock. URL: ?shot=closeup|top|side|three-quarter|walk-side&plan=idle|walk&floor=1
// &cell=7&raw=1&model=static&t=0&live=1
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GlowAsciiPass, FONT_FAMILY } from './glow-ascii.js';
import { RigDriver } from './rig.js';
import { RoachMotion, STAND_STILL } from './motion.js';
import { PLANS } from './plans.js';
import { buildTileFloor } from './floor.js';
import { normaliseModel } from './normalise-model.js';
import { createSwarmShot } from './swarm-shot.js';
import { buildCreviceSlab, createRadiationBeat } from './story-scenes.js';

const parameters = new URLSearchParams(location.search);
const planName = parameters.get('plan') ?? 'idle';
const isSwarm = planName === 'swarm';
const canvas = document.querySelector('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 80);

// The roach travels inside this group; lights and the camera follow it.
const mover = new THREE.Group();
scene.add(mover);

// Key from above-front, a strong rim from behind for the glowing outline, a faint cool fill.
const keyLight = new THREE.DirectionalLight(0xfff1e0, 3.4);
keyLight.position.set(-0.7, 1.3, 2.8).multiplyScalar(3);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -6;
keyLight.shadow.camera.right = 6;
keyLight.shadow.camera.top = 6;
keyLight.shadow.camera.bottom = -6;
keyLight.shadow.camera.far = 30;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.radius = 4;
mover.add(keyLight, keyLight.target);
const rimLight = new THREE.DirectionalLight(0xffd6f0, 3.2);
rimLight.position.set(0.8, 1.2, -2.5);
mover.add(rimLight, rimLight.target);
const fillLight = new THREE.HemisphereLight(0x8a7cff, 0x120020, 0.35);
// A soft light from the camera so faces under the head shield do not go black.
const cameraFill = new THREE.DirectionalLight(0xffe4d0, 0.9);
camera.add(cameraFill);
cameraFill.target.position.set(0, 0, -1);
camera.add(cameraFill.target);
scene.add(camera, fillLight);

const showFloor = parameters.get('floor') === '1' || planName !== 'idle';
const floor = showFloor ? buildTileFloor() : null;
if (floor) {
  scene.add(floor);
  scene.fog = new THREE.Fog(0x000000, 12, 30);
  // A pool of light that travels with the roach, so the tiles glow around it and the ground reads as moving past.
  if (!isSwarm) {
    const poolLight = new THREE.PointLight(0xffe0c8, 30, 9, 1.6);
    poolLight.position.set(0.5, 3.2, 0.6);
    mover.add(poolLight);
  }
}

const glowPass = new GlowAsciiPass(renderer, { sweep: Number(parameters.get('sweep') ?? 0.8) });
glowPass.raw = parameters.get('raw') === '1';
const cellWidth = Number(parameters.get('cell') ?? 7);
const cellHeight = Math.round(cellWidth * 1.75);

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  glowPass.resize(width, height, cellWidth, cellHeight);
}

function headPosition(root) {
  const box = new THREE.Box3();
  root.traverse((node) => {
    if (node.isMesh && /Head/.test(node.name)) box.expandByObject(node);
  });
  return box.getCenter(new THREE.Vector3());
}

// Height of the squeeze crevice in scene units, set once the slab is built; the squeeze shot looks in at that level.
let creviceGap = 0.4;

// Camera positions relative to the roach's starting spot; `follow` shots move with it.
const SHOTS = {
  // A low 3/4 profile, behind the near antenna's line. The antennae are longer than any close-up camera distance,
  // so a camera in front of the head sits inside their sweep and they whip across the lens.
  closeup: (head) => ({ position: head.clone().add(new THREE.Vector3(3.1, -0.2, 1.3)), target: head.clone().add(new THREE.Vector3(0, -0.25, -0.05)), fov: 32 }),
  top: () => ({ position: new THREE.Vector3(0, 9, 0.001), target: new THREE.Vector3(0, 0, 0), fov: 30 }),
  side: () => ({ position: new THREE.Vector3(8, 0.6, 0), target: new THREE.Vector3(0, 0.45, 0), fov: 30 }),
  'three-quarter': () => ({ position: new THREE.Vector3(4.5, 3.2, 5), target: new THREE.Vector3(0, 0.3, 0), fov: 30 }),
  // Low side view that tracks the roach; slightly ahead so it runs into the frame's open side.
  // Low front 3/4 that tracks the roach as it comes at the lens. Far enough ahead that the antennae, which are
  // longer than the body, never reach the camera.
  'walk-front': () => ({ position: new THREE.Vector3(2.6, 1.6, 11.5), target: new THREE.Vector3(0, 0.45, 0.4), fov: 28, follow: true }),
  // Flight: tracking side and front views that rise with the roach, so the floor drops away under it.
  'fly-side': () => ({ position: new THREE.Vector3(12.5, 1.6, 1.2), target: new THREE.Vector3(0, 0.7, 0.8), fov: 30, follow: true }),
  'fly-front': () => ({ position: new THREE.Vector3(3.2, 2.2, 11.5), target: new THREE.Vector3(0, 0.7, 0.4), fov: 30, follow: true }),
  'walk-side': () => ({ position: new THREE.Vector3(13.5, 2.4, 0.9), target: new THREE.Vector3(0, 0.4, 0.6), fov: 30, follow: true }),
  // Squeeze: a tracking side view at the crevice's own height, so the lens sees in under the slab's edge.
  'squeeze-side': () => ({ position: new THREE.Vector3(11, creviceGap * 0.85, -0.2), target: new THREE.Vector3(0, creviceGap * 0.45, -0.3), fov: 30, follow: true }),
  // Headless: a still 3/4 view wide enough for the body and the spot on its left where the head lands.
  headless: () => ({ position: new THREE.Vector3(6.2, 2.7, 5.2), target: new THREE.Vector3(0.7, 0.35, 0.9), fov: 32 }),
  // Radiation: a still 3/4 view with room in front of the roach for the beetle.
  radiation: () => ({ position: new THREE.Vector3(6.4, 4.4, 10.2), target: new THREE.Vector3(-0.8, 0.6, 1.0), fov: 32 }),
  // The film cuts in to the beetle, with the dead roach's legs out of focus behind it.
  // The ending: a still, low camera down the path; the roach comes out of the fog and stops in front of the lens.
  approach: () => ({ position: new THREE.Vector3(0.9, 0.75, 13.5), target: new THREE.Vector3(0, 0.55, 8), fov: 30 }),
  // Specimen views: over 5 s the camera swings from straight above the roach down to a low side view.
  specimen: () => ({ path: specimenOrbit, fov: 30 }),
  'radiation-beetle': () => ({ position: new THREE.Vector3(-0.2, 0.75, 4.6), target: new THREE.Vector3(-1.45, 0.12, 2.25), fov: 30 }),
};

const SPECIMEN_TARGET = new THREE.Vector3(0, 0.4, 0);
function specimenOrbit(time) {
  const progress = THREE.MathUtils.smootherstep(time, 0, 5);
  const elevation = THREE.MathUtils.degToRad(89 - 83 * progress);
  const azimuth = THREE.MathUtils.degToRad(-20 + 110 * progress);
  const radius = 9 - 1.2 * progress;
  const position = new THREE.Vector3(
    radius * Math.cos(elevation) * Math.sin(azimuth),
    radius * Math.sin(elevation),
    radius * Math.cos(elevation) * Math.cos(azimuth),
  ).add(SPECIMEN_TARGET);
  return { position, target: SPECIMEN_TARGET.clone() };
}

let currentShot = null;
// Follow shots track the roach's path smoothed, not the roach itself, so its bobbing and drifting stay visible.
const cameraTrack = new THREE.Vector3();
function frameShot(name, head) {
  currentShot = (SHOTS[name] ?? SHOTS.closeup)(head);
  camera.fov = currentShot.fov;
  camera.updateProjectionMatrix();
  placeCamera(0);
}

function placeCamera(time) {
  if (currentShot.path) {
    const { position, target } = currentShot.path(time);
    camera.position.copy(position);
    camera.lookAt(target);
    return;
  }
  const offset = currentShot.follow ? cameraTrack : new THREE.Vector3();
  camera.position.copy(currentShot.position).add(offset);
  camera.lookAt(currentShot.target.clone().add(offset));
}

// Publishes the page API the tools drive, then renders the first frame (and runs the clock when live=1).
function publish(api, renderAt, startTime) {
  window.__roach = api;
  renderAt(startTime);
  window.__ready = true;
  if (parameters.get('live') === '1') {
    const startedAt = performance.now() - startTime * 1000;
    const loop = () => { renderAt((performance.now() - startedAt) / 1000); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

// The swarm plan has no single roach: a baked, instanced crowd and a flashlight instead.
async function startSwarm() {
  await document.fonts.load(`700 50px ${FONT_FAMILY}`);
  const shot = await createSwarmShot({ scene, camera, parameters, lights: { keyLight, rimLight, fillLight, cameraFill } });
  resize();
  floor.position.z = 0;
  glowPass.material.uniforms.uFloorGlow.value = 3;
  shot.frame(parameters.get('shot') ?? 'swarm-top');
  let filmTime = Number(parameters.get('t') ?? 0);
  const renderAt = (time) => {
    filmTime = time;
    shot.update(time);
    glowPass.render(scene, camera, floor);
  };
  window.addEventListener('resize', () => { resize(); renderAt(filmTime); });
  const api = {
    render: () => renderAt(filmTime),
    setTime: renderAt,
    setShot: (name) => { shot.frame(name); renderAt(filmTime); },
    setRaw: (raw) => { glowPass.raw = raw; renderAt(filmTime); },
    swarmEvents: (time) => shot.eventsUntil(time),
    swarmSimulation: () => shot.simulation,
    bakeReport: () => ({ vertices: shot.baked.vertexCount, triangles: shot.baked.triangles, gaits: shot.baked.report }),
    benchmark: (frames) => benchmarkSwarm(shot, renderAt, frames),
  };
  publish(api, renderAt, filmTime);
}

// Average milliseconds per frame of the simulation step and of the full render, stepping the film clock by 1/30 s.
function benchmarkSwarm(shot, renderAt, frames) {
  const gl = renderer.getContext();
  const syncPixel = new Uint8Array(4);
  let simulationMilliseconds = 0;
  let renderMilliseconds = 0;
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / 30;
    const simulationStart = performance.now();
    shot.simulation.advanceTo(time);
    simulationMilliseconds += performance.now() - simulationStart;
    const renderStart = performance.now();
    renderAt(time);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
    renderMilliseconds += performance.now() - renderStart;
  }
  return { count: shot.simulation.count, frames, simulationMilliseconds: simulationMilliseconds / frames, renderMilliseconds: renderMilliseconds / frames };
}

// The crevice is as tall as the roach's flattened body: pose it fully compressed, measure the body, then reset.
function addCreviceSlab(roach, motion, rigToScene) {
  motion.apply(5);
  roach.updateMatrixWorld(true);
  const flattenedBody = new THREE.Box3();
  roach.traverse((node) => {
    if (!node.isSkinnedMesh || !/Body|Head/.test(node.name)) return;
    node.computeBoundingBox();
    flattenedBody.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  motion.apply(0);
  creviceGap = flattenedBody.max.y * 1.06;
  scene.add(buildCreviceSlab(rigToScene, creviceGap));
  console.log(`crevice gap ${creviceGap.toFixed(3)} scene units`);
}

async function start() {
  await document.fonts.load(`700 50px ${FONT_FAMILY}`);
  if (isSwarm) return startSwarm();
  const rigged = parameters.get('model') !== 'static';
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(rigged ? './models/roach-rigged.glb' : './models/roach.glb');
  const roach = gltf.scene;
  // Matte shells: glossy highlights blow out to white and skip the gradient, so light falls off smoothly instead.
  roach.traverse((node) => {
    if (!node.isMesh) return;
    node.material.roughness = Math.max(node.material.roughness ?? 1, 0.7);
    node.material.metalness = 0;
    // The wings ship as blended transparency, which writes no depth, so the glyph pass saw them as empty space.
    // An alpha cutout keeps their shape and puts them in the depth buffer.
    if (node.material.transparent) {
      node.material.transparent = false;
      node.material.alphaTest = 0.35;
      node.material.depthWrite = true;
    }
    node.castShadow = true;
    node.frustumCulled = false;
  });
  normaliseModel(roach);
  mover.add(roach);
  resize();
  const head = headPosition(roach);
  frameShot(parameters.get('shot') ?? 'closeup', head);

  const plan = PLANS[planName] ?? STAND_STILL;
  const motion = rigged ? new RoachMotion(new RigDriver(roach), { seed: Number(parameters.get('seed') ?? 1), plan }) : null;
  const rigToScene = roach.scale.x;
  if (planName === 'squeeze') addCreviceSlab(roach, motion, rigToScene);
  const radiation = planName === 'radiation' ? await createRadiationBeat({ roach, mover, glowPass, loader }) : null;
  let filmTime = Number(parameters.get('t') ?? 0);
  const renderAt = (time) => {
    filmTime = time;
    radiation?.update(time);
    if (motion) {
      motion.apply(time);
      mover.position.z = motion.distance * rigToScene;
      mover.position.y = motion.altitude * rigToScene;
      mover.position.x = motion.drift * rigToScene;
      cameraTrack.set(0, motion.trackAltitude * rigToScene, mover.position.z);
    }
    placeCamera(time);
    glowPass.render(scene, camera, floor);
  };
  window.addEventListener('resize', () => { resize(); renderAt(filmTime); });
  const api = {
    render: () => renderAt(filmTime),
    setTime: (time) => renderAt(time),
    setShot: (name) => { frameShot(name, head); renderAt(filmTime); },
    setRaw: (raw) => { glowPass.raw = raw; renderAt(filmTime); },
    nodeNames: () => { const names = []; roach.traverse((node) => names.push(node.name)); return names; },
    motion: () => motion,
    events: (time) => {
      const beatCues = (radiation?.cues ?? []).filter((cue) => cue.time <= time);
      return [...motion.eventsUntil(time), ...beatCues].sort((first, second) => first.time - second.time);
    },
  };
  publish(api, renderAt, filmTime);
}

start().catch((error) => { window.__error = String(error?.stack ?? error); console.error(error); });
