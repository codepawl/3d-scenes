// Rice clumps in rows that follow each paddy, grass tufts on bunds and risers, and the forest cap.
import * as THREE from 'three';
import { BLOCK, TERRACE, classify, heightAt, bandDensity, elevationField, streamX, pads } from './terrainField.js';
import { createRandom, fractalNoise } from './noise.js';
import { buildTaperedTube, mergeGeometries, mergeVertices, paintGeometry } from './geometryUtils.js';
import { makeCanvasTexture } from './materials.js';

function solveZ(x, level, guessLow = -BLOCK.halfZ - 15, guessHigh = BLOCK.halfZ + 15) {
  let low = guessLow;
  let high = guessHigh;
  for (let iteration = 0; iteration < 34; iteration += 1) {
    const mid = (low + high) / 2;
    if (elevationField(x, mid) / TERRACE.step > level) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// A clump of leaning, tapering blades. Blade height is normalised to 1; the material scales it by season.
function buildClumpGeometry(blades, seed) {
  const random = createRandom(seed);
  const rows = 3;
  const positions = [];
  const lean = [];
  const heightFractions = [];
  const indices = [];
  for (let blade = 0; blade < blades; blade += 1) {
    const azimuth = random() * Math.PI * 2;
    const baseRadius = random() * 0.045;
    const baseX = Math.cos(azimuth) * baseRadius;
    const baseZ = Math.sin(azimuth) * baseRadius;
    const outward = 0.05 + random() * 0.17;
    const length = 0.8 + random() * 0.35;
    const width = 0.032 + random() * 0.012;
    const facing = random() * Math.PI;
    const start = positions.length / 3;
    for (let row = 0; row <= rows; row += 1) {
      const t = row / rows;
      const bendOut = outward * t * t * 1.2;
      const x = baseX + Math.cos(azimuth) * bendOut;
      const z = baseZ + Math.sin(azimuth) * bendOut;
      const y = t * length * (1 - 0.12 * t);
      const half = width * (1 - t * 0.92);
      for (const side of [-1, 1]) {
        positions.push(x + Math.cos(facing) * half * side, y, z + Math.sin(facing) * half * side);
        lean.push(Math.cos(azimuth), Math.sin(azimuth));
        heightFractions.push(t);
      }
      if (row < rows) {
        const a = start + row * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('leanDirection', new THREE.Float32BufferAttribute(lean, 2));
  geometry.setAttribute('bladeFraction', new THREE.Float32BufferAttribute(heightFractions, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Normals pointing up-ish give blades soft, even lighting instead of flat-sided shading.
  const normals = geometry.attributes.normal;
  for (let index = 0; index < normals.count; index += 1) {
    const vertex = new THREE.Vector3().fromBufferAttribute(normals, index);
    vertex.y = Math.abs(vertex.y) * 0.4 + 0.75;
    vertex.normalize();
    normals.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  return geometry;
}

const BLADE_VERTEX_HEAD = `
  attribute vec2 leanDirection; attribute float bladeFraction; attribute float instanceSeed;
  uniform float uSeason; uniform float uTime; uniform float uHeightScale; uniform float uBladeKind;
  varying float vFraction; varying float vSeed;`;

function createBladeMaterial(kind) {
  const uniforms = {
    uSeason: { value: 0 }, uTime: { value: 0 }, uHeightScale: { value: 1 }, uBladeKind: { value: kind === 'rice' ? 0 : 1 },
    uDry: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${BLADE_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFraction = bladeFraction;
        vSeed = instanceSeed;
        float riceHeight = mix(mix(0.2, 1.0, clamp(uSeason, 0.0, 1.0)), 1.12, clamp(uSeason - 1.0, 0.0, 1.0));
        float height = (uBladeKind < 0.5 ? riceHeight : uHeightScale) * (0.82 + 0.36 * instanceSeed);
        float spread = 0.6 + 0.4 * height;
        transformed.xz *= spread;
        transformed.y *= height;
        float droop = uBladeKind < 0.5 ? clamp(uSeason - 1.0, 0.0, 1.0) * 0.5 : 0.0;
        transformed.xz += leanDirection * droop * bladeFraction * bladeFraction * height;
        transformed.y -= droop * bladeFraction * bladeFraction * height * 0.35;
        vec3 clumpOrigin = instanceMatrix[3].xyz;
        float wind = sin(uTime * 1.6 + clumpOrigin.x * 0.35 + clumpOrigin.z * 0.22) + 0.5 * sin(uTime * 2.7 + clumpOrigin.z * 0.8);
        transformed.x += wind * 0.045 * bladeFraction * bladeFraction * height;
        transformed.z += wind * 0.02 * bladeFraction * bladeFraction * height;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSeason; uniform float uBladeKind; uniform float uDry; varying float vFraction; varying float vSeed;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 seedlingBase = vec3(0.10, 0.20, 0.04); vec3 seedlingTip = vec3(0.34, 0.50, 0.14);
        vec3 greenBase = vec3(0.05, 0.14, 0.02); vec3 greenTip = vec3(0.20, 0.40, 0.07);
        vec3 goldBase = vec3(0.26, 0.15, 0.025); vec3 goldTip = vec3(0.80, 0.50, 0.09);
        float toGreen = clamp(uSeason, 0.0, 1.0);
        float toGold = clamp(uSeason - 1.0, 0.0, 1.0);
        vec3 baseColor = mix(mix(seedlingBase, greenBase, toGreen), goldBase, toGold);
        vec3 tipColor = mix(mix(seedlingTip, greenTip, toGreen), goldTip, toGold);
        vec3 bladeColor = mix(baseColor, tipColor, smoothstep(0.0, 0.9, vFraction));
        if (uBladeKind > 0.5) {
          bladeColor = mix(vec3(0.06, 0.15, 0.03), vec3(0.28, 0.42, 0.10), smoothstep(0.0, 1.0, vFraction));
          bladeColor = mix(bladeColor, mix(vec3(0.22, 0.16, 0.05), vec3(0.62, 0.48, 0.18), vFraction), uDry);
        }
        bladeColor *= 0.82 + 0.36 * vSeed;
        diffuseColor.rgb = bladeColor;`);
  };
  return { material, uniforms };
}

function buildInstanced(geometry, matrices, seeds, material, shadows = true) {
  const instanceSeed = new THREE.InstancedBufferAttribute(Float32Array.from(seeds), 1);
  geometry.setAttribute('instanceSeed', instanceSeed);
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = shadows;
  mesh.frustumCulled = false;
  return mesh;
}

export function buildRice(hayPoints) {
  const random = createRandom(4242);
  const matrices = [];
  const seeds = [];
  const rowSpacing = 0.5;
  const clumpSpacing = 0.3;
  const dummy = new THREE.Object3D();
  for (let level = 1; level < TERRACE.count; level += 1) {
    for (let row = 0; row < 34; row += 1) {
      const distanceFromBund = TERRACE.bundWidth + 0.55 + row * rowSpacing;
      let x = -BLOCK.halfX + 0.8;
      let z = solveZ(x, level + 0.5);
      while (x < BLOCK.halfX - 0.8) {
        const density = bandDensity(x, z);
        const fraction = distanceFromBund * density;
        const newZ = solveZ(x, level + fraction);
        z = newZ;
        const info = classify(x, z);
        const nearEdge = Math.min(BLOCK.halfX - Math.abs(x), BLOCK.halfZ - Math.abs(z));
        const nearHay = false; // stacks sit on top of the standing rice, so no bare patches show in green season
        if (info.k === level && info.kind === 'shelf' && info.f < 1 - TERRACE.riserFraction - 0.55 * density * 0.1 && nearEdge > 0.9 && !nearHay) {
          const jitterX = (random() - 0.5) * 0.06;
          const jitterZ = (random() - 0.5) * 0.06;
          dummy.position.set(x + jitterX, heightAt(x, z) - 0.02, z + jitterZ);
          dummy.rotation.set(0, random() * Math.PI * 2, 0);
          const scale = 0.9 + random() * 0.3;
          dummy.scale.set(scale, 1, scale);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
          seeds.push(random());
        }
        // Step along the contour by arc length: the contour tilts by the local gradient.
        const slopeAlong = (elevationField(x + 0.2, z) - elevationField(x - 0.2, z)) / 0.4;
        const slopeAcross = (elevationField(x, z + 0.2) - elevationField(x, z - 0.2)) / 0.4;
        const contourSlope = -slopeAlong / (slopeAcross || 1e-4);
        x += clumpSpacing / Math.sqrt(1 + contourSlope * contourSlope);
      }
    }
  }
  const geometry = buildClumpGeometry(10, 8);
  const { material, uniforms } = createBladeMaterial('rice');
  const mesh = buildInstanced(geometry, matrices, seeds, material);
  return { mesh, uniforms, count: matrices.length };
}

export function buildGrassTufts() {
  const random = createRandom(909);
  const matrices = [];
  const seeds = [];
  const dummy = new THREE.Object3D();
  const attempts = 140000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const x = (random() * 2 - 1) * (BLOCK.halfX - 0.4);
    const z = (random() * 2 - 1) * (BLOCK.halfZ - 0.4);
    const info = classify(x, z);
    if (info.kind === 'shelf') continue;
    if (info.kind === 'forest' && random() > 0.16) continue;
    if (info.kind === 'bund' && random() > 0.8) continue;
    if (info.kind === 'riser' && random() > 0.45) continue;
    dummy.position.set(x, heightAt(x, z) - 0.03, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    const scale = 0.7 + random() * 0.7;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    seeds.push(random());
  }
  const geometry = buildClumpGeometry(9, 21);
  const { material, uniforms } = createBladeMaterial('grass');
  uniforms.uHeightScale.value = 0.38;
  const mesh = buildInstanced(geometry, matrices, seeds, material);
  return { mesh, uniforms, count: matrices.length };
}

function buildTreeGeometry(seed, tall) {
  const random = createRandom(seed);
  const parts = [];
  const trunkHeight = (tall ? 2.8 : 2.0) + random() * 1.0;
  const trunkPoints = [];
  for (let index = 0; index <= 5; index += 1) {
    const t = index / 5;
    trunkPoints.push(new THREE.Vector3(Math.sin(t * 3 + seed) * 0.14, t * trunkHeight, Math.cos(t * 2.4 + seed) * 0.12));
  }
  parts.push(paintGeometry(buildTaperedTube(trunkPoints, (t) => 0.2 * (1 - t * 0.6), 7), 0x4a3a2a));
  const blobCount = tall ? 6 : 5;
  for (let blob = 0; blob < blobCount; blob += 1) {
    const radius = (tall ? 1.5 : 1.8) * (0.7 + random() * 0.55);
    let blobGeometry = new THREE.IcosahedronGeometry(radius, 3);
    blobGeometry.deleteAttribute('uv');
    blobGeometry.deleteAttribute('normal');
    blobGeometry = mergeVertices(blobGeometry, 1e-4);
    const positions = blobGeometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
      const bump = 1 + 0.32 * fractalNoise(vertex.x * 1.7 + seed + blob, vertex.y * 1.7 + vertex.z * 1.3, 3, 13);
      vertex.multiplyScalar(bump);
      vertex.y *= 0.78;
      positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    blobGeometry.computeVertexNormals();
    const blobUv = new Float32Array(positions.count * 2);
    for (let index = 0; index < positions.count; index += 1) {
      blobUv[index * 2] = positions.getX(index) * 0.6 + positions.getZ(index) * 0.3;
      blobUv[index * 2 + 1] = positions.getY(index) * 0.6 + positions.getZ(index) * 0.3;
    }
    blobGeometry.setAttribute('uv', new THREE.BufferAttribute(blobUv, 2));
    const angle = random() * Math.PI * 2;
    const spread = blob === 0 ? 0 : 0.9 + random() * 0.9;
    blobGeometry.translate(Math.cos(angle) * spread, trunkHeight + (blob === 0 ? 1.1 : 0.2 + random() * 1.5), Math.sin(angle) * spread);
    const shade = 0.75 + random() * 0.5;
    parts.push(paintGeometry(blobGeometry, new THREE.Color(0.1 * shade, 0.27 * shade, 0.07 * shade)));
  }
  return mergeGeometries(parts);
}

export function buildForest() {
  const random = createRandom(31337);
  const leafTexture = makeCanvasTexture(512, (context, size) => {
    context.fillStyle = '#9a9a9a';
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 5200; index += 1) {
      const light = 90 + Math.floor(random() * 150);
      context.fillStyle = `rgb(${light},${light},${light})`;
      context.beginPath();
      context.ellipse(random() * size, random() * size, 2 + random() * 5, 1 + random() * 3, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
  });
  leafTexture.repeat.set(3, 3);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, bumpMap: leafTexture, bumpScale: 2.0, map: leafTexture });
  const variants = [buildTreeGeometry(3, true), buildTreeGeometry(11, false), buildTreeGeometry(23, true)];
  const buckets = variants.map(() => []);
  const spacing = 2.5;
  for (let x = -BLOCK.halfX + 1.5; x < BLOCK.halfX - 1; x += spacing) {
    for (let z = -BLOCK.halfZ + 1.5; z < BLOCK.halfZ - 1; z += spacing) {
      const jitterX = x + (random() - 0.5) * spacing * 0.9;
      const jitterZ = z + (random() - 0.5) * spacing * 0.9;
      const info = classify(jitterX, jitterZ);
      if (info.kind !== 'forest') continue;
      if (Math.abs(jitterX - streamX(jitterZ)) < 2.6) continue;
      if (pads.some((pad) => Math.hypot(jitterX - pad.x, jitterZ - pad.z) < pad.outer + 1.0)) continue;
      const depthIntoForest = info.elevation - TERRACE.count * TERRACE.step;
      if (depthIntoForest < 0.5 && random() < 0.5) continue;
      const matrix = new THREE.Matrix4();
      const scale = 0.75 + random() * 0.8;
      matrix.compose(
        new THREE.Vector3(jitterX, heightAt(jitterX, jitterZ) - 0.15, jitterZ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0)),
        new THREE.Vector3(scale, scale * (0.9 + random() * 0.4), scale),
      );
      buckets[Math.floor(random() * variants.length)].push(matrix);
    }
  }
  const group = new THREE.Group();
  let count = 0;
  variants.forEach((geometry, index) => {
    if (buckets[index].length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, buckets[index].length);
    buckets[index].forEach((matrix, instance) => {
      mesh.setMatrixAt(instance, matrix);
      mesh.setColorAt(instance, new THREE.Color().setHSL(0.24 + random() * 0.06, 0.2, 0.88 + random() * 0.2));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    count += buckets[index].length;
  });
  return { group, count };
}
