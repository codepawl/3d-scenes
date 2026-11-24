import * as THREE from 'three';
import { patchMaterial } from './materials.js';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function bladeGeometry(segments) {
  const positions = [];
  for (let row = 0; row < segments; row++) {
    const t = row / segments;
    positions.push(-0.5, t, 0, 0.5, t, 0);
  }
  positions.push(0, 1, 0);
  const indices = [];
  for (let row = 0; row < segments - 1; row++) {
    const a = row * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  indices.push(last, last + 1, segments * 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function flowerGeometry() {
  const positions = [0, 0, 0];
  const petals = 5;
  for (let index = 0; index < petals * 2; index++) {
    const angle = (index / (petals * 2)) * Math.PI * 2;
    const radius = index % 2 === 0 ? 1 : 0.38;
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }
  const indices = [];
  for (let index = 0; index < petals * 2; index++) {
    indices.push(0, 1 + ((index + 1) % (petals * 2)), 1 + index);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

// Picks root positions on the banks, denser close to the water, using the grass mask.
function scatter(field, path, count, random, { maxOutside = 15, falloff = 6, minGrass = 0 }) {
  const roots = [];
  const sStart = path.sAtZ(54);
  const sEnd = path.culvertS - 0.6;
  const point = new THREE.Vector3();
  let attempts = 0;
  while (roots.length < count && attempts < count * 12) {
    attempts++;
    const s = sStart + random() * (sEnd - sStart);
    const side = random() < 0.5 ? -1 : 1;
    const halfWidth = path.value(path.halfWidth, s);
    const outside = -falloff * Math.log(1 - random() * (1 - Math.exp(-maxOutside / falloff)));
    path.point(s, side * (halfWidth + outside), point);
    if (!field.contains(point.x, point.z, 1)) {
      continue;
    }
    const grass = field.sample('grass', point.x, point.z);
    if (grass < minGrass || random() > grass) {
      continue;
    }
    const ground = field.height(point.x, point.z);
    if (ground < field.water(point.x, point.z) + 0.04) {
      continue;
    }
    roots.push({ x: point.x, y: ground, z: point.z, outside, s });
  }
  return roots;
}

function chunked(roots, chunkLength) {
  const chunks = new Map();
  for (const root of roots) {
    const key = Math.floor(root.s / chunkLength) * 2 + (root.x > 0 ? 1 : 0);
    if (!chunks.has(key)) {
      chunks.set(key, []);
    }
    chunks.get(key).push(root);
  }
  return [...chunks.values()];
}

function createGrassMaterial(worldUniforms) {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0 });
  return patchMaterial(material, 'creek-grass', worldUniforms, {
    vertexPars: /* glsl */ `
      attribute vec3 aRoot;
      attribute vec4 aShape;
      attribute vec2 aTone;
      varying float vBladeT;
      varying vec2 vBladeTone;
    `,
    vertex: [
      ['#include <beginnormal_vertex>', /* glsl */ `
        float bladeYaw = aShape.x;
        vec3 bladeFacing = vec3( sin( bladeYaw ), 0.0, cos( bladeYaw ) );
        objectNormal = normalize( mix( bladeFacing, vec3( 0.0, 1.0, 0.0 ), 0.62 ) );
      `],
      ['#include <begin_vertex>', /* glsl */ `
        float bladeT = position.y;
        float bladeHeight = aShape.y;
        float taper = 1.0 - pow( bladeT, 1.7 ) * 0.9;
        vec3 bladeLocal = vec3( position.x * aShape.z * taper, bladeT * bladeHeight, 0.0 );
        float bend = aShape.w;
        bladeLocal.z += bladeT * bladeT * bladeHeight * bend;
        bladeLocal.y -= bladeT * bladeT * bladeHeight * bend * bend * 0.4;
        float sinYaw = sin( bladeYaw );
        float cosYaw = cos( bladeYaw );
        vec3 bladeWorld = vec3( bladeLocal.x * cosYaw + bladeLocal.z * sinYaw, bladeLocal.y, -bladeLocal.x * sinYaw + bladeLocal.z * cosYaw );
        vec2 windDirection = normalize( vec2( 0.8, 0.45 ) );
        float wave = sin( uTime * 1.3 + dot( aRoot.xz, windDirection ) * 0.35 ) * 0.5 + 0.5;
        float gust = wave * wave * 0.5 + sin( uTime * 2.3 + aTone.y * 6.2831 + aRoot.x * 0.7 ) * 0.1;
        float sway = gust * uWind * bladeT * bladeT * bladeHeight;
        bladeWorld.xz += windDirection * sway;
        bladeWorld.y -= abs( sway ) * 0.3;
        transformed = aRoot + bladeWorld;
        vBladeT = bladeT;
        vBladeTone = aTone;
      `],
      ['#include <project_vertex>', 'vCreekWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;'],
    ],
    fragmentPars: 'varying float vBladeT;\nvarying vec2 vBladeTone;',
    fragment: [
      ['#include <color_fragment>', /* glsl */ `
        vec3 rootColor = mix( vec3( 0.022, 0.065, 0.012 ), vec3( 0.07, 0.16, 0.022 ), vBladeTone.x );
        vec3 tipColor = mix( vec3( 0.15, 0.3, 0.045 ), vec3( 0.32, 0.42, 0.09 ), vBladeTone.x * vBladeTone.x );
        diffuseColor.rgb = mix( rootColor, tipColor, smoothstep( 0.05, 1.0, vBladeT ) ) * uGrassTint;
        diffuseColor.rgb *= mix( 0.4, 1.0, smoothstep( 0.0, 0.6, vBladeT ) );
      `],
      ['#include <normal_fragment_begin>', 'normal = normalize( vNormal );'],
      ['#include <lights_fragment_end>', /* glsl */ `
        {
          vec3 viewToFragment = normalize( vCreekWorld - cameraPosition );
          float forward = pow( clamp( dot( viewToFragment, uSunDirection ), 0.0, 1.0 ), 3.0 );
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3( 1.0, 1.1, 0.55 ) * uSunLight * ( 0.05 + forward * 0.55 ) * vBladeT * creekSunShadow();
        }
      `],
    ],
  });
}

function createFlowerMaterial(worldUniforms) {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  return patchMaterial(material, 'creek-flower', worldUniforms, {
    vertexPars: 'attribute vec3 aRoot;\nattribute vec4 aFlower;\nattribute vec3 aPetal;\nvarying vec3 vPetal;\nvarying float vPetalEdge;',
    vertex: [
      ['#include <beginnormal_vertex>', 'objectNormal = vec3( 0.0, 1.0, 0.0 );'],
      ['#include <begin_vertex>', /* glsl */ `
        float flowerYaw = aFlower.x;
        vec3 petal = position * aFlower.y;
        float sinYaw = sin( flowerYaw );
        float cosYaw = cos( flowerYaw );
        petal = vec3( petal.x * cosYaw + petal.z * sinYaw, petal.y + length( position.xz ) * aFlower.y * 0.25, -petal.x * sinYaw + petal.z * cosYaw );
        float sway = sin( uTime * 1.7 + aRoot.x * 0.5 + aRoot.z * 0.3 ) * 0.025 * uWind;
        transformed = aRoot + petal + vec3( sway, aFlower.z, sway * 0.6 );
        vPetal = aPetal;
        vPetalEdge = length( position.xz );
      `],
      ['#include <project_vertex>', 'vCreekWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;'],
    ],
    fragmentPars: 'varying vec3 vPetal;\nvarying float vPetalEdge;',
    fragment: [
      ['#include <color_fragment>', 'diffuseColor.rgb = mix( vec3( 0.9, 0.75, 0.2 ), vPetal, smoothstep( 0.12, 0.3, vPetalEdge ) );'],
      ['#include <normal_fragment_begin>', 'normal = normalize( vNormal );'],
    ],
  });
}

export function createGrass(field, path, worldUniforms, { bladeCount = 240000, flowerCount = 5200 } = {}) {
  const random = seededRandom(1234);
  const group = new THREE.Group();
  group.name = 'grass';
  const blade = bladeGeometry(4);
  const material = createGrassMaterial(worldUniforms);
  const roots = scatter(field, path, bladeCount, random, { maxOutside: 16, falloff: 4.5 });
  for (const chunk of chunked(roots, 10)) {
    const geometry = blade.clone();
    const rootArray = new Float32Array(chunk.length * 3);
    const shapeArray = new Float32Array(chunk.length * 4);
    const toneArray = new Float32Array(chunk.length * 2);
    const bounds = new THREE.Box3();
    chunk.forEach((root, index) => {
      const nearWater = Math.exp(-root.outside / 2.5);
      rootArray.set([root.x, root.y - 0.02, root.z], index * 3);
      const height = (0.13 + random() * 0.21) * (1 + nearWater * 0.75) * (random() < 0.06 ? 1.7 : 1);
      shapeArray.set([random() * Math.PI * 2, height, 0.022 + random() * 0.02, 0.15 + random() * 0.4], index * 4);
      toneArray.set([random(), random()], index * 2);
      bounds.expandByPoint(new THREE.Vector3(root.x, root.y, root.z));
    });
    geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(rootArray, 3));
    geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapeArray, 4));
    geometry.setAttribute('aTone', new THREE.InstancedBufferAttribute(toneArray, 2));
    geometry.instanceCount = chunk.length;
    bounds.expandByScalar(1.2);
    geometry.boundingBox = bounds;
    geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
  }

  const palette = [
    new THREE.Color('#e7a6d8'), new THREE.Color('#d98bd2'), new THREE.Color('#f2f0ea'),
    new THREE.Color('#f5d24b'), new THREE.Color('#c9a1f0'),
  ];
  const flowerRoots = scatter(field, path, flowerCount, random, { maxOutside: 12, falloff: 4.5, minGrass: 0.6 });
  const flowers = flowerGeometry();
  const flowerRootArray = new Float32Array(flowerRoots.length * 3);
  const flowerArray = new Float32Array(flowerRoots.length * 4);
  const petalArray = new Float32Array(flowerRoots.length * 3);
  flowerRoots.forEach((root, index) => {
    flowerRootArray.set([root.x, root.y, root.z], index * 3);
    flowerArray.set([random() * Math.PI * 2, 0.022 + random() * 0.018, 0.12 + random() * 0.22, 0], index * 4);
    const color = palette[Math.floor(Math.pow(random(), 1.4) * palette.length)];
    petalArray.set([color.r, color.g, color.b], index * 3);
  });
  flowers.setAttribute('aRoot', new THREE.InstancedBufferAttribute(flowerRootArray, 3));
  flowers.setAttribute('aFlower', new THREE.InstancedBufferAttribute(flowerArray, 4));
  flowers.setAttribute('aPetal', new THREE.InstancedBufferAttribute(petalArray, 3));
  flowers.instanceCount = flowerRoots.length;
  const flowerBounds = new THREE.Box3().setFromArray(flowerRootArray).expandByScalar(1);
  flowers.boundingSphere = flowerBounds.getBoundingSphere(new THREE.Sphere());
  const flowerMesh = new THREE.Mesh(flowers, createFlowerMaterial(worldUniforms));
  flowerMesh.receiveShadow = true;
  group.add(flowerMesh);
  return { group, bladeCount: roots.length, flowerCount: flowerRoots.length };
}
