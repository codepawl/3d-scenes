import * as THREE from 'three';

// Regular grid exported by Blender: height, water level, lateral offset, s, grass and bed masks.
export class Field {
  constructor(description, buffer) {
    this.columns = description.nx;
    this.rows = description.nz;
    this.originX = description.x0;
    this.originZ = description.z0;
    this.spacing = description.spacing;
    const floats = new Float32Array(buffer);
    const planeSize = this.columns * this.rows;
    this.planes = {};
    description.planes.forEach((name, index) => {
      this.planes[name] = floats.subarray(index * planeSize, (index + 1) * planeSize);
    });
    this.sizeX = (this.columns - 1) * this.spacing;
    this.sizeZ = (this.rows - 1) * this.spacing;
  }

  sample(planeName, x, z) {
    const plane = this.planes[planeName];
    const fx = THREE.MathUtils.clamp((x - this.originX) / this.spacing, 0, this.columns - 1.001);
    const fz = THREE.MathUtils.clamp((z - this.originZ) / this.spacing, 0, this.rows - 1.001);
    const column = Math.floor(fx);
    const row = Math.floor(fz);
    const tx = fx - column;
    const tz = fz - row;
    const index = row * this.columns + column;
    const top = plane[index] * (1 - tx) + plane[index + 1] * tx;
    const bottom = plane[index + this.columns] * (1 - tx) + plane[index + this.columns + 1] * tx;
    return top * (1 - tz) + bottom * tz;
  }

  height(x, z) {
    return this.sample('height', x, z);
  }

  water(x, z) {
    return this.sample('water', x, z);
  }

  contains(x, z, margin = 0) {
    return (
      x > this.originX + margin && x < this.originX + this.sizeX - margin &&
      z > this.originZ + margin && z < this.originZ + this.sizeZ - margin
    );
  }

  // Half-float RGBA texture for shaders: water level, ground height, bed mask, grass mask.
  createTexture() {
    const count = this.columns * this.rows;
    const data = new Uint16Array(count * 4);
    const { water, height, bed, grass } = this.planes;
    for (let index = 0; index < count; index++) {
      data[index * 4] = THREE.DataUtils.toHalfFloat(water[index]);
      data[index * 4 + 1] = THREE.DataUtils.toHalfFloat(height[index]);
      data[index * 4 + 2] = THREE.DataUtils.toHalfFloat(bed[index]);
      data[index * 4 + 3] = THREE.DataUtils.toHalfFloat(grass[index]);
    }
    const texture = new THREE.DataTexture(data, this.columns, this.rows, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  // Maps world xz to field uv: uv = xz * scale + offset.
  uvTransform() {
    return new THREE.Vector4(
      1 / (this.sizeX + this.spacing),
      1 / (this.sizeZ + this.spacing),
      (-this.originX + this.spacing * 0.5) / (this.sizeX + this.spacing),
      (-this.originZ + this.spacing * 0.5) / (this.sizeZ + this.spacing),
    );
  }
}

// The creek centreline sampled every few decimetres, with water level, half width and depth.
export class CreekPath {
  constructor(description) {
    this.spacing = description.spacing;
    this.length = description.length;
    this.culvertS = description.culvertS;
    const samples = description.samples;
    this.count = samples.length;
    this.x = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.waterLevel = new Float32Array(this.count);
    this.halfWidth = new Float32Array(this.count);
    this.depth = new Float32Array(this.count);
    samples.forEach((row, index) => {
      this.x[index] = row[0];
      this.z[index] = row[1];
      this.waterLevel[index] = row[3];
      this.halfWidth[index] = row[4];
      this.depth[index] = row[5];
    });
  }

  indexAt(s) {
    const position = THREE.MathUtils.clamp(s / this.spacing, 0, this.count - 1.001);
    const index = Math.floor(position);
    return { index, t: position - index };
  }

  value(array, s) {
    const { index, t } = this.indexAt(s);
    return array[index] * (1 - t) + array[index + 1] * t;
  }

  point(s, lateral = 0, target = new THREE.Vector3()) {
    const tangent = this.tangent(s);
    const x = this.value(this.x, s) - tangent.y * lateral;
    const z = this.value(this.z, s) + tangent.x * lateral;
    return target.set(x, this.value(this.waterLevel, s), z);
  }

  // Unit tangent in xz pointing upstream (increasing s), returned as Vector2(x, z).
  tangent(s, target = new THREE.Vector2()) {
    const { index } = this.indexAt(s);
    const next = Math.min(index + 1, this.count - 1);
    const previous = Math.max(next - 2, 0);
    target.set(this.x[next] - this.x[previous], this.z[next] - this.z[previous]);
    return target.normalize();
  }

  sAtZ(z) {
    for (let index = 0; index < this.count - 1; index++) {
      if (this.z[index] >= z && this.z[index + 1] < z) {
        const t = (this.z[index] - z) / (this.z[index] - this.z[index + 1]);
        return (index + t) * this.spacing;
      }
    }
    return z > this.z[0] ? 0 : this.length;
  }

  // Nearest s and signed lateral offset (positive along the left normal) for a world point.
  locate(x, z) {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < this.count; index += 2) {
      const dx = x - this.x[index];
      const dz = z - this.z[index];
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    const s = best * this.spacing;
    const tangent = this.tangent(s);
    const dx = x - this.x[best];
    const dz = z - this.z[best];
    return { s: s + dx * tangent.x + dz * tangent.y, lateral: -dx * tangent.y + dz * tangent.x };
  }

  // 1D float texture of (x, z, water level, half width) for GPU-animated effects.
  createTexture() {
    const data = new Float32Array(this.count * 4);
    for (let index = 0; index < this.count; index++) {
      data[index * 4] = this.x[index];
      data[index * 4 + 1] = this.z[index];
      data[index * 4 + 2] = this.waterLevel[index];
      data[index * 4 + 3] = this.halfWidth[index];
    }
    const texture = new THREE.DataTexture(data, this.count, 1, THREE.RGBAFormat, THREE.FloatType);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }
}
