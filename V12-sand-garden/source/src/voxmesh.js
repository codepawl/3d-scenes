// Dense 3D voxel volume + face-culled mesher with per-vertex ambient occlusion (original code).
import * as THREE from 'three';

export class Volume {
  constructor(nx, ny, nz) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.c = new Float32Array(nx * ny * nz * 3);
    this.s = new Uint8Array(nx * ny * nz);
  }
  idx(x, y, z) { return x + this.nx * (y + this.ny * z); }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.s[this.idx(x, y, z)] : 0; }
  set(x, y, z, r, g, b) {
    if (!this.inside(x, y, z)) return;
    const i = this.idx(x, y, z);
    this.s[i] = 1;
    this.c[i * 3] = r; this.c[i * 3 + 1] = g; this.c[i * 3 + 2] = b;
  }
  clear(x, y, z) { if (this.inside(x, y, z)) this.s[this.idx(x, y, z)] = 0; }
}

// Face definitions: normal, and the four corner offsets (in voxel units, CCW seen from outside)
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], o: [1, 0, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], o: [0, 0, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], o: [0, 1, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], o: [0, 0, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], o: [0, 0, 1] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], o: [0, 0, 0] },
];
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

/**
 * @param vol Volume
 * @param size voxel edge length (world units)
 * @param origin THREE.Vector3 world position of voxel (0,0,0) corner
 * @param skip optional (x,y,z,faceIndex) => bool to drop hidden faces
 */
export function meshVolume(vol, size, origin, skip) {
  const pos = [], nrm = [], col = [], idx = [];
  let vc = 0;
  const { nx, ny, nz } = vol;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = vol.idx(x, y, z);
    if (!vol.s[i]) continue;
    const r = vol.c[i * 3], g = vol.c[i * 3 + 1], b = vol.c[i * 3 + 2];
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const ax = x + F.n[0], ay = y + F.n[1], az = z + F.n[2];
      if (vol.get(ax, ay, az)) continue;
      if (skip && skip(x, y, z, f)) continue;
      const ao = [];
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let k = 0; k < 4; k++) {
        const [cu, cv] = corners[k];
        const su = cu ? 1 : -1, sv = cv ? 1 : -1;
        const s1 = vol.get(ax + F.u[0] * su, ay + F.u[1] * su, az + F.u[2] * su);
        const s2 = vol.get(ax + F.v[0] * sv, ay + F.v[1] * sv, az + F.v[2] * sv);
        const cc = vol.get(ax + F.u[0] * su + F.v[0] * sv, ay + F.u[1] * su + F.v[1] * sv, az + F.u[2] * su + F.v[2] * sv);
        const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
        ao.push(AO_CURVE[a]);
        const px = x + F.o[0] + F.u[0] * cu + F.v[0] * cv;
        const py = y + F.o[1] + F.u[1] * cu + F.v[1] * cv;
        const pz = z + F.o[2] + F.u[2] * cu + F.v[2] * cv;
        pos.push(origin.x + px * size, origin.y + py * size, origin.z + pz * size);
        nrm.push(F.n[0], F.n[1], F.n[2]);
        const shade = ao[k];
        col.push(r * shade, g * shade, b * shade);
      }
      if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      else idx.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc);
      vc += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}
