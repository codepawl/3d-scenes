// Terrain surface (four scanned materials blended per vertex), the soil-layer cut sides, roots and stones.
import * as THREE from 'three';
import { BLOCK, TERRACE, classify, heightAt, streamX } from './terrainField.js';
import { fractalNoise, smoothstep, createRandom } from './noise.js';
import { tiledMaterial } from './materials.js';
import { buildTaperedTube, mergeGeometries } from './geometryUtils.js';

const CELL = 0.16;

function buildSurfaceGeometry() {
  const columns = Math.round((BLOCK.halfX * 2) / CELL) + 1;
  const rows = Math.round((BLOCK.halfZ * 2) / CELL) + 1;
  const heights = new Float32Array(columns * rows);
  const splat = new Float32Array(columns * rows * 4);
  const positions = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const x = -BLOCK.halfX + column * CELL;
      const z = -BLOCK.halfZ + row * CELL;
      heights[index] = heightAt(x, z);
      positions[index * 3] = x;
      positions[index * 3 + 1] = heights[index];
      positions[index * 3 + 2] = z;
      uvs[index * 2] = x * 0.4;
      uvs[index * 2 + 1] = z * 0.4;
    }
  }

  const normals = new Float32Array(columns * rows * 3);
  const occlusion = new Float32Array(columns * rows);
  const ringOffsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  const sampleHeight = (column, row) => heights[Math.min(Math.max(Math.round(row), 0), rows - 1) * columns + Math.min(Math.max(Math.round(column), 0), columns - 1)];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const slopeX = (sampleHeight(column + 1, row) - sampleHeight(column - 1, row)) / (2 * CELL);
      const slopeZ = (sampleHeight(column, row + 1) - sampleHeight(column, row - 1)) / (2 * CELL);
      const length = Math.hypot(slopeX, 1, slopeZ);
      normals[index * 3] = -slopeX / length;
      normals[index * 3 + 1] = 1 / length;
      normals[index * 3 + 2] = -slopeZ / length;

      let nearLift = 0;
      let farLift = 0;
      for (const [offsetX, offsetZ] of ringOffsets) {
        nearLift += Math.max(sampleHeight(column + offsetX * 7, row + offsetZ * 7) - heights[index], 0);
        farLift += Math.max(sampleHeight(column + offsetX * 22, row + offsetZ * 22) - heights[index], 0);
      }
      occlusion[index] = 1 - Math.min(nearLift / 8 * 0.55 + farLift / 8 * 0.1, 0.72);

      const x = -BLOCK.halfX + column * CELL;
      const z = -BLOCK.halfZ + row * CELL;
      const info = classify(x, z);
      const steepness = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
      const patch = fractalNoise(x * 0.5, z * 0.5, 3, 11) * 0.5 + 0.5;
      let mud = 0;
      let grass = 0;
      let forest = 0;
      let rock = 0;
      if (info.kind === 'forest') {
        rock = smoothstep(0.9, 1.6, steepness);
        forest = 1 - rock;
        grass = forest * 0.55 * patch;
        forest -= grass;
        const lateral = Math.abs(x - streamX(z));
        if (lateral < 1.5) {
          rock = Math.max(rock, 0.75 * smoothstep(1.5, 0.6, lateral));
          forest = 1 - rock;
        }
      } else if (info.kind === 'shelf') {
        const nearBund = smoothstep(TERRACE.bundWidth + 0.9, TERRACE.bundWidth, info.distance);
        grass = nearBund * 0.45 * patch;
        mud = 1 - grass;
      } else if (info.kind === 'bund') {
        grass = 0.8 + 0.2 * patch;
        mud = 1 - grass;
      } else {
        const exposed = smoothstep(0.35, 0.8, patch) * 0.55 + smoothstep(1.1, 1.6, steepness) * 0.3;
        grass = 1 - exposed;
        mud = exposed;
      }
      splat[index * 4] = mud;
      splat[index * 4 + 1] = grass;
      splat[index * 4 + 2] = forest;
      splat[index * 4 + 3] = rock;
    }
  }

  const indexCount = (columns - 1) * (rows - 1) * 6;
  const indices = new Uint32Array(indexCount);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = b;
      indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute('bakedOcclusion', new THREE.BufferAttribute(occlusion, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, heights, columns, rows };
}

