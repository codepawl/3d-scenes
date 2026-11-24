// Houses, buffalo, haystacks and the channel gate.
import * as THREE from 'three';
import { heightAt, streamPath, classify, TERRACE } from './terrainField.js';
import { tiledMaterial, makeCanvasTexture } from './materials.js';
import { buildTaperedTube, mergeGeometries, mergeVertices, paintGeometry } from './geometryUtils.js';
import { createRandom, fractalNoise } from './noise.js';
import { STREAM_GATE_FRACTION } from './waterSim.js';

// A box whose uv coordinates are in metres, so a tiled material keeps the same grain on any size.
function metricBox(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  const sizes = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]];
  for (let face = 0; face < 6; face += 1) {
    for (let corner = 0; corner < 4; corner += 1) {
      const index = face * 4 + corner;
      uv.setXY(index, uv.getX(index) * sizes[face][0], uv.getY(index) * sizes[face][1]);
    }
  }
  return geometry;
}

function gableTriangle(width, height, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, 0, -thickness / 2);
  const uv = geometry.attributes.uv;
  const positions = geometry.attributes.position;
  for (let index = 0; index < uv.count; index += 1) uv.setXY(index, positions.getX(index), positions.getY(index) + positions.getZ(index));
  return geometry;
}

export function buildHouse(textures, variant) {
  const group = new THREE.Group();
  const plankMaterial = tiledMaterial(textures.planks, 1.6, { color: variant === 1 ? 0xe2c9a4 : 0xf0dcc0 });
  const darkPlankMaterial = tiledMaterial(textures.planks, 1.6, { color: 0x6f5a46 });
  const thatchMaterial = tiledMaterial(textures.thatch, 1.7, { color: 0xf2e2b8 });
  const width = 6.4 + variant * 0.5;
  const depth = 4.6;
  const wallHeight = 2.3;
  const floorY = 1.15;
  const add = (geometry, material, x, y, z, rotation) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // Posts down to the ground, deep enough to sit on any slope under the pad.
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      const x = -width / 2 + 0.3 + column * ((width - 0.6) / 3);
      const z = -depth / 2 + 0.3 + row * (depth - 0.6);
      add(new THREE.CylinderGeometry(0.13, 0.15, floorY + 1.6, 8).translate(0, (floorY - 1.6) / 2, 0), darkPlankMaterial, x, 0, z);
    }
  }
  add(metricBox(width + 0.4, 0.16, depth + 0.4), plankMaterial, 0, floorY, 0);
  add(metricBox(width + 0.1, 0.12, 0.12), darkPlankMaterial, 0, floorY - 0.14, depth / 2 - 0.3);
  add(metricBox(width, wallHeight, 0.14), plankMaterial, 0, floorY + wallHeight / 2 + 0.08, -depth / 2 + 0.07);
  add(metricBox(0.14, wallHeight, depth), plankMaterial, -width / 2 + 0.07, floorY + wallHeight / 2 + 0.08, 0);
  add(metricBox(0.14, wallHeight, depth), plankMaterial, width / 2 - 0.07, floorY + wallHeight / 2 + 0.08, 0);
  const frontZ = depth / 2 - 0.07;
  add(metricBox(width * 0.36, wallHeight, 0.14), plankMaterial, -width * 0.32, floorY + wallHeight / 2 + 0.08, frontZ);
  add(metricBox(width * 0.3, wallHeight, 0.14), plankMaterial, width * 0.35, floorY + wallHeight / 2 + 0.08, frontZ);
  add(metricBox(width * 0.34, wallHeight - 1.8, 0.14), plankMaterial, width * 0.0 - 0.15, floorY + wallHeight - 0.35 + 0.08, frontZ);
  add(metricBox(0.9, 1.8, 0.1), new THREE.MeshStandardMaterial({ color: 0x1b1612, roughness: 1 }), -0.15, floorY + 0.98, frontZ - 0.04);
  // Porch, rail and a notched log ladder.
  add(metricBox(width * 0.5, 0.12, 1.5), plankMaterial, -0.15, floorY, depth / 2 + 0.95);
  add(metricBox(width * 0.5, 0.08, 0.1), darkPlankMaterial, -0.15, floorY + 0.85, depth / 2 + 1.65);
  for (const post of [-1, 1]) add(metricBox(0.1, 0.9, 0.1), darkPlankMaterial, -0.15 + post * width * 0.25, floorY + 0.45, depth / 2 + 1.65);
  const ladder = add(new THREE.BoxGeometry(0.4, 0.14, 2.3), darkPlankMaterial, -0.15 + width * 0.18, floorY - 0.5, depth / 2 + 2.2, [0.55, 0, 0]);
  void ladder;
  // Roof: two thatch planes with an overhang, a ridge cap and wooden gable ends.
  const pitch = 0.62;
  const halfSpan = depth / 2 + 0.9;
  const slopeLength = halfSpan / Math.cos(pitch);
  const roofLength = width + 1.4;
  const ridgeHeight = floorY + wallHeight + 0.08 + (depth / 2) * Math.tan(pitch);
  for (const side of [-1, 1]) {
    const panel = metricBox(roofLength, 0.28, slopeLength);
    add(panel, thatchMaterial, 0, ridgeHeight - (halfSpan / 2) * Math.tan(pitch) - 0.08, side * (halfSpan / 2), [-side * pitch, 0, 0]);
  }
  add(new THREE.CylinderGeometry(0.2, 0.2, roofLength + 0.2, 8).rotateZ(Math.PI / 2), thatchMaterial, 0, ridgeHeight + 0.12, 0);
  for (const end of [-1, 1]) {
    add(gableTriangle(depth, (depth / 2) * Math.tan(pitch), 0.14), plankMaterial, end * (width / 2 - 0.07), floorY + wallHeight + 0.08, 0, [0, Math.PI / 2, 0]);
  }
  return group;
}

