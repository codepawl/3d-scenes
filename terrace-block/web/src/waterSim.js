// Fixed-step, deterministic water model.
// Each terrace shelf is a basin holding a volume. Under the current tilt the water surface is a plane that is level
// in the world (a damped spring gives it slosh). Volume sets the plane height; lips (bund notches, bund crests, block
// edges) pass water when the plane rises above them. Flow over an edge lip becomes ballistic particles.
import { TERRACE } from './terrainField.js';
import { createRandom } from './noise.js';

export const FIXED_STEP = 1 / 60;
const WEIR_COEFFICIENT = 18.0;
const CREST_WEIR_COEFFICIENT = 4.0; // flow over a plain bund crest (not a notch) is slower
const EDGE_WEIR_COEFFICIENT = 2.4; // water spilling over the block rim into the air is slower than over a notch
const INFLOW_RATE = 12.6;
const SLOSH_FREQUENCY = 2.6;
const SLOSH_DAMPING = 0.22;
const GRAVITY_WORLD = 11;
// The surface follows nearly the whole level slope (1.0 would be a frictionless fluid).
const SLOPE_RESPONSE = 0.88;
export const MAX_PARTICLES = 30000;
export const SEASON_DRAIN_DEPTH = [Infinity, 0.12, 0.0];
const GATE_FRACTION = 0.55;

export function localGravityDirection(tiltX, tiltZ) {
  return {
    x: -Math.cos(tiltX) * Math.sin(tiltZ),
    y: -Math.cos(tiltX) * Math.cos(tiltZ),
    z: Math.sin(tiltX),
  };
}

export function blockToWorld(tiltX, tiltZ, point) {
  const cosZ = Math.cos(tiltZ);
  const sinZ = Math.sin(tiltZ);
  const afterZ = { x: point.x * cosZ - point.y * sinZ, y: point.x * sinZ + point.y * cosZ, z: point.z };
  const cosX = Math.cos(tiltX);
  const sinX = Math.sin(tiltX);
  return { x: afterZ.x, y: afterZ.y * cosX - afterZ.z * sinX, z: afterZ.y * sinX + afterZ.z * cosX };
}

export class WaterSim {
  constructor(model) {
    this.model = model;
    this.basinCount = model.basins.length;
    this.lipCount = model.lips.length;
    this.volume = new Float64Array(this.basinCount);
    this.slopeX = new Float64Array(this.basinCount);
    this.slopeZ = new Float64Array(this.basinCount);
    this.slopeVelocityX = new Float64Array(this.basinCount);
    this.slopeVelocityZ = new Float64Array(this.basinCount);
    this.planeOffset = new Float64Array(this.basinCount);
    this.agitation = new Float64Array(this.basinCount);
    this.lipFlow = new Float32Array(this.lipCount);
    this.particles = {
      position: new Float32Array(MAX_PARTICLES * 3),
      velocity: new Float32Array(MAX_PARTICLES * 3),
      age: new Float32Array(MAX_PARTICLES).fill(1e9),
      life: new Float32Array(MAX_PARTICLES),
      size: new Float32Array(MAX_PARTICLES),
      kind: new Float32Array(MAX_PARTICLES), // 0 falling stream, 1 spray, 2 landing mist
      next: 0,
    };
    this.scratch = model.basins.map((basin) => new Float32Array(basin.sampleX.length));
    this.reset({ fill: 'empty', season: 0, channelOpen: false });
  }

  reset(initial) {
    this.time = 0;
    this.stepCount = 0;
    this.random = createRandom(20261027);
    this.volume.fill(0);
    this.slopeX.fill(0);
    this.slopeZ.fill(0);
    this.slopeVelocityX.fill(0);
    this.slopeVelocityZ.fill(0);
    this.agitation.fill(0);
    this.lipFlow.fill(0);
    this.particles.age.fill(1e9);
    this.particles.next = 0;
    this.channelFront = initial.channelOpen ? 1 : 0;
    this.inflow = 0;
    if (initial.fill === 'full') {
      this.model.basins.forEach((basin, index) => {
        this.volume[index] = basin.area * TERRACE.notchHeight * 1.9;
      });
    }
    for (let index = 0; index < this.basinCount; index += 1) this.solvePlane(index);
  }

