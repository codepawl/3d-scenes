// Idle target layer for a resting cockroach. Targets dart and hold (insects move in quick jumps, then stop);
// the springs in motion.js make each move overshoot and settle. Includes antennae searching and flicking, palps
// tapping, the abdomen pumping, single legs tapping down to shift weight, and grooming bouts where a foreleg and
// the mouthparts pull one antenna through, base to tip. Logs the actions that make a sound.
import { RIG_LAYOUT } from './rig.js';
import { dartSchedule, heldValue } from './physics.js';

const DEGREE = Math.PI / 180;
const SCHEDULE_SECONDS = 120;

function smoothPulse(time, start, rise, hold, fall) {
  if (time < start || time > start + rise + hold + fall) return 0;
  const local = time - start;
  const ease = (value) => value * value * (3 - 2 * value);
  if (local < rise) return ease(local / rise);
  if (local < rise + hold) return 1;
  return ease(1 - (local - rise - hold) / fall);
}

/** The value of the pulse an event started, while it lasts `length` seconds; 0 otherwise. */
function insidePulse(events, time, length) {
  for (const event of events) {
    // The schedule's first event at time 0 only seeds held targets; it is not an action.
    if (event.time === 0) continue;
    if (event.time > time) break;
    if (time - event.time < length) return event.value;
  }
  return 0;
}

// Grooming bouts: [start time, side]. Spaced so they do not look scheduled.
const GROOMING_BOUTS = [
  [2.4, 'L'],
  [11.8, 'R'],
  [19.5, 'L'],
];
const GROOM_RISE = 0.35;
const GROOM_HOLD = 2.2;
const GROOM_FALL = 0.45;

export class IdleLayer {
  constructor(motion, seed) {
    this.motion = motion;
    this.seed = seed;
    this.previous = new Map();
    this.buildSchedules();
  }

  buildSchedules() {
    const seed = this.seed;
    const signed = (range) => (random) => (random() * 2 - 1) * range;
    this.headDarts = {
      yaw: dartSchedule(seed + 1, SCHEDULE_SECONDS, 0.8, 2.6, signed(7 * DEGREE)),
      pitch: dartSchedule(seed + 2, SCHEDULE_SECONDS, 0.9, 2.8, signed(3 * DEGREE)),
    };
    this.antennaDarts = {};
    for (const [side, offset] of [['L', 10], ['R', 20]]) {
      this.antennaDarts[side] = {
        yaw: dartSchedule(seed + offset, SCHEDULE_SECONDS, 0.3, 1.4, signed(26 * DEGREE)),
        pitch: dartSchedule(seed + offset + 1, SCHEDULE_SECONDS, 0.35, 1.5, (random) => (-14 + 17 * random()) * DEGREE),
        // A flick: a short sharp jab of the base that springs back.
        flicks: dartSchedule(seed + offset + 2, SCHEDULE_SECONDS, 0.9, 3.5, (random) => (random() < 0.5 ? -1 : 1) * (8 + 8 * random()) * DEGREE),
        tremor: dartSchedule(seed + offset + 3, SCHEDULE_SECONDS, 0.04, 0.11, signed(0.6 * DEGREE)),
      };
    }
    this.palpTaps = {
      L: dartSchedule(seed + 30, SCHEDULE_SECONDS, 0.1, 0.45, (random) => (random() < 0.55 ? 1 : 0)),
      R: dartSchedule(seed + 31, SCHEDULE_SECONDS, 0.1, 0.45, (random) => (random() < 0.55 ? 1 : 0)),
      fast: dartSchedule(seed + 32, SCHEDULE_SECONDS, 0.05, 0.12, (random) => (random() < 0.6 ? 1 : 0)),
    };
    this.pumps = dartSchedule(seed + 50, SCHEDULE_SECONDS, 1.0, 1.9, (random) => 0.6 + 0.4 * random());
    this.scrubs = dartSchedule(seed + 60, SCHEDULE_SECONDS, 0.06, 0.13, signed(1));
    this.legShifts = this.motion.legs.map((leg, index) => ({
      taps: dartSchedule(seed + 70 + index, SCHEDULE_SECONDS, 2.5, 7, () => 1),
      placements: dartSchedule(seed + 70 + index, SCHEDULE_SECONDS, 2.5, 7, signed(5 * DEGREE)),
    }));
  }

  /** Log an action the first step a value turns on, while the roach is resting. */
  logOnRise(key, value, type, time, details) {
    // Keys start "on" so a state that is already true at time 0 (a planted foot) does not log.
    const was = this.previous.get(key) ?? 1;
    this.previous.set(key, value);
    if (value > 0 && was <= 0 && this.motion.moving < 0.2 && this.motion.flight.airborne < 0.2) this.motion.logEvent(type, time, details);
  }

  groomAmount(time, side) {
    let amount = 0;
    for (const [start, boutSide] of GROOMING_BOUTS) {
      if (boutSide === side) amount = Math.max(amount, smoothPulse(time, start, GROOM_RISE, GROOM_HOLD, GROOM_FALL));
    }
    return amount;
  }

  /** Where the pull runs along the antenna during a bout, 0 = base, 1 = tip; -1 outside a bout. */
  groomProgress(time, side) {
    for (const [start, boutSide] of GROOMING_BOUTS) {
      const local = time - start - GROOM_RISE;
      if (boutSide === side && local >= 0 && local <= GROOM_HOLD) return local / GROOM_HOLD;
    }
    return -1;
  }

