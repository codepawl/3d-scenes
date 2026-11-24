// Swarm simulation: loose flocking on a uniform grid, a pour-in from the arena edges, and a flee reaction to the
// flashlight pool. Fixed steps from t = 0 with a seeded generator, so a film time always gives the same swarm:
// going back resets and replays, going forward continues. Units are body lengths and seconds.
// Each roach turns at a limited rate and has its own speed, so it reads as an insect and not a particle.
import { beamAt, BEAM_ON_TIME, POOL_RADIUS } from './swarm-beam.js';

export const ARENA = { halfWidth: 48, halfDepth: 52 };
// Roaches pour in through the edges of this box (just outside the shots' frame); the arena around it holds the rest.
const ENTRY_BOX = { halfWidth: 7.5, halfDepth: 10 };
const STEP = 1 / 60;
const BIN_STEPS = 6;
const NEIGHBOR_RADIUS = 1.7;
const SEPARATION_RADIUS = 1.1;
const MAX_NEIGHBORS = 14;
const ENTRY_SECONDS = 3;
// Share of the swarm that pours in through the frame; the rest is already around it, off frame.
const POUR_SHARE = 0.28;
const AMBIENT_CLEARANCE = 4;

const WALK_SPEED_RANGE = [1.4, 2.5];
const RUSH_SPEED_RANGE = [5, 6.6];
const RUSH_DISTANCE_RANGE = [8, 22];
const FLEE_SPEED_RANGE = [5, 6.8];
const SCALE_RANGE = [0.88, 1.18];
const WALK_TURN_RATE = 6;
const DART_TURN_RATE = 9;
const FLEE_TURN_RATE = 15;
const ACCELERATION = 14;
const BRAKING = 22;
const PANIC_SECONDS = 0.55;
// Panic starts a little outside the lit pool, so no roach is left standing in the bright circle.
const FLEE_RADIUS = POOL_RADIUS * 1.12;
const FLEE_REACH = 2;
// Roaches in the dark drift after the beam, so the swarm closes behind it. They follow where it was a moment ago.
const TRAIL_DELAY = 1.1;
const TRAIL_PULL = 1.1;
const TRAIL_RANGE = 20;
// Speed range over which a roach moves from the walk poses to the sprint poses.
const SPRINT_BLEND_FROM = 2.8;
const SPRINT_BLEND_TO = 4.6;
// Gait phases at which all six feet are planted (the two tripods hand over).
const STANDING_PHASES = [0.025, 0.525];
const STANDING_PHASE_RATE = 2.5;

const MODE_WALK = 0;
const MODE_PAUSE = 1;
const MODE_DART = 2;

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(from, to, value) {
  const amount = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return amount * amount * (3 - 2 * amount);
}

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

export class SwarmSimulation {
  /** strides: gait strides in body lengths for the walk and sprint poses (from the bake). */
  constructor(count, { seed = 7, strides }) {
    this.count = count;
    this.seed = seed;
    this.strides = strides;
    this.cellSize = NEIGHBOR_RADIUS;
    this.columns = Math.ceil((2 * ARENA.halfWidth) / this.cellSize) + 3;
    this.rows = Math.ceil((2 * ARENA.halfDepth) / this.cellSize) + 3;
    this.cellStart = new Int32Array(this.columns * this.rows + 1);
    this.cellItems = new Int32Array(count);
    this.cellOfAgent = new Int32Array(count);
    const floats = () => new Float32Array(count);
    this.x = floats();
    this.z = floats();
    this.heading = floats();
    this.speed = floats();
    this.phase = floats();
    this.sprintMix = floats();
    this.forwardX = floats();
    this.forwardZ = floats();
    this.scale = floats();
    this.shade = floats();
    this.baseSpeed = floats();
    this.rushSpeed = floats();
    this.fleeSpeed = floats();
    this.rushRemaining = floats();
    this.wanderAngle = floats();
    this.wanderRate = floats();
    this.modeTimer = floats();
    this.panicTimer = floats();
    this.entryTime = floats();
    this.entered = new Uint8Array(count);
    this.mode = new Uint8Array(count);
    this.reset();
  }