function pickBuffaloStations() {
  return [
    [-1.2, 1.02, 0.30, 0.24], [-1.05, 1.1, 0.46, 0.36], [-0.6, 1.1, 0.56, 0.46], [-0.1, 1.08, 0.57, 0.47],
    [0.4, 1.17, 0.60, 0.44], [0.8, 1.13, 0.46, 0.34], [1.05, 1.06, 0.40, 0.30], [1.3, 1.03, 0.33, 0.25],
    [1.52, 1.0, 0.30, 0.24], [1.74, 0.97, 0.28, 0.23], [1.92, 0.91, 0.25, 0.21], [2.02, 0.87, 0.17, 0.15],
  ];
}

function catmull(stations, t) {
  const count = stations.length - 1;
  const scaled = t * count;
  const index = Math.min(Math.floor(scaled), count - 1);
  const local = scaled - index;
  const read = (offset) => stations[Math.min(Math.max(index + offset, 0), count)];
  const p0 = read(-1); const p1 = read(0); const p2 = read(1); const p3 = read(2);
  return p1.map((_, component) => {
    const a = p0[component]; const b = p1[component]; const c = p2[component]; const d = p3[component];
    return 0.5 * (2 * b + (-a + c) * local + (2 * a - 5 * b + 4 * c - d) * local * local + (-a + 3 * b - 3 * c + d) * local ** 3);
  });
}

