// Sourced models: Poly Haven CC0 trees and shrub (decimated in Blender, see README), instanced across the forest,
// and the water buffalo made from the Quaternius CC0 cow with swept-back crescent horns added.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BLOCK, TERRACE, classify, heightAt, streamX, pads } from './terrainField.js';
import { createRandom } from './noise.js';

const loader = new GLTFLoader();

// Triangles stretched into rounded leaf patches: the corner of each triangle is cut away by its barycentric coordinates.
function patchLeafMaterial(material) {
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest = 0;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCorner;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        int cornerIndex = gl_VertexID - (gl_VertexID / 3) * 3;
        vCorner = vec3(cornerIndex == 0 ? 1.0 : 0.0, cornerIndex == 1 ? 1.0 : 0.0, cornerIndex == 2 ? 1.0 : 0.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCorner;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float leafShape = vCorner.x * vCorner.y * vCorner.z * 27.0;
        if (leafShape < 0.2) discard;`);
  };
  material.needsUpdate = true;
}

function bakeParts(scene) {
  scene.updateWorldMatrix(true, true);
  const parts = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    parts.push({ geometry, material: node.material });
  });
  const box = new THREE.Box3();
  parts.forEach((part) => { part.geometry.computeBoundingBox(); box.union(part.geometry.boundingBox); });
  const center = box.getCenter(new THREE.Vector3());
  parts.forEach((part) => part.geometry.translate(-center.x, -box.min.y, -center.z));
  return { parts, height: box.max.y - box.min.y };
}

async function loadModel(url, leafMatcher) {
  const gltf = await loader.loadAsync(url);
  const baked = bakeParts(gltf.scene);
  baked.parts.forEach((part) => {
    part.material.envMapIntensity = 1.0;
    if (leafMatcher && leafMatcher(part.material.name)) {
      part.isLeaf = true;
      patchLeafMaterial(part.material);
    }
  });
  return { ...baked, gltf };
}

export async function loadForestModels() {
  const [jacaranda, island, shrub, cow] = await Promise.all([
    loadModel('models/jacaranda.glb', (name) => name.includes('leaves')),
    loadModel('models/island_tree_02.glb', (name) => name.includes('leaves')),
    loadModel('models/shrub_02.glb', (name) => name.includes('shrub')),
    loader.loadAsync('models/cow_quaternius.glb'),
  ]);
  return { jacaranda, island, shrub, cow };
}

function addInstances(group, model, matrices, random, tintRange) {
  if (matrices.length === 0) return;
  model.parts.forEach((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
    matrices.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix);
      const lightness = tintRange[0] + random() * (tintRange[1] - tintRange[0]);
      const color = new THREE.Color(0.5 * lightness, 1.0 * lightness, 0.52 * lightness);
      color.r *= 1 + 0.2 * (random() - 0.4);
      color.b *= 1 - 0.1 * random();
      mesh.setColorAt(index, color);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
}

export function buildForestFromModels(models) {
  const random = createRandom(31337);
  const group = new THREE.Group();
  const jacarandaMatrices = [];
  const islandMatrices = [];
  const shrubMatrices = [];
  const spacing = 5.2;
  const compose = (x, z, targetHeight, model, sink) => {
    const scale = targetHeight / model.height;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, heightAt(x, z) - 0.2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((random() - 0.5) * 0.08, random() * Math.PI * 2, (random() - 0.5) * 0.08)),
      new THREE.Vector3(scale * (0.9 + random() * 0.25), scale, scale * (0.9 + random() * 0.25)),
    );
    sink.push(matrix);
  };
  for (let x = -BLOCK.halfX + 2.5; x < BLOCK.halfX - 2; x += spacing) {
    for (let z = -BLOCK.halfZ + 2.5; z < BLOCK.halfZ - 2; z += spacing) {
      const jitterX = x + (random() - 0.5) * spacing * 0.85;
      const jitterZ = z + (random() - 0.5) * spacing * 0.85;
      const info = classify(jitterX, jitterZ);
      if (info.kind !== 'forest') continue;
      if (Math.abs(jitterX - streamX(jitterZ)) < 3.4) continue;
      if (pads.some((pad) => Math.hypot(jitterX - pad.x, jitterZ - pad.z) < pad.outer + 1.8)) continue;
      const depthIntoForest = info.elevation - TERRACE.count * TERRACE.step;
      if (depthIntoForest < 0.8 && random() < 0.55) continue;
      if (random() < 0.62) compose(jitterX, jitterZ, 9 + random() * 7, models.jacaranda, jacarandaMatrices);
      else compose(jitterX, jitterZ, 5.5 + random() * 3.5, models.island, islandMatrices);
    }
  }
  for (let attempt = 0; attempt < 420; attempt += 1) {
    const x = (random() * 2 - 1) * (BLOCK.halfX - 1.5);
    const z = -BLOCK.halfZ + 1.5 + random() * 30;
    const info = classify(x, z);
    if (info.kind !== 'forest' || Math.abs(x - streamX(z)) < 2.6) continue;
    if (pads.some((pad) => Math.hypot(x - pad.x, z - pad.z) < pad.outer + 0.5)) continue;
    compose(x, z, 1.3 + random() * 1.5, models.shrub, shrubMatrices);
  }
  addInstances(group, models.jacaranda, jacarandaMatrices, random, [0.78, 1.05]);
  addInstances(group, models.island, islandMatrices, random, [0.78, 1.05]);
  addInstances(group, models.shrub, shrubMatrices, random, [0.7, 1.0]);
  return { group, count: jacarandaMatrices.length + islandMatrices.length + shrubMatrices.length };
}

// Dark water buffalo from the cow rig in its rest pose, horns swapped for long swept-back crescents.
export function buildWaterBuffalo(cowGltf) {
  const cow = cowGltf.scene;
  const coat = { Main: [0.09, 0.082, 0.074], Main_Light: [0.14, 0.126, 0.112], Muzzle: [0.19, 0.155, 0.155], Hooves: [0.035, 0.033, 0.033] };
  cow.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material, index) => {
      if (material.name === 'Horns') node.visible = false;
      if (coat[material.name]) {
        const copy = material.clone();
        copy.color.setRGB(...coat[material.name]);
        copy.roughness = 0.82;
        copy.metalness = 0;
        if (Array.isArray(node.material)) node.material[index] = copy;
        else node.material = copy;
      }
    });
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false;
  });
  cow.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(cow, true);
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z);
  const scale = 2.7 / length;
  const wrapper = new THREE.Group();
  wrapper.add(cow);
  cow.scale.multiplyScalar(scale);
  cow.updateWorldMatrix(true, true);
  const scaledBox = new THREE.Box3().setFromObject(cow, true);
  cow.position.y -= scaledBox.min.y;
  wrapper.updateWorldMatrix(true, true);

  let headBone = null;
  let headEnd = null;
  cow.traverse((node) => {
    if (node.name === 'Head') headBone = node;
    if (node.name === 'Head_end') headEnd = node;
  });
  if (headBone && headEnd) {
    const headPosition = wrapper.worldToLocal(headBone.getWorldPosition(new THREE.Vector3()));
    const noseDirection = wrapper.worldToLocal(headEnd.getWorldPosition(new THREE.Vector3())).sub(headPosition);
    const headLength = noseDirection.length();
    const forward = noseDirection.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(up, forward).normalize();
    const hornMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.45 });
    for (const sign of [-1, 1]) {
      const crescent = [
        [0.14, -0.02, 0.0], [0.45, -0.14, 0.03], [0.8, -0.34, 0.07], [1.08, -0.62, 0.14], [1.2, -0.95, 0.27], [1.1, -1.2, 0.45],
      ].map(([across, back, rise]) => headPosition.clone()
        .addScaledVector(side, sign * across * headLength)
        .addScaledVector(forward, back * headLength)
        .addScaledVector(up, rise * headLength));
      const curve = new THREE.CatmullRomCurve3(crescent);
      const geometry = new THREE.TubeGeometry(curve, 24, 0.13 * headLength, 8, false);
      const positions = geometry.attributes.position;
      const ring = 9;
      for (let index = 0; index < positions.count; index += 1) {
        const along = Math.floor(index / ring) / 24;
        const taper = 1 - 0.78 * along;
        const centre = curve.getPoint(Math.min(along, 1));
        const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
        vertex.sub(centre).multiplyScalar(taper).add(centre);
        positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
      geometry.computeVertexNormals();
      const horn = new THREE.Mesh(geometry, hornMaterial);
      horn.castShadow = true;
      wrapper.add(horn);
    }
  }
  return wrapper;
}
