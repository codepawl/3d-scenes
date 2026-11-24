// Chunked greedy mesher with per-vertex ambient occlusion.
// A face only merges with its neighbour when block type AND all four corner AO values match,
// so the AO gradient survives merging (see CREDITS.md: 0fps.net articles).
import * as THREE from 'three';
import { NX, NY, NZ, PALETTE, kindOf } from './city.js';

export const CHUNK = 32;
const AO_CURVE = [0.42, 0.62, 0.8, 1.0];

const linearPalette = new Float32Array(256 * 3);
{
  const c = new THREE.Color();
  for (const [t, hex] of PALETTE) {
    c.setHex(hex, THREE.SRGBColorSpace); // stored linear
    linearPalette[t * 3] = c.r; linearPalette[t * 3 + 1] = c.g; linearPalette[t * 3 + 2] = c.b;
  }
}

/** Mesh one chunk. Returns a BufferGeometry or null if empty. */
export function meshChunk(grid, cx, cy, cz) {
  const dims = [NX, NY, NZ];
  const c0 = [cx * CHUNK, cy * CHUNK, cz * CHUNK];
  const c1 = [Math.min(c0[0] + CHUNK, NX), Math.min(c0[1] + CHUNK, NY), Math.min(c0[2] + CHUNK, NZ)];
  const solid = (p) => grid.get(p[0], p[1], p[2]) !== 0 ? 1 : 0;

  const pos = [], nrm = [], col = [], kind = [], idx = [];
  const x = [0, 0, 0], q = [0, 0, 0], p = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const W = c1[u] - c0[u], H = c1[v] - c0[v];
    const mask = new Int32Array(W * H);
    q[0] = q[1] = q[2] = 0; q[d] = 1;

    for (let s = c0[d]; s <= c1[d]; s++) {
      // build mask for plane s (between cells s-1 and s along d)
      let n = 0;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++, n++) {
          x[d] = s; x[u] = c0[u] + i; x[v] = c0[v] + j;
          const b = (s < dims[d]) ? grid.get(x[0], x[1], x[2]) : 0;
          x[d] = s - 1;
          const a = (s - 1 >= 0) ? grid.get(x[0], x[1], x[2]) : 0;
          let key = 0;
          let air, t, sign;
          if (a !== 0 && b === 0 && s - 1 >= c0[d] && s - 1 < c1[d]) { t = a; sign = 1; air = s; }
          else if (b !== 0 && a === 0 && s >= c0[d] && s < c1[d]) { t = b; sign = 0; air = s - 1; }
          else { mask[n] = 0; continue; }
          // skip the bottom face of the world and never-visible faces under the ground slab
          if (d === 1 && sign === 0 && air < 0) { mask[n] = 0; continue; }
          // AO: sample the 8 neighbours in the air layer
          p[d] = air;
          const pu = c0[u] + i, pv = c0[v] + j;
          const S = (du, dv) => { p[u] = pu + du; p[v] = pv + dv; return solid(p); };
          const s_m0 = S(-1, 0), s_p0 = S(1, 0), s_0m = S(0, -1), s_0p = S(0, 1);
          const c_mm = S(-1, -1), c_pm = S(1, -1), c_pp = S(1, 1), c_mp = S(-1, 1);
          const ao = (s1, s2, c) => (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
          const a00 = ao(s_m0, s_0m, c_mm);
          const a10 = ao(s_p0, s_0m, c_pm);
          const a11 = ao(s_p0, s_0p, c_pp);
          const a01 = ao(s_m0, s_0p, c_mp);
          key = t | (a00 << 8) | (a10 << 10) | (a11 << 12) | (a01 << 14) | (sign << 16) | (1 << 20);
          mask[n] = key;
        }
      }
      // greedy merge
      n = 0;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W;) {
          const key = mask[n];
          if (key === 0) { i++; n++; continue; }
          let w = 1;
          while (i + w < W && mask[n + w] === key) w++;
          let h = 1, done = false;
          for (; j + h < H; h++) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * W] !== key) { done = true; break; }
            }
            if (done) break;
          }
          emitQuad(d, u, v, s, c0[u] + i, c0[v] + j, w, h, key);
          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * W] = 0;
          i += w; n += w;
        }
      }
    }
  }

  function emitQuad(d, u, v, s, i, j, w, h, key) {
    const t = key & 255;
    const ao = [(key >> 8) & 3, (key >> 10) & 3, (key >> 12) & 3, (key >> 14) & 3]; // 00,10,11,01
    const sign = (key >> 16) & 1;
    const base = pos.length / 3;
    const corners = [[i, j], [i + w, j], [i + w, j + h], [i, j + h]];
    const nn = [0, 0, 0]; nn[d] = sign ? 1 : -1;
    const k = kindOf(t);
    for (let c = 0; c < 4; c++) {
      const vtx = [0, 0, 0];
      vtx[d] = s; vtx[u] = corners[c][0]; vtx[v] = corners[c][1];
      pos.push(vtx[0], vtx[1], vtx[2]);
      nrm.push(nn[0], nn[1], nn[2]);
      const a = AO_CURVE[ao[c]];
      col.push(linearPalette[t * 3] * a, linearPalette[t * 3 + 1] * a, linearPalette[t * 3 + 2] * a);
      kind.push(k);
    }
    // choose the diagonal joining the brighter pair to keep AO isotropic
    const flip = ao[0] + ao[2] < ao[1] + ao[3];
    let tri = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    if (!sign) tri = [tri[0], tri[2], tri[1], tri[3], tri[5], tri[4]];
    for (const o of tri) idx.push(base + o);
  }

  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Int8BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aKind', new THREE.Uint8BufferAttribute(kind, 1));
  const I = pos.length / 3 > 65535 ? Uint32Array : Uint16Array;
  geo.setIndex(new THREE.BufferAttribute(new I(idx), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
