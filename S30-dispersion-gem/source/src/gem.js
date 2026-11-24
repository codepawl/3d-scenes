// Procedural round-brilliant-style gem: a convex hull of rings of points,
// plus the list of unique facet planes for the analytic interior ray tracer.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

export function buildGem() {
  const g = 0.018;        // half girdle thickness
  const crownH = 0.33;    // girdle top -> table
  const pavD = 0.86;      // girdle bottom -> culet
  const tableR = 0.56;
  const pts = [];
  const P = (r, a, y) => pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
  const T = Math.PI / 4;

  for (let k = 0; k < 8; k++) P(tableR, (k + 0.5) * T, g + crownH);           // table
  for (let k = 0; k < 8; k++) P(0.80, k * T, g + 0.52 * crownH);               // bezel/star ring
  for (let k = 0; k < 16; k++) {                                               // girdle
    P(1.0, k * T * 0.5, g);
    P(1.0, k * T * 0.5, -g);
  }
  for (let k = 0; k < 8; k++) P(0.47, k * T, -g - 0.6 * (pavD - g));           // pavilion ring
  for (let k = 0; k < 8; k++) P(0.78, (k + 0.5) * T, -g - 0.235 * (pavD - g)); // lower girdle ring
  P(0, 0, -pavD);                                                              // culet

  const geometry = new ConvexGeometry(pts);
  geometry.computeVertexNormals(); // non-indexed -> flat facet normals

  // unique facet planes: n.x = w
  const pos = geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const planes = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const w = n.dot(a);
    if (!planes.some((p) => Math.abs(p.x - n.x) + Math.abs(p.y - n.y) + Math.abs(p.z - n.z) < 2e-3 && Math.abs(p.w - w) < 2e-3)) {
      planes.push(new THREE.Vector4(n.x, n.y, n.z, w));
    }
  }
  return { geometry, planes, pavD };
}