function buildBody() {
  const stations = pickBuffaloStations();
  const lengthSegments = 56;
  const sides = 28;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let along = 0; along <= lengthSegments; along += 1) {
    const t = along / lengthSegments;
    let [x, centerY, radiusY, radiusZ] = catmull(stations, t);
    const endTaper = Math.sqrt(Math.max(1 - Math.pow(Math.abs(t * 2 - 1), 14), 0.0004));
    radiusY *= endTaper;
    radiusZ *= endTaper;
    for (let around = 0; around <= sides; around += 1) {
      const angle = (around / sides) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const squareness = 2.5;
      const shapedZ = Math.sign(cosine) * Math.abs(cosine) ** (2 / squareness);
      const shapedY = Math.sign(sine) * Math.abs(sine) ** (2 / squareness);
      const belly = sine < 0 ? 1.0 : 1.0;
      positions.push(x, centerY + shapedY * radiusY * belly, shapedZ * radiusZ);
      uvs.push(around / sides * 3, t * 4);
    }
  }
  const ring = sides + 1;
  for (let along = 0; along < lengthSegments; along += 1) {
    for (let around = 0; around < sides; around += 1) {
      const a = along * ring + around;
      indices.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hideTexture() {
  return makeCanvasTexture(512, (context, size) => {
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
    const random = createRandom(5);
    for (let index = 0; index < 4200; index += 1) {
      const value = 100 + Math.floor(random() * 90);
      context.strokeStyle = `rgba(${value},${value},${value},0.5)`;
      context.lineWidth = 1 + random() * 2;
      const x = random() * size;
      const y = random() * size;
      context.beginPath();
      context.moveTo(x, y);
      context.quadraticCurveTo(x + (random() - 0.5) * 30, y + 10, x + (random() - 0.5) * 20, y + 16 + random() * 14);
      context.stroke();
    }
  }, false);
}

export function buildBuffalo() {
  const parts = [];
  const bodyColor = 0x34353a;
  const legColor = 0x2b2926;
  parts.push(paintGeometry(buildBody(), bodyColor));
  const legSpecs = [[0.5, 0.26, 0.15], [0.5, -0.26, 0.15], [-0.85, 0.27, 0.17], [-0.85, -0.27, 0.17]];
  for (const [x, z, thickness] of legSpecs) {
    const side = Math.sign(z);
    const points = [
      new THREE.Vector3(x, 0.78, z * 0.9),
      new THREE.Vector3(x + 0.03, 0.52, z),
      new THREE.Vector3(x - 0.04 * (x < 0 ? -1 : 1), 0.3, z * 1.04),
      new THREE.Vector3(x + 0.02, 0.1, z * 1.05),
    ];
    parts.push(paintGeometry(buildTaperedTube(points, (t) => thickness * (1 - 0.45 * t) + (t > 0.9 ? 0.015 : 0), 10), legColor));
    const hoof = new THREE.CylinderGeometry(0.085, 0.1, 0.1, 10).translate(x + 0.02, 0.04, z * 1.05 + side * 0.0);
    parts.push(paintGeometry(hoof, 0x151311));
  }
  for (const side of [-1, 1]) {
    const horn = [];
    const base = [[1.36, 1.2, 0.22], [1.3, 1.22, 0.55], [1.1, 1.26, 0.9], [0.88, 1.34, 1.14], [0.72, 1.5, 1.2], [0.64, 1.7, 1.1]];
    for (const [x, y, z] of base) horn.push(new THREE.Vector3(x, y, z * side));
    parts.push(paintGeometry(buildTaperedTube(horn, (t) => 0.07 * (1 - t) + 0.01, 12), 0x2a2622));
    const ear = new THREE.SphereGeometry(0.14, 12, 10).scale(1.6, 0.3, 1.0);
    ear.rotateY(side * 0.5);
    ear.rotateZ(side * -0.1);
    ear.translate(1.25, 1.1, 0.34 * side);
    parts.push(paintGeometry(ear, 0x3c3c40));
    const eye = new THREE.SphereGeometry(0.03, 8, 6).translate(1.58, 0.99, 0.15 * side);
    parts.push(paintGeometry(eye, 0x0a0908));
  }
  const tail = [
    new THREE.Vector3(-1.18, 1.0, 0), new THREE.Vector3(-1.3, 0.85, 0.02), new THREE.Vector3(-1.34, 0.6, 0.0), new THREE.Vector3(-1.32, 0.3, 0.03),
  ];
  parts.push(paintGeometry(buildTaperedTube(tail, (t) => 0.035 * (1 - 0.5 * t), 6), 0x3a3a3e));
  parts.forEach((part) => {
    part.deleteAttribute('normal');
    part.deleteAttribute('uv');
  });
  // Weld duplicate vertices (loft seams) so the hide shades smoothly, then rebuild normals and a planar uv for the bump.
  const merged = mergeVertices(mergeGeometries(parts), 1e-4);
  merged.computeVertexNormals();
  const mergedPositions = merged.attributes.position;
  const planarUv = new Float32Array(mergedPositions.count * 2);
  for (let index = 0; index < mergedPositions.count; index += 1) {
    planarUv[index * 2] = mergedPositions.getX(index) * 1.6 + mergedPositions.getZ(index) * 0.9;
    planarUv[index * 2 + 1] = mergedPositions.getY(index) * 1.6 + mergedPositions.getZ(index) * 0.5;
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(planarUv, 2));
  const hide = hideTexture();
  hide.repeat.set(1, 1);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, bumpMap: hide, bumpScale: 1.2 });
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(2.5);
  return group;
}

