// Bakes the low-poly swarm roach into a vertex animation: for each gait (a steady walk and a sprint) the rig is driven
// by the real RoachMotion at a constant speed, and its skinned vertices are sampled at GAIT_FRAMES poses over one
// gait cycle. The poses go into two float textures (positions and normals); the swarm shader picks and blends the
// rows by each roach's gait phase. Phase advances with distance travelled over the baked stride, so feet keep to the
// ground at any speed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RigDriver } from './rig.js';
import { RoachMotion } from './motion.js';
import { STEP_SECONDS } from './physics.js';
import { strideFor } from './walk.js';
import { normaliseModel } from './normalise-model.js';

export const GAIT_FRAMES = 12;
// Speeds in body lengths per second at which each gait is baked; `bipedal` is the walk layer's share of running on
// four legs with the front pair raised (0 = tripod walk).
const GAIT_SETS = [
  { name: 'walk', bipedal: 0, bodyLengthsPerSecond: 2.0 },
  { name: 'sprint', bipedal: 0.5, bodyLengthsPerSecond: 5.5 },
];
const SETTLE_CYCLES = 10;
const FOOT_ON_GROUND = 0.03;

const boneMatrix = new THREE.Matrix4();
const skinMatrix = new THREE.Matrix4();
const before = new THREE.Matrix4();
const after = new THREE.Matrix4();
const point = new THREE.Vector3();
const direction = new THREE.Vector3();

/** Average colour of a material's texture times its base colour, as a linear colour. */
function meanColor(material) {
  const color = material.color.clone();
  const image = material.map?.image;
  if (!image) return color;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, 8, 8);
  const pixels = context.getImageData(0, 0, 8, 8).data;
  const sum = [0, 0, 0];
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[index + channel] / 255;
  }
  const count = pixels.length / 4;
  const texture = new THREE.Color().setRGB(sum[0] / count, sum[1] / count, sum[2] / count, THREE.SRGBColorSpace);
  return color.multiply(texture);
}

/** One merged, unskinned geometry: indices, colours and a per-vertex index into the baked rows. */
function mergeMeshes(meshes) {
  const total = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const bakedIndex = new Float32Array(total);
  const indices = [];
  let offset = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const count = geometry.attributes.position.count;
    positions.set(geometry.attributes.position.array, offset * 3);
    normals.set(geometry.attributes.normal.array, offset * 3);
    const color = meanColor(mesh.material);
    for (let vertex = 0; vertex < count; vertex++) {
      colors.set([color.r, color.g, color.b], (offset + vertex) * 3);
      bakedIndex[offset + vertex] = offset + vertex;
    }
    const source = geometry.index ? geometry.index.array : [...Array(count).keys()];
    for (const index of source) indices.push(index + offset);
    offset += count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setAttribute('bakedIndex', new THREE.BufferAttribute(bakedIndex, 1));
  merged.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  return merged;
}

function blendSkinMatrix(mesh, vertex) {
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  const boneMatrices = mesh.skeleton.boneMatrices;
  skinMatrix.elements.fill(0);
  for (let influence = 0; influence < 4; influence++) {
    const weight = skinWeight.getComponent(vertex, influence);
    if (weight === 0) continue;
    boneMatrix.fromArray(boneMatrices, skinIndex.getComponent(vertex, influence) * 16);
    for (let element = 0; element < 16; element++) skinMatrix.elements[element] += weight * boneMatrix.elements[element];
  }
  return skinMatrix;
}

/** Skinned positions and normals of every mesh at the current rig pose, in the merged vertex order. */
function samplePose(meshes, positions, normals) {
  let offset = 0;
  for (const mesh of meshes) {
    mesh.skeleton.update();
    before.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
    after.copy(mesh.bindMatrix);
    const geometry = mesh.geometry;
    for (let vertex = 0; vertex < geometry.attributes.position.count; vertex++) {
      const skin = blendSkinMatrix(mesh, vertex);
      const full = new THREE.Matrix4().multiplyMatrices(before, skin).multiply(after);
      point.fromBufferAttribute(geometry.attributes.position, vertex).applyMatrix4(full);
      direction.fromBufferAttribute(geometry.attributes.normal, vertex).transformDirection(full);
      point.toArray(positions, (offset + vertex) * 3);
      direction.toArray(normals, (offset + vertex) * 3);
    }
    offset += geometry.attributes.position.count;
  }
}

/** Spreads the mismatch between the last and first pose across the cycle, so the loop closes exactly. */
function closeLoop(frames, vertexCount) {
  const first = frames[0];
  const last = frames[GAIT_FRAMES];
  let worst = 0;
  for (let component = 0; component < vertexCount * 3; component++) {
    const drift = last[component] - first[component];
    worst = Math.max(worst, Math.abs(drift));
    for (let frame = 1; frame < GAIT_FRAMES; frame++) {
      frames[frame][component] -= drift * (frame / GAIT_FRAMES);
    }
  }
  return worst;
}

/** Foot slide of the middle leg: speed of the planted foot against the body, as a share of the body's speed. */
function measureFootSlide(positionFrames, footRange, secondsPerFrame, bodySpeed) {
  const lowest = positionFrames.slice(0, GAIT_FRAMES).map((frame) => {
    let best = { height: Infinity, forward: 0 };
    for (let vertex = footRange.start; vertex < footRange.end; vertex++) {
      const height = frame[vertex * 3 + 1];
      if (height < best.height) best = { height, forward: frame[vertex * 3 + 2] };
    }
    return best;
  });
  const ratios = [];
  for (let frame = 0; frame < GAIT_FRAMES; frame++) {
    const next = lowest[(frame + 1) % GAIT_FRAMES];
    const current = lowest[frame];
    if (current.height > FOOT_ON_GROUND || next.height > FOOT_ON_GROUND) continue;
    ratios.push(-(next.forward - current.forward) / secondsPerFrame / bodySpeed);
  }
  ratios.sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
}

