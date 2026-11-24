import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries, mergeVertices };

// A tube along a polyline whose radius is a function of the 0..1 position along it.
export function buildTaperedTube(points, radiusAt, sides = 7, closeEnds = true) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const count = points.length;
  let previousNormal = null;
  for (let index = 0; index < count; index += 1) {
    const previous = points[Math.max(index - 1, 0)];
    const next = points[Math.min(index + 1, count - 1)];
    const tangent = new THREE.Vector3().subVectors(next, previous).normalize();
    let helper = previousNormal ?? (Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    const side = new THREE.Vector3().crossVectors(tangent, helper).normalize();
    const up = new THREE.Vector3().crossVectors(side, tangent).normalize();
    previousNormal = up;
    const radius = radiusAt(index / (count - 1));
    for (let around = 0; around <= sides; around += 1) {
      const angle = (around / sides) * Math.PI * 2;
      const direction = side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
      const point = points[index].clone().addScaledVector(direction, radius);
      positions.push(point.x, point.y, point.z);
      normals.push(direction.x, direction.y, direction.z);
      uvs.push(around / sides, index / (count - 1));
    }
  }
  const ring = sides + 1;
  for (let index = 0; index < count - 1; index += 1) {
    for (let around = 0; around < sides; around += 1) {
      const a = index * ring + around;
      const b = a + ring;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  void closeEnds;
  return geometry;
}

// Bake one colour into a geometry's vertex colours so many parts can share a single material.
export function paintGeometry(geometry, color) {
  const paint = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = paint.r;
    colors[index * 3 + 1] = paint.g;
    colors[index * 3 + 2] = paint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function toIndexed(geometry) {
  return geometry.index ? geometry : geometry.clone();
}