  setTargets(time) {
    const motion = this.motion;
    // Idle habits (grooming, darts, leg shifts) belong to a roach standing still: they fade when it walks or flies.
    const rest = (1 - motion.moving) * (1 - motion.flight.airborne);
    const groom = { L: this.groomAmount(time, 'L') * rest, R: this.groomAmount(time, 'R') * rest };
    const groomAny = Math.max(groom.L, groom.R);

    motion.headYaw.target = heldValue(this.headDarts.yaw, time) * (1 - groomAny) + (groom.L - groom.R) * 14 * DEGREE;
    motion.headPitch.target = heldValue(this.headDarts.pitch, time) + groomAny * 16 * DEGREE;
    const pump = insidePulse(this.pumps, time, 0.35);
    motion.abdomen.target = pump;
    this.logOnRise('pump', pump, 'abdomen-pump', time);

    for (const side of RIG_LAYOUT.SIDES) this.setAntennaTargets(side, time, groom[side]);
    this.setPalpTargets(time, groomAny);
    this.setLegTargets(time, groom);
  }

  setAntennaTargets(side, time, groom) {
    const antenna = this.motion.antennae[side];
    const darts = this.antennaDarts[side];
    const sideSign = side === 'L' ? 1 : -1;
    const calm = 1 - groom;
    const flick = insidePulse(darts.flicks, time, 0.07);
    this.logOnRise(`flick-${side}`, Math.abs(flick), 'antenna-flick', time, { side });
    antenna.baseYaw.target = (sideSign * heldValue(darts.yaw, time) + flick) * calm - sideSign * 35 * DEGREE * groom;
    antenna.basePitch.target = heldValue(darts.pitch, time) * calm - 55 * DEGREE * groom;

    const progress = this.groomProgress(time, side);
    const count = antenna.segments.length;
    antenna.chain.forEach((joints, index) => {
      if (index === 0) return;
      const along = index / (count - 1);
      // A faint fast tremor at the tip keeps it alive between darts.
      const tremor = heldValue(darts.tremor, time) * along * along;
      const pull = progress < 0 ? 0 : Math.exp(-((along - progress) ** 2) / 0.012);
      joints.bend.target = joints.bend.rest + tremor - (10 + 28 * pull) * DEGREE * groom;
      joints.side.target = tremor * 0.7;
    });
  }

  setPalpTargets(time, groomAny) {
    for (const [side, palp] of Object.entries(this.motion.palps)) {
      const tap = groomAny > 0.3 ? heldValue(this.palpTaps.fast, time) : heldValue(this.palpTaps[side], time);
      this.logOnRise(`palp-${side}`, tap, 'palp-tap', time, { side, grooming: groomAny > 0.3 });
      palp.tap.target = (5 + tap * 16) * DEGREE;
      palp.sweep.target = (side === 'L' ? 1 : -1) * groomAny * 10 * DEGREE;
    }
  }

  setLegTargets(time, groom) {
    const motion = this.motion;
    let rollTarget = 0;
    motion.legs.forEach((leg, index) => {
      const shift = this.legShifts[index];
      // A tap: the leg lifts for a moment and is put down a little elsewhere.
      const lifted = insidePulse(shift.taps, time, 0.14);
      this.logOnRise(`lift-${leg.key}`, lifted, 'leg-lift', time, { leg: leg.key });
      this.logOnRise(`land-${leg.key}`, lifted > 0 ? 0 : 1, 'leg-land', time, { leg: leg.key });
      leg.coxaLift.target = lifted * 11 * DEGREE;
      leg.coxaSwing.target = heldValue(shift.placements, time);
      leg.femurLift.target = lifted * 4 * DEGREE;
      leg.tibiaFlex.target = lifted * 8 * DEGREE;
      leg.tarsusFlex.target = 0;
      // The body tips a little toward a leg that is off the ground.
      rollTarget += lifted * (leg.side === 'L' ? 1 : -1) * 0.9 * DEGREE;

      if (leg.pair !== 1) return;
      const amount = groom[leg.side];
      this.logOnRise(`groom-${leg.side}`, amount > 0.5 ? 1 : 0, 'groom-start', time, { side: leg.side });
      if (amount <= 0) return;
      // The foreleg rises and swings forward to hold the antenna, the tibia folds in, with quick scrubbing.
      const scrub = heldValue(this.scrubs, time);
      this.logOnRise(`scrub-${leg.side}`, amount > 0.5 && scrub > 0 ? 1 : 0, 'groom-scrub', time, { side: leg.side });
      leg.coxaLift.target += 30 * DEGREE * amount;
      leg.coxaSwing.target += 28 * DEGREE * amount;
      leg.femurLift.target += (20 * DEGREE + scrub * 6 * DEGREE) * amount;
      leg.tibiaFlex.target += 35 * DEGREE * amount;
      leg.tarsusFlex.target += (25 * DEGREE - scrub * 6 * DEGREE) * amount;
    });
    motion.bodyRoll.target = rollTarget;
    motion.bodyPitch.target = 0;
    motion.bodyBob.target = 0;
    motion.bodyYaw.target = 0;
    motion.bodySway.target = 0;
  }
}