  reset() {
    const random = createRandom(this.seed);
    const between = ([low, high]) => low + (high - low) * random();
    this.random = random;
    this.stepCount = 0;
    this.bins = [];
    this.binStarted = 0;
    this.binEntering = 0;
    this.firstHitTime = null;
    for (let index = 0; index < this.count; index++) {
      this.scale[index] = between(SCALE_RANGE);
      this.shade[index] = random();
      this.baseSpeed[index] = between(WALK_SPEED_RANGE) * this.scale[index];
      this.rushSpeed[index] = between(RUSH_SPEED_RANGE) * this.scale[index];
      this.fleeSpeed[index] = between(FLEE_SPEED_RANGE) * this.scale[index];
      this.rushRemaining[index] = between(RUSH_DISTANCE_RANGE);
      this.wanderAngle[index] = random() * 2 * Math.PI;
      this.wanderRate[index] = 0.8 + random() * 1.6;
      this.modeTimer[index] = random();
      this.mode[index] = MODE_WALK;
      this.panicTimer[index] = 0;
      this.phase[index] = random();
      this.sprintMix[index] = 1;
      this.entered[index] = 0;
      if (random() < POUR_SHARE) this.placeAtEntry(index);
      else this.placeAround(index);
    }
  }

  /** Puts a roach outside the arena on a straight line that reaches the edge at its entry time. */
  placeAtEntry(index) {
    const random = this.random;
    const { halfWidth, halfDepth } = ENTRY_BOX;
    const perimeter = 4 * (halfWidth + halfDepth);
    let along = random() * perimeter;
    let edgeX;
    let edgeZ;
    if (along < 2 * halfWidth) {
      edgeX = along - halfWidth;
      edgeZ = -halfDepth;
    } else if ((along -= 2 * halfWidth) < 2 * halfDepth) {
      edgeX = halfWidth;
      edgeZ = along - halfDepth;
    } else if ((along -= 2 * halfDepth) < 2 * halfWidth) {
      edgeX = halfWidth - along;
      edgeZ = halfDepth;
    } else {
      along -= 2 * halfWidth;
      edgeX = -halfWidth;
      edgeZ = halfDepth - along;
    }
    const targetX = (random() * 2 - 1) * halfWidth * 0.8;
    const targetZ = (random() * 2 - 1) * halfDepth * 0.8;
    const heading = Math.atan2(targetX - edgeX, targetZ - edgeZ);
    const entryTime = ENTRY_SECONDS * Math.pow(random(), 0.9);
    const travelled = this.rushSpeed[index] * entryTime;
    this.heading[index] = heading;
    this.forwardX[index] = Math.sin(heading);
    this.forwardZ[index] = Math.cos(heading);
    this.x[index] = edgeX - this.forwardX[index] * travelled;
    this.z[index] = edgeZ - this.forwardZ[index] * travelled;
    this.speed[index] = this.rushSpeed[index];
    this.entryTime[index] = entryTime;
  }