function strawTexture() {
  return makeCanvasTexture(512, (context, size) => {
    context.fillStyle = '#a98a45';
    context.fillRect(0, 0, size, size);
    const random = createRandom(9);
    for (let index = 0; index < 5000; index += 1) {
      const light = random();
      context.strokeStyle = light > 0.5 ? `rgba(226,190,106,${0.3 + random() * 0.5})` : `rgba(110,82,30,${0.3 + random() * 0.4})`;
      context.lineWidth = 1 + random() * 1.5;
      const x = random() * size;
      const y = random() * size;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + (random() - 0.5) * 8, y + 12 + random() * 26);
      context.stroke();
    }
  });
}

export function buildHaystack(seed) {
  const random = createRandom(seed);
  const profile = [];
  const steps = 22;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const radius = 0.95 * Math.pow(Math.sin(Math.min(t * 1.1, 1) * Math.PI * 0.5 + 0.0001), 0.0) * (1 - Math.pow(t, 1.6)) * (1 + 0.18 * Math.sin(t * 5)) + 0.04;
    profile.push(new THREE.Vector2(radius, t * 2.0));
  }
  const geometry = new THREE.LatheGeometry(profile, 36);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const wobble = 1 + 0.07 * fractalNoise(x * 3 + seed, y * 2 + z * 3, 2, 3);
    positions.setXYZ(index, x * wobble, y, z * wobble);
  }
  geometry.computeVertexNormals();
  const texture = strawTexture();
  texture.repeat.set(2, 1.2);
  const material = new THREE.MeshStandardMaterial({ map: texture, bumpMap: texture, bumpScale: 3, roughness: 0.95, color: 0xe6d3a0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.55, 6).translate(0, 2.15, 0), new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 1 }));
  const group = new THREE.Group();
  group.add(mesh, pole);
  group.rotation.y = random() * Math.PI * 2;
  return group;
}

// Wooden gate across the channel: two posts and a board that slides up when the channel is open.
export function buildGate(textures) {
  const path = streamPath();
  const index = Math.floor(STREAM_GATE_FRACTION * (path.length - 1));
  const point = path[index];
  const next = path[Math.min(index + 1, path.length - 1)];
  const group = new THREE.Group();
  const wood = tiledMaterial(textures.planks, 1.2, { color: 0x9a8268 });
  const heading = Math.atan2(next.x - point.x, next.z - point.z);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(metricBox(0.2, 1.7, 0.2), wood);
    post.position.set(side * 1.0, 0.6, 0);
    post.castShadow = true;
    group.add(post);
  }
  const board = new THREE.Mesh(metricBox(1.9, 0.75, 0.1), wood);
  board.castShadow = true;
  group.add(board);
  group.position.set(point.x, point.y - 0.12, point.z);
  group.rotation.y = heading;
  return {
    group,
    update(channelFront) {
      const open = Math.min(Math.max(channelFront * 2, 0), 1);
      board.position.set(0, 0.34 + open * 0.95, 0);
    },
  };
}