  solvePlane(index) {
    const basin = this.model.basins[index];
    const terms = this.scratch[index];
    const count = terms.length;
    const slopeX = this.slopeX[index];
    const slopeZ = this.slopeZ[index];
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let sample = 0; sample < count; sample += 1) {
      const term = slopeX * basin.sampleX[sample] + slopeZ * basin.sampleZ[sample];
      terms[sample] = term;
      if (term < minimum) minimum = term;
      if (term > maximum) maximum = term;
    }
    const volume = this.volume[index];
    if (volume <= 1e-6) {
      this.planeOffset[index] = -maximum - 0.01;
      return;
    }
    let low = -maximum;
    let high = -minimum + volume / basin.area + 0.01;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const mid = (low + high) * 0.5;
      let wet = 0;
      for (let sample = 0; sample < count; sample += 1) {
        const depth = mid + terms[sample];
        if (depth > 0) wet += depth;
      }
      if (wet * basin.sampleArea > volume) high = mid;
      else low = mid;
    }
    this.planeOffset[index] = (low + high) * 0.5;
  }

  // inputs: { tiltX, tiltZ, season (0 mirror, 1 green, 2 golden), channelOpen }
  step(dt, inputs) {
    const gravity = localGravityDirection(inputs.tiltX, inputs.tiltZ);
    const targetSlopeX = (gravity.x / -gravity.y) * SLOPE_RESPONSE;
    const targetSlopeZ = (gravity.z / -gravity.y) * SLOPE_RESPONSE;
    const omega = SLOSH_FREQUENCY;
    const sloshDamping = inputs.sloshDamping ?? SLOSH_DAMPING;
    for (let index = 0; index < this.basinCount; index += 1) {
      const accelerationX = omega * omega * (targetSlopeX - this.slopeX[index]) - 2 * sloshDamping * omega * this.slopeVelocityX[index];
      const accelerationZ = omega * omega * (targetSlopeZ - this.slopeZ[index]) - 2 * sloshDamping * omega * this.slopeVelocityZ[index];
      this.slopeVelocityX[index] += accelerationX * dt;
      this.slopeVelocityZ[index] += accelerationZ * dt;
      this.slopeX[index] += this.slopeVelocityX[index] * dt;
      this.slopeZ[index] += this.slopeVelocityZ[index] * dt;
      const motion = Math.hypot(this.slopeVelocityX[index], this.slopeVelocityZ[index]);
      this.agitation[index] += (Math.min(motion * 1.4, 1) - this.agitation[index]) * Math.min(dt * 3, 1);
    }

    const channelTarget = inputs.channelOpen ? 1 : 0;
    const channelSpeed = inputs.channelOpen ? 0.55 : 1.2;
    if (this.channelFront < channelTarget) this.channelFront = Math.min(this.channelFront + channelSpeed * dt, 1);
    else if (this.channelFront > channelTarget) this.channelFront = Math.max(this.channelFront - channelSpeed * dt, 0);
    this.inflow = Math.min(Math.max((this.channelFront - 0.8) / 0.2, 0), 1) * INFLOW_RATE;
    this.volume[this.basinCount - 1] += this.inflow * dt;
    // Film only: farmers open each paddy's inlet in turn, top to bottom, so the whole block fills in seconds instead
    // of minutes. paddyFill = { start, stagger, rate } where rate is the fraction of a full paddy added per second.
    if (inputs.paddyFill && inputs.channelOpen) {
      const { start, stagger, rate, level } = inputs.paddyFill;
      for (let index = 0; index < this.basinCount; index += 1) {
        const openTime = start + (this.basinCount - 1 - index) * stagger;
        const basin = this.model.basins[index];
        const fullVolume = basin.area * TERRACE.notchHeight * (level ?? 1.9);
        if (this.time >= openTime && this.volume[index] < fullVolume) {
          this.volume[index] = Math.min(this.volume[index] + rate * fullVolume * dt, fullVolume);
        }
      }
    }

    for (let index = 0; index < this.basinCount; index += 1) this.solvePlane(index);

    const outflowPerBasin = new Float64Array(this.basinCount);
    const lipRates = new Float64Array(this.lipCount);
    const lips = this.model.lips;
    for (let lipIndex = 0; lipIndex < this.lipCount; lipIndex += 1) {
      const lip = lips[lipIndex];
      const basin = this.model.basins[lip.basin];
      const surface = this.planeOffset[lip.basin]
        + this.slopeX[lip.basin] * (lip.x - basin.centerX)
        + this.slopeZ[lip.basin] * (lip.z - basin.centerZ);
      const head = surface - lip.crest;
      if (head > 0) {
        const coefficient = lip.edge ? EDGE_WEIR_COEFFICIENT : (lip.isNotch ? WEIR_COEFFICIENT : CREST_WEIR_COEFFICIENT);
        const rate = coefficient * lip.width * head * Math.sqrt(head);
        lipRates[lipIndex] = rate;
        outflowPerBasin[lip.basin] += rate;
      }
    }
    for (let index = 0; index < this.basinCount; index += 1) {
      const limit = this.volume[index] * 0.6 / dt;
      this.outflowScale = outflowPerBasin[index] > limit ? limit / outflowPerBasin[index] : 1;
      outflowPerBasin[index] = this.outflowScale;
    }
    for (let lipIndex = 0; lipIndex < this.lipCount; lipIndex += 1) {
      const lip = lips[lipIndex];
      const rate = lipRates[lipIndex] * outflowPerBasin[lip.basin];
      this.lipFlow[lipIndex] += (rate - this.lipFlow[lipIndex]) * Math.min(dt * 8, 1);
      if (rate <= 0) continue;
      const moved = rate * dt;
      this.volume[lip.basin] -= moved;
      if (lip.destination >= 0) this.volume[lip.destination] += moved;
      this.emitParticles(lip, rate, dt, inputs);
    }

    for (let index = 0; index < this.basinCount; index += 1) {
      const capDepth = SEASON_DRAIN_DEPTH[inputs.season];
      if (Number.isFinite(capDepth)) {
        const capVolume = this.model.basins[index].area * capDepth;
        if (this.volume[index] > capVolume) this.volume[index] -= (this.volume[index] - capVolume) * 0.5 * dt;
      }
      if (this.volume[index] < 0) this.volume[index] = 0;
    }

    this.updateParticles(dt);
    this.time += dt;
    this.stepCount += 1;
  }

  // Water leaving the block: one thin stream particle per step and lip (a continuous jet), a few spray drops.
  emitParticles(lip, rate, dt, inputs) {
    const random = this.random;
    if (lip.edge) {
      if (rate < 0.03) return;
      const strength = Math.min(rate, 4);
      const speed = 2.4 + strength * 0.85;
      // Stream width varies along the edge in slow bands (some falls fat, some thin, a few gaps), and each particle
      // is a wide soft ribbon so neighbours blend into one sheet instead of a barcode of streaks.
      const px = lip.path[1].x;
      const pz = lip.path[1].z;
      const band = 0.5 + 0.5 * Math.sin(px * 0.9 + pz * 1.1) * Math.sin(px * 0.37 - pz * 0.53 + 1.3);
      const widthScale = 0.55 + 1.1 * band;
      if (band > 0.12 || strength > 2.5) {
        const velocity = {
          x: lip.edge.x * speed * (0.9 + random() * 0.2) + (random() - 0.5) * 0.2,
          y: -0.15 + (random() - 0.5) * 0.2,
          z: lip.edge.z * speed * (0.9 + random() * 0.2) + (random() - 0.5) * 0.2,
        };
        // Deterministic jitter along the edge so neighbouring falls never line up in a regular comb.
        const jitter = (Math.abs(Math.sin(this.stepCount * 12.9898 + px * 78.233 + pz * 37.719) * 43758.5453) % 1 - 0.5) * lip.width * 1.6;
        const position = { x: px - lip.edge.z * jitter, y: lip.path[1].y, z: pz + lip.edge.x * jitter };
        this.spawn(inputs, position, velocity, 2.1, (0.22 + strength * 0.05 + random() * 0.08) * widthScale, 0);
      }
      if (random() < 0.12 + strength * 0.04) {
        const velocity = {
          x: lip.edge.x * speed * (0.7 + random() * 0.5) + (random() - 0.5) * 1.3,
          y: random() * 0.9,
          z: lip.edge.z * speed * (0.7 + random() * 0.5) + (random() - 0.5) * 1.3,
        };
        this.spawn(inputs, { x: lip.path[1].x, y: lip.path[1].y, z: lip.path[1].z }, velocity, 1.2 + random() * 1.4, 0.16 + random() * 0.2, 1);
      }
      return;
    }
    const destination = this.model.basins[lip.destination];
    if (!destination || rate < 0.04) return;
    const count = Math.floor(rate * dt * 5 + random());
    const landing = lip.path[lip.path.length - 1];
    for (let n = 0; n < count; n += 1) {
      const velocity = { x: (random() - 0.5) * 0.9, y: 0.5 + random() * 0.9, z: (random() - 0.5) * 0.9 };
      this.spawn(inputs, { x: landing.x, y: destination.floorY + 0.3, z: landing.z }, velocity, 0.45, 0.07, 2);
    }
  }

  spawn(inputs, localPosition, localVelocity, life, size, kind) {
    const particles = this.particles;
    const slot = particles.next;
    particles.next = (slot + 1) % MAX_PARTICLES;
    const world = blockToWorld(inputs.tiltX, inputs.tiltZ, localPosition);
    const velocity = blockToWorld(inputs.tiltX, inputs.tiltZ, localVelocity);
    particles.position.set([world.x, world.y, world.z], slot * 3);
    particles.velocity.set([velocity.x, velocity.y, velocity.z], slot * 3);
    particles.age[slot] = 0;
    particles.life[slot] = life;
    particles.size[slot] = size;
    particles.kind[slot] = kind;
  }

  updateParticles(dt) {
    const particles = this.particles;
    for (let slot = 0; slot < MAX_PARTICLES; slot += 1) {
      if (particles.age[slot] >= particles.life[slot]) continue;
      particles.age[slot] += dt;
      const previousAge = particles.age[slot] - dt;
      const mistAge = 1.1 + 1.5 * ((slot * 0.6180339) % 1);
      particles.velocity[slot * 3 + 1] -= GRAVITY_WORLD * dt * (particles.kind[slot] > 1.5 ? 0.15 : 1);
      if (particles.kind[slot] < 0.5 && previousAge < mistAge && particles.age[slot] >= mistAge) this.releaseMist(slot);
      particles.position[slot * 3] += particles.velocity[slot * 3] * dt;
      particles.position[slot * 3 + 1] += particles.velocity[slot * 3 + 1] * dt;
      particles.position[slot * 3 + 2] += particles.velocity[slot * 3 + 2] * dt;
    }
  }

  // Where a fall has dropped far enough to break up, it leaves a soft puff of mist that drifts and fades.
  releaseMist(source) {
    if (this.random() > 0.55) return;
    const particles = this.particles;
    const slot = particles.next;
    particles.next = (slot + 1) % MAX_PARTICLES;
    const random = this.random;
    particles.position.set([particles.position[source * 3], particles.position[source * 3 + 1], particles.position[source * 3 + 2]], slot * 3);
    particles.velocity.set([(random() - 0.5) * 0.8, 0.3 + random() * 0.4, (random() - 0.5) * 0.8], slot * 3);
    particles.age[slot] = 0;
    particles.life[slot] = 0.9 + random() * 0.5;
    particles.size[slot] = 0.25 + random() * 0.3;
    particles.kind[slot] = 2;
  }

  // Water-surface data per basin for the renderer: world plane in block-local coordinates.
  surfaceHeightAt(index, x, z) {
    const basin = this.model.basins[index];
    return basin.floorY + this.planeOffset[index] + this.slopeX[index] * (x - basin.centerX) + this.slopeZ[index] * (z - basin.centerZ);
  }

  streamExtent() {
    return GATE_FRACTION + (1 - GATE_FRACTION) * this.channelFront;
  }
}

export const STREAM_GATE_FRACTION = GATE_FRACTION;