  /** Puts a roach in the arena outside the frame, already walking. */
  placeAround(index) {
    const random = this.random;
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      x = (random() * 2 - 1) * ARENA.halfWidth * 0.95;
      z = (random() * 2 - 1) * ARENA.halfDepth * 0.95;
      const outsideBox = Math.abs(x) > ENTRY_BOX.halfWidth + AMBIENT_CLEARANCE || Math.abs(z) > ENTRY_BOX.halfDepth + AMBIENT_CLEARANCE;
      if (outsideBox) break;
    }
    this.x[index] = x;
    this.z[index] = z;
    this.heading[index] = random() * 2 * Math.PI;
    this.forwardX[index] = Math.sin(this.heading[index]);
    this.forwardZ[index] = Math.cos(this.heading[index]);
    this.speed[index] = this.baseSpeed[index];
    this.rushRemaining[index] = 0;
    this.entered[index] = 1;
  }

  isInside(index) {
    return Math.abs(this.x[index]) < ENTRY_BOX.halfWidth && Math.abs(this.z[index]) < ENTRY_BOX.halfDepth;
  }

  advanceTo(time) {
    const targetSteps = Math.round(time / STEP);
    if (targetSteps < this.stepCount) this.reset();
    while (this.stepCount < targetSteps) this.step();
  }

  buildGrid() {
    const cellStart = this.cellStart;
    cellStart.fill(0);
    for (let index = 0; index < this.count; index++) {
      const column = Math.floor((this.x[index] + ARENA.halfWidth) / this.cellSize) + 1;
      const row = Math.floor((this.z[index] + ARENA.halfDepth) / this.cellSize) + 1;
      const inGrid = this.entered[index] && column >= 0 && column < this.columns && row >= 0 && row < this.rows;
      const cell = inGrid ? row * this.columns + column : -1;
      this.cellOfAgent[index] = cell;
      if (cell >= 0) cellStart[cell + 1] += 1;
    }
    for (let cell = 0; cell < this.columns * this.rows; cell++) cellStart[cell + 1] += cellStart[cell];
    const fill = cellStart.slice(0, this.columns * this.rows);
    for (let index = 0; index < this.count; index++) {
      const cell = this.cellOfAgent[index];
      if (cell >= 0) this.cellItems[fill[cell]++] = index;
    }
  }

  /** Flocking forces on one roach: separation, alignment, light cohesion, from the roaches around it. */
  flockForces(index, forces) {
    const cell = this.cellOfAgent[index];
    forces.separationX = 0;
    forces.separationZ = 0;
    forces.alignX = 0;
    forces.alignZ = 0;
    forces.cohesionX = 0;
    forces.cohesionZ = 0;
    if (cell < 0) return;
    const column = cell % this.columns;
    const row = (cell - column) / this.columns;
    const radiusSquared = NEIGHBOR_RADIUS * NEIGHBOR_RADIUS;
    let neighbors = 0;
    for (let rowOffset = -1; rowOffset <= 1 && neighbors < MAX_NEIGHBORS; rowOffset++) {
      const neighborRow = row + rowOffset;
      if (neighborRow < 0 || neighborRow >= this.rows) continue;
      for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
        const neighborColumn = column + columnOffset;
        if (neighborColumn < 0 || neighborColumn >= this.columns) continue;
        const neighborCell = neighborRow * this.columns + neighborColumn;
        for (let slot = this.cellStart[neighborCell]; slot < this.cellStart[neighborCell + 1]; slot++) {
          const other = this.cellItems[slot];
          if (other === index) continue;
          const offsetX = this.x[other] - this.x[index];
          const offsetZ = this.z[other] - this.z[index];
          const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
          if (distanceSquared > radiusSquared) continue;
          neighbors += 1;
          forces.alignX += this.forwardX[other];
          forces.alignZ += this.forwardZ[other];
          forces.cohesionX += offsetX;
          forces.cohesionZ += offsetZ;
          const distance = Math.sqrt(distanceSquared) + 1e-4;
          if (distance < SEPARATION_RADIUS) {
            const push = (SEPARATION_RADIUS - distance) / SEPARATION_RADIUS;
            forces.separationX -= (offsetX / distance) * push;
            forces.separationZ -= (offsetZ / distance) * push;
          }
          if (neighbors >= MAX_NEIGHBORS) break;
        }
      }
    }
    if (neighbors > 0) {
      forces.alignX /= neighbors;
      forces.alignZ /= neighbors;
      forces.cohesionX /= neighbors * NEIGHBOR_RADIUS;
      forces.cohesionZ /= neighbors * NEIGHBOR_RADIUS;
    }
  }

  /** Picks the next walk, pause or dart for a roach whose current one ran out. */
  chooseMode(index) {
    const roll = this.random();
    const length = this.random();
    if (roll < 0.17) {
      this.mode[index] = MODE_PAUSE;
      this.modeTimer[index] = 0.12 + 0.4 * length;
    } else if (roll < 0.3) {
      this.mode[index] = MODE_DART;
      this.modeTimer[index] = 0.2 + 0.2 * length;
    } else {
      this.mode[index] = MODE_WALK;
      this.modeTimer[index] = 0.5 + 1.1 * length;
    }
  }

  step() {
    const time = this.stepCount * STEP;
    const beam = beamAt(time);
    const beamActive = beam.intensity > 0.5 && time >= BEAM_ON_TIME;
    const trail = beamAt(Math.max(BEAM_ON_TIME, time - TRAIL_DELAY));
    trail.active = beamActive && time > BEAM_ON_TIME + TRAIL_DELAY;
    this.buildGrid();
    const forces = {};
    let started = 0;
    for (let index = 0; index < this.count; index++) {
      started += this.updateRoach(index, forces, beam, beamActive, trail);
    }
    this.binStarted += started;
    if (started > 0 && this.firstHitTime === null) this.firstHitTime = Math.round(time * 1000) / 1000;
    this.stepCount += 1;
    if (this.stepCount % BIN_STEPS === 0) this.closeBin();
  }

  /** Advances one roach by a step. Returns 1 when it starts fleeing on this step. */
  updateRoach(index, forces, beam, beamActive, trail) {
    const x = this.x[index];
    const z = this.z[index];
    const inside = this.isInside(index);
    if (inside && !this.entered[index]) {
      this.entered[index] = 1;
      this.binEntering += 1;
    }

    let startedFleeing = 0;
    let fleeX = 0;
    let fleeZ = 0;
    if (beamActive) {
      const offsetX = x - beam.x;
      const offsetZ = z - beam.z;
      const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ) + 1e-4;
      if (distance < FLEE_RADIUS) {
        if (this.panicTimer[index] <= 0) startedFleeing = 1;
        this.panicTimer[index] = PANIC_SECONDS;
      }
      if (distance < FLEE_RADIUS + FLEE_REACH) {
        const closeness = 1 - smoothstep(FLEE_RADIUS * 0.3, FLEE_RADIUS + FLEE_REACH, distance);
        fleeX = (offsetX / distance) * (1 + 3 * closeness);
        fleeZ = (offsetZ / distance) * (1 + 3 * closeness);
      }
    }
    const panicked = this.panicTimer[index] > 0;
    this.panicTimer[index] = Math.max(0, this.panicTimer[index] - STEP);

    this.modeTimer[index] -= STEP;
    if (this.modeTimer[index] <= 0) this.chooseMode(index);
    const rushing = this.rushRemaining[index] > 0;

    let steerX = this.forwardX[index] * 0.9;
    let steerZ = this.forwardZ[index] * 0.9;
    if (this.entered[index]) {
      this.flockForces(index, forces);
      this.wanderAngle[index] += (this.random() - 0.5) * this.wanderRate[index] * 2.2 * STEP * 10;
      const rushFade = rushing ? 0.3 : 1;
      steerX += (forces.separationX * 3.2 + forces.alignX * 0.8 + forces.cohesionX * 0.12) * rushFade;
      steerZ += (forces.separationZ * 3.2 + forces.alignZ * 0.8 + forces.cohesionZ * 0.12) * rushFade;
      steerX += Math.sin(this.wanderAngle[index]) * 0.55 * rushFade;
      steerZ += Math.cos(this.wanderAngle[index]) * 0.55 * rushFade;
      const edgePull = smoothstep(0.7, 1.02, Math.max(Math.abs(x) / ARENA.halfWidth, Math.abs(z) / ARENA.halfDepth));
      steerX -= (x / ARENA.halfWidth) * (0.05 + 3 * edgePull);
      steerZ -= (z / ARENA.halfDepth) * (0.05 + 3 * edgePull);
      if (trail.active) {
        const trailX = trail.x - x;
        const trailZ = trail.z - z;
        const trailDistance = Math.sqrt(trailX * trailX + trailZ * trailZ) + 1e-4;
        if (trailDistance > FLEE_RADIUS + 2 && trailDistance < TRAIL_RANGE) {
          steerX += (trailX / trailDistance) * TRAIL_PULL;
          steerZ += (trailZ / trailDistance) * TRAIL_PULL;
        }
      }
    }
    if (panicked) {
      steerX = fleeX * 3 + this.forwardX[index] * 0.6;
      steerZ = fleeZ * 3 + this.forwardZ[index] * 0.6;
      if (fleeX === 0 && fleeZ === 0) {
        steerX = this.forwardX[index];
        steerZ = this.forwardZ[index];
      }
    }

    let targetSpeed;
    let turnRate = WALK_TURN_RATE;
    if (panicked) {
      targetSpeed = this.fleeSpeed[index];
      turnRate = FLEE_TURN_RATE;
    } else if (rushing) {
      targetSpeed = this.rushSpeed[index];
    } else if (this.mode[index] === MODE_PAUSE) {
      targetSpeed = 0;
      turnRate *= 0.4;
    } else if (this.mode[index] === MODE_DART) {
      targetSpeed = this.baseSpeed[index] * 2.1;
      turnRate = DART_TURN_RATE;
    } else {
      targetSpeed = this.baseSpeed[index];
    }

    const desiredHeading = Math.atan2(steerX, steerZ);
    const error = wrapAngle(desiredHeading - this.heading[index]);
    const maxTurn = turnRate * STEP;
    this.heading[index] += Math.max(-maxTurn, Math.min(maxTurn, error));
    // A roach that is turning hard slows down; one facing where it wants to go keeps its speed.
    const alignment = Math.max(0, Math.cos(error));
    const goalSpeed = targetSpeed * (panicked ? 0.6 + 0.4 * alignment : 0.45 + 0.55 * alignment);
    const speedChange = goalSpeed - this.speed[index];
    this.speed[index] += Math.max(-BRAKING * STEP, Math.min(ACCELERATION * STEP, speedChange));

    this.forwardX[index] = Math.sin(this.heading[index]);
    this.forwardZ[index] = Math.cos(this.heading[index]);
    const travelled = this.speed[index] * STEP;
    this.x[index] += this.forwardX[index] * travelled;
    this.z[index] += this.forwardZ[index] * travelled;
    if (this.entered[index]) {
      this.rushRemaining[index] -= rushing ? travelled : 0;
      this.x[index] = Math.max(-ARENA.halfWidth - 0.5, Math.min(ARENA.halfWidth + 0.5, this.x[index]));
      this.z[index] = Math.max(-ARENA.halfDepth - 0.5, Math.min(ARENA.halfDepth + 0.5, this.z[index]));
    }
    this.advanceGait(index, travelled);
    return startedFleeing;
  }

  /** Gait phase follows distance over stride, so feet do not slide; a stopped roach settles onto all six feet. */
  advanceGait(index, travelled) {
    const speed = this.speed[index];
    this.sprintMix[index] = smoothstep(SPRINT_BLEND_FROM, SPRINT_BLEND_TO, speed);
    if (speed > 0.15) {
      const stride = (this.strides.walk + (this.strides.sprint - this.strides.walk) * this.sprintMix[index]) * this.scale[index];
      this.phase[index] = (this.phase[index] + travelled / stride) % 1;
      return;
    }
    const phase = this.phase[index];
    let goal = STANDING_PHASES[0];
    let goalDistance = Infinity;
    for (const standing of STANDING_PHASES) {
      for (const wrapped of [standing - 1, standing, standing + 1]) {
        if (Math.abs(wrapped - phase) < goalDistance) {
          goalDistance = Math.abs(wrapped - phase);
          goal = wrapped;
        }
      }
    }
    const move = Math.min(goalDistance, STANDING_PHASE_RATE * STEP);
    this.phase[index] = ((phase + Math.sign(goal - phase) * move) % 1 + 1) % 1;
  }

  closeBin() {
    let fleeing = 0;
    let litInside = 0;
    const beam = beamAt((this.stepCount - 1) * STEP);
    for (let index = 0; index < this.count; index++) {
      if (this.panicTimer[index] > 0) fleeing += 1;
      const offsetX = this.x[index] - beam.x;
      const offsetZ = this.z[index] - beam.z;
      if (beam.intensity > 0.5 && offsetX * offsetX + offsetZ * offsetZ < POOL_RADIUS * POOL_RADIUS) litInside += 1;
    }
    this.bins.push({
      time: Math.round(this.stepCount * STEP * 100) / 100,
      started: this.binStarted,
      fleeing,
      entering: this.binEntering,
      litInside,
    });
    this.binStarted = 0;
    this.binEntering = 0;
  }

  /** Writes the instance buffers: placement (x, z, heading, scale) and gait (phase, sprint mix, shade). */
  writeInstances(placement, gait) {
    for (let index = 0; index < this.count; index++) {
      placement[index * 4] = this.x[index];
      placement[index * 4 + 1] = this.z[index];
      placement[index * 4 + 2] = this.heading[index];
      placement[index * 4 + 3] = this.scale[index];
      gait[index * 4] = this.phase[index];
      gait[index * 4 + 1] = this.sprintMix[index];
      gait[index * 4 + 2] = this.shade[index];
    }
  }

  /** Scatter events up to a time, for the sound pass: when the beam first hits, then counts per 0.1 s. */
  eventsUntil(time) {
    this.reset();
    this.advanceTo(time);
    const peak = this.bins.reduce((best, bin) => (bin.fleeing > best.fleeing ? bin : best), { fleeing: 0, time: null });
    return {
      count: this.count,
      beamOnTime: BEAM_ON_TIME,
      firstHitTime: this.firstHitTime,
      peakFleeing: peak.fleeing,
      peakFleeingTime: peak.time,
      bins: this.bins.slice(),
    };
  }
}