function bakeGait(driver, meshes, vertexCount, rigToScene, footRange, set) {
  const strideRig = strideFor(set.bipedal);
  const strideWorld = strideRig * rigToScene;
  const idealCycleSeconds = strideWorld / set.bodyLengthsPerSecond;
  // The cycle is a whole number of physics steps, so every sample lands on an exact gait phase.
  const stepsPerFrame = Math.max(1, Math.round(idealCycleSeconds / STEP_SECONDS / GAIT_FRAMES));
  const cycleSeconds = stepsPerFrame * GAIT_FRAMES * STEP_SECONDS;
  const speedRig = strideRig / cycleSeconds;
  const motion = new RoachMotion(driver, { seed: 1, plan: () => ({ speed: speedRig, bipedal: set.bipedal }) });
  const settleSteps = SETTLE_CYCLES * stepsPerFrame * GAIT_FRAMES;
  const positionFrames = [];
  const normalFrames = [];
  for (let frame = 0; frame <= GAIT_FRAMES; frame++) {
    motion.apply((settleSteps + frame * stepsPerFrame) * STEP_SECONDS);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    samplePose(meshes, positions, normals);
    positionFrames.push(positions);
    normalFrames.push(normals);
  }
  const loopError = closeLoop(positionFrames, vertexCount);
  closeLoop(normalFrames, vertexCount);
  const bodySpeed = speedRig * rigToScene;
  const footSlide = measureFootSlide(positionFrames, footRange, cycleSeconds / GAIT_FRAMES, bodySpeed);
  // The baked stance foot moves back faster than the body by the footSlide ratio. Playing the cycle slower by that
  // factor per distance travelled puts the planted foot's ground speed at zero.
  const groundStride = strideWorld * Math.max(footSlide ?? 1, 1);
  return {
    name: set.name,
    positionFrames,
    normalFrames,
    stride: strideWorld,
    groundStride,
    cycleSeconds,
    bakedSpeed: bodySpeed,
    loopError,
    footSlide,
  };
}

function toTexture(gaits, key, vertexCount) {
  const data = new Float32Array(vertexCount * GAIT_FRAMES * gaits.length * 4);
  gaits.forEach((gait, setIndex) => {
    for (let frame = 0; frame < GAIT_FRAMES; frame++) {
      const source = gait[key][frame];
      const row = setIndex * GAIT_FRAMES + frame;
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const target = (row * vertexCount + vertex) * 4;
        data[target] = source[vertex * 3];
        data[target + 1] = source[vertex * 3 + 1];
        data[target + 2] = source[vertex * 3 + 2];
      }
    }
  });
  const texture = new THREE.DataTexture(data, vertexCount, GAIT_FRAMES * gaits.length, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Loads the swarm model and bakes both gaits.
 * Returns the merged geometry, the pose textures and the gait numbers the simulation needs (world units, where the
 * body is 1 long): `walk` and `sprint` each have the stride, the speed they were baked at and the measured loop error.
 */
export async function bakeSwarmRoach(modelUrl = './models/roach-swarm.glb') {
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const root = gltf.scene;
  normaliseModel(root, 1);
  const meshes = [];
  root.traverse((node) => {
    if (node.isSkinnedMesh) meshes.push(node);
  });
  const driver = new RigDriver(root);
  const rigToScene = root.scale.x;
  const geometry = mergeMeshes(meshes);
  const vertexCount = geometry.attributes.position.count;
  let offset = 0;
  let footRange = null;
  for (const mesh of meshes) {
    const count = mesh.geometry.attributes.position.count;
    if (/L_midleg/.test(mesh.name)) footRange = { start: offset, end: offset + count };
    offset += count;
  }
  const gaits = GAIT_SETS.map((set) => bakeGait(driver, meshes, vertexCount, rigToScene, footRange, set));
  const triangles = geometry.index.count / 3;
  const walkFrame = gaits[0].positionFrames[0];
  for (let index = 0; index < vertexCount * 3; index++) geometry.attributes.position.array[index] = walkFrame[index];
  geometry.computeBoundingSphere();
  return {
    geometry,
    positionTexture: toTexture(gaits, 'positionFrames', vertexCount),
    normalTexture: toTexture(gaits, 'normalFrames', vertexCount),
    gaitFrames: GAIT_FRAMES,
    gaitCount: gaits.length,
    vertexCount,
    triangles,
    walk: gaits[0],
    sprint: gaits[1],
    report: gaits.map((gait) => ({
      name: gait.name,
      bakedStrideBodyLengths: Number(gait.stride.toFixed(3)),
      groundStrideBodyLengths: Number(gait.groundStride.toFixed(3)),
      cycleHz: Number((1 / gait.cycleSeconds).toFixed(2)),
      bakedBodyLengthsPerSecond: Number(gait.bakedSpeed.toFixed(2)),
      loopError: Number(gait.loopError.toFixed(4)),
      plantedFootSpeedOverBodySpeed: gait.footSlide === null ? null : Number(gait.footSlide.toFixed(2)),
    })),
  };
}