function buildSurfaceMaterial(textures) {
  const uniforms = {
    tMud: { value: textures.mud.diffuse },
    tGrass: { value: textures.grass.diffuse },
    tForest: { value: textures.forest.diffuse },
    tRock: { value: textures.rock.diffuse },
    nMud: { value: textures.mud.normal },
    nGrass: { value: textures.grass.normal },
    nForest: { value: textures.forest.normal },
    nRock: { value: textures.rock.normal },
    uDry: { value: 0 },
    uWet: { value: 1 },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, normalMap: textures.mud.normal, normalScale: new THREE.Vector2(1.1, 1.1) });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat;
        attribute float bakedOcclusion;
        varying vec4 vSplat;
        varying float vOcclusion;
        varying vec2 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat;
        vOcclusion = bakedOcclusion;
        vLocal = position.xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tMud; uniform sampler2D tGrass; uniform sampler2D tForest; uniform sampler2D tRock;
        uniform sampler2D nMud; uniform sampler2D nGrass; uniform sampler2D nForest; uniform sampler2D nRock;
        uniform float uDry; uniform float uWet;
        varying vec4 vSplat; varying float vOcclusion; varying vec2 vLocal;
        vec3 layerColor(sampler2D map, vec2 p, float scale) {
          vec3 near = texture2D(map, p * scale).rgb;
          vec3 far = texture2D(map, p * scale * 0.19 + vec2(0.31, 0.57)).rgb;
          float broad = dot(far, vec3(0.33));
          return near * (0.6 + 0.9 * broad);
        }
        vec3 layerNormal(sampler2D map, vec2 p, float scale) {
          vec3 near = texture2D(map, p * scale).xyz * 2.0 - 1.0;
          vec3 far = texture2D(map, p * scale * 0.19 + vec2(0.31, 0.57)).xyz * 2.0 - 1.0;
          return normalize(vec3(near.xy + far.xy * 0.5, near.z));
        }`)
      .replace('#include <map_fragment>', `
        vec4 weights = vSplat / max(dot(vSplat, vec4(1.0)), 0.0001);
        vec3 mudColor = layerColor(tMud, vLocal, 0.42) * mix(vec3(1.0), vec3(0.62, 0.58, 0.55), uWet);
        vec3 grassColor = layerColor(tGrass, vLocal, 0.33);
        grassColor = mix(grassColor * vec3(0.55, 0.95, 0.4), grassColor * vec3(1.45, 1.15, 0.5) + vec3(0.03, 0.02, 0.0), uDry);
        vec3 forestColor = layerColor(tForest, vLocal, 0.3) * vec3(0.55, 0.62, 0.42);
        vec3 rockColor = layerColor(tRock, vLocal, 0.22);
        diffuseColor.rgb = (mudColor * weights.x + grassColor * weights.y + forestColor * weights.z + rockColor * weights.w);
        diffuseColor.rgb *= mix(0.35, 1.0, vOcclusion);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = layerNormal(nMud, vLocal, 0.42) * weights.x + layerNormal(nGrass, vLocal, 0.33) * weights.y
          + layerNormal(nForest, vLocal, 0.3) * weights.z + layerNormal(nRock, vLocal, 0.22) * weights.w;
        mapN = normalize(mapN);
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vOcclusion;`);
  };
  return { material, uniforms };
}

function buildWalls(textures) {
  const random = createRandom(77);
  const edges = [
    { from: [-BLOCK.halfX, -BLOCK.halfZ], to: [BLOCK.halfX, -BLOCK.halfZ], normal: [0, -1] },
    { from: [BLOCK.halfX, -BLOCK.halfZ], to: [BLOCK.halfX, BLOCK.halfZ], normal: [1, 0] },
    { from: [BLOCK.halfX, BLOCK.halfZ], to: [-BLOCK.halfX, BLOCK.halfZ], normal: [0, 1] },
    { from: [-BLOCK.halfX, BLOCK.halfZ], to: [-BLOCK.halfX, -BLOCK.halfZ], normal: [-1, 0] },
  ];
  const layers = [
    { name: 'topsoil', set: textures.mud, tile: 2.8 },
    { name: 'subsoil', set: textures.laterite, tile: 3.4 },
    { name: 'rock', set: textures.rock, tile: 3.0 },
  ];
  const buffers = layers.map(() => ({ positions: [], normals: [], uvs: [], indices: [] }));
  const rootAnchors = [];
  let alongOffset = 0;
  for (const edge of edges) {
    const length = Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]);
    const count = Math.round(length / CELL);
    const startVertex = buffers.map((buffer) => buffer.positions.length / 3);
    for (let step = 0; step <= count; step += 1) {
      const t = step / count;
      const x = edge.from[0] + (edge.to[0] - edge.from[0]) * t;
      const z = edge.from[1] + (edge.to[1] - edge.from[1]) * t;
      const along = alongOffset + t * length;
      const top = heightAt(x, z);
      const topsoilDepth = 1.0 + 0.5 * fractalNoise(along * 0.12, 3, 3, 3) + 0.12 * fractalNoise(along * 1.4, 1, 2, 4);
      const subsoilDepth = 4.6 + 1.5 * fractalNoise(along * 0.06, 8, 3, 5) + 0.18 * fractalNoise(along * 1.1, 2, 2, 6);
      const boundaryOne = Math.max(top - topsoilDepth, BLOCK.bottomY + 0.3);
      const boundaryTwo = Math.max(Math.min(top - subsoilDepth, boundaryOne - 0.15), BLOCK.bottomY + 0.1);
      const levels = [
        [top, boundaryOne],
        [boundaryOne, boundaryTwo],
        [boundaryTwo, BLOCK.bottomY],
      ];
      layers.forEach((layer, layerIndex) => {
        const buffer = buffers[layerIndex];
        const [upper, lower] = levels[layerIndex];
        const tile = layer.tile;
        buffer.positions.push(x, upper, z, x, lower, z);
        buffer.normals.push(edge.normal[0], 0, edge.normal[1], edge.normal[0], 0, edge.normal[1]);
        buffer.uvs.push(along / tile, upper / tile, along / tile, lower / tile);
      });
      if (step % 9 === 0) rootAnchors.push({ x, z, top, edge });
    }
    layers.forEach((layer, layerIndex) => {
      const buffer = buffers[layerIndex];
      for (let step = 0; step < count; step += 1) {
        const a = startVertex[layerIndex] + step * 2;
        const flip = edge.normal[0] + edge.normal[1] > 0 ? 1 : -1;
        if (flip > 0) buffer.indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        else buffer.indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
      }
    });
    alongOffset += length;
  }
  const group = new THREE.Group();
  layers.forEach((layer, layerIndex) => {
    const buffer = buffers[layerIndex];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffer.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffer.uvs, 2));
    geometry.setIndex(buffer.indices);
    const material = tiledMaterial(layer.set, 1, { roughness: 1, side: THREE.DoubleSide });
    for (const texture of [material.map, material.normalMap, material.roughnessMap]) texture.repeat.set(1, 1);
    material.color = new THREE.Color(layerIndex === 0 ? 0xcfc4bb : layerIndex === 1 ? 0xffffff : 0xb8b2aa);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  const bottom = new THREE.Mesh(
    new THREE.PlaneGeometry(BLOCK.halfX * 2, BLOCK.halfZ * 2).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 }),
  );
  bottom.position.y = BLOCK.bottomY;
  group.add(bottom);

  group.add(buildRoots(rootAnchors, random));
  group.add(buildStones(rootAnchors, textures, random));
  return group;
}

function buildRoots(anchors, random) {
  const parts = [];
  const candidates = anchors.filter(() => random() < 0.42);
  for (const anchor of candidates) {
    const [normalX, normalZ] = anchor.edge.normal;
    const tangent = new THREE.Vector3(Math.abs(normalZ), 0, Math.abs(normalX)).multiplyScalar(random() < 0.5 ? 1 : -1);
    const rootCount = 1 + Math.floor(random() * 3);
    for (let root = 0; root < rootCount; root += 1) {
      const depth = 1.2 + random() * 4.2;
      const startAlong = (random() - 0.5) * 1.2;
      const points = [];
      const segments = 9;
      let drift = 0;
      for (let segment = 0; segment <= segments; segment += 1) {
        const t = segment / segments;
        drift += (random() - 0.5) * 0.28;
        const lateral = startAlong + drift + Math.sin(t * 5 + root) * 0.15;
        const x = anchor.x + tangent.x * lateral + normalX * (0.03 + 0.02 * random());
        const z = anchor.z + tangent.z * lateral + normalZ * (0.03 + 0.02 * random());
        const y = anchor.top + 0.1 - t * depth;
        points.push(new THREE.Vector3(x, y, z));
      }
      const thickness = 0.035 + random() * 0.05;
      const geometry = buildTaperedTube(points, (t) => thickness * (1 - t * 0.85), 6);
      parts.push(geometry);
      if (random() < 0.7) {
        const branchStart = points[3 + Math.floor(random() * 3)];
        const branchPoints = [];
        const direction = random() < 0.5 ? 1 : -1;
        for (let segment = 0; segment <= 5; segment += 1) {
          branchPoints.push(new THREE.Vector3(
            branchStart.x + tangent.x * direction * segment * 0.24,
            branchStart.y - segment * 0.13 - random() * 0.05,
            branchStart.z + tangent.z * direction * segment * 0.24,
          ).add(new THREE.Vector3(normalX * 0.01, 0, normalZ * 0.01)));
        }
        parts.push(buildTaperedTube(branchPoints, (t) => thickness * 0.45 * (1 - t * 0.8), 5));
      }
    }
  }
  const geometry = mergeGeometries(parts.map((part) => part.toNonIndexed()));
  const material = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function buildStones(anchors, textures, random) {
  const geometries = [];
  for (const anchor of anchors) {
    if (random() > 0.35) continue;
    const [normalX, normalZ] = anchor.edge.normal;
    const depth = 0.6 + random() * 5;
    const radius = 0.12 + random() * 0.32;
    const geometry = new THREE.IcosahedronGeometry(radius, 2);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
      const bump = 1 + 0.28 * fractalNoise(vertex.x * 4 + anchor.x, vertex.y * 4 + vertex.z * 3, 2, 9);
      vertex.multiplyScalar(bump);
      vertex.x *= 1.15;
      vertex.y *= 0.8;
      positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    geometry.computeVertexNormals();
    geometry.translate(anchor.x + normalX * (radius * 0.45), anchor.top - depth, anchor.z + normalZ * (radius * 0.45));
    geometries.push(geometry.toNonIndexed());
  }
  const material = tiledMaterial(textures.rock, 1.4, { color: 0xb8aea4 });
  const merged = mergeGeometries(geometries);
  const uv = new Float32Array(merged.attributes.position.count * 2);
  for (let index = 0; index < merged.attributes.position.count; index += 1) {
    uv[index * 2] = merged.attributes.position.getX(index) + merged.attributes.position.getZ(index);
    uv[index * 2 + 1] = merged.attributes.position.getY(index);
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildTerrain(textures) {
  const surface = buildSurfaceGeometry();
  const { material, uniforms } = buildSurfaceMaterial(textures);
  const surfaceMesh = new THREE.Mesh(surface.geometry, material);
  surfaceMesh.castShadow = true;
  surfaceMesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(surfaceMesh);
  group.add(buildWalls(textures));
  return { group, uniforms, surface: { ...surface, cell: CELL } };
}
