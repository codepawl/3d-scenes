// Locomotion target layer: walking and sprinting, blended over the idle by how fast the roach moves.
// Alternating tripod: L1 R2 L3 step together, then R1 L2 R3. Gait phase advances with distance over stride
// length, so feet do not slide at any speed. At top speed the body pitches nose-up and rises, and the front legs,
// then the middle legs, leave the ground (Full & Tu 1991: four- then two-legged running above 1 m/s).
// Logs every footfall and lift-off for the sound pass.
import { STEP_SECONDS } from './physics.js';

const DEGREE = Math.PI / 180;

export const TRIPOD_A = ['L1', 'R2', 'L3'];

// Rig units (glTF space; the body is about 5.3 units long). A stride is one full cycle of one leg.
const WALK_STRIDE = 2.4;
const SPRINT_STRIDE = 5.2;
const STANCE_FRACTION = 0.55;
/** Stride in rig units for a given share of bipedal running. */
export function strideFor(bipedal) {
  return WALK_STRIDE + (SPRINT_STRIDE - WALK_STRIDE) * bipedal;
}

const STEP_HEIGHT = 0.5;
// Share of the foot's fore-aft travel made by the hip swing; the knee stroke makes the rest.
const HIP_SHARE = 0.6;
// Femur-tibia excursion per stride (Watson & Ritzmann 1998, running P. americana: middle 26 deg, hind 52 deg; the
// front leg is not reported, 20 deg is a guess). Sign: hind and middle legs touch down flexed and push by
// extending; the front legs reach forward extended and pull by flexing.
const KNEE_EXCURSION = {
  1: { femurTibia: 20 * DEGREE, sign: -1 },
  2: { femurTibia: 26 * DEGREE, sign: 1 },
  3: { femurTibia: 52 * DEGREE, sign: 1 },
};

function smoothstep(value) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

export class WalkLayer {
  constructor(motion) {
    this.motion = motion;
    this.reset();
  }

  reset() {
    this.phase = 0;
    this.planted = new Map();
  }

  /** Foot offset of one leg at a cycle phase: forward and lift in rig units, and whether it is on the ground. */
  footAt(cyclePhase, stride) {
    const cycle = cyclePhase - Math.floor(cyclePhase);
    if (cycle < STANCE_FRACTION) {
      const progress = cycle / STANCE_FRACTION;
      return { forward: stride * (0.5 - progress), lift: 0, planted: true, swing: 0 };
    }
    const progress = (cycle - STANCE_FRACTION) / (1 - STANCE_FRACTION);
    return {
      forward: stride * (smoothstep(progress) - 0.5),
      lift: STEP_HEIGHT * Math.sin(Math.PI * progress),
      planted: false,
      swing: Math.sin(Math.PI * progress),
    };
  }

  setTargets(time, moving) {
    const motion = this.motion;
    const bipedal = motion.bipedal;
    const stride = mix(WALK_STRIDE, SPRINT_STRIDE, bipedal);
    this.phase += (motion.speed / stride) * STEP_SECONDS;
    if (moving <= 0) return;

    let touchdowns = 0;
    for (const leg of motion.legs) {
      const offset = TRIPOD_A.includes(leg.key) ? 0 : 0.5;
      // In the sprint the front pair lifts off first, the middle pair follows at full bipedal.
      const airborne = leg.pair === 1 ? smoothstep(bipedal * 2) : leg.pair === 2 ? smoothstep(bipedal * 2 - 1) : 0;
      const foot = this.footAt(this.phase + offset, stride);
      const grounded = foot.planted && airborne < 0.5;
      const wasPlanted = this.planted.get(leg.key) ?? true;
      if (grounded && !wasPlanted && moving > 0.3) {
        touchdowns += 1;
        motion.logEvent('footfall', time, { leg: leg.key, speed: Math.round(motion.speed * 10) / 10, bipedal: Math.round(bipedal * 100) / 100 });
      }
      if (!grounded && wasPlanted && moving > 0.3) motion.logEvent('foot-lift', time, { leg: leg.key });
      this.planted.set(leg.key, grounded);

      // Watson & Ritzmann 1998: the hip joint moves little; the stroke comes from the coxa-femur and femur-tibia
      // joints extending in stance and flexing in swing. The hip carries only part of the foot's travel here, and
      // the knee carries the rest. cycleShare runs +0.5 at touchdown to -0.5 at lift-off, then back in the swing.
      const swingAngle = Math.atan2(foot.forward * HIP_SHARE, leg.reach);
      // Under a crevice the steps stay low and the legs reach out sideways instead of up.
      const compress = motion.flight.compress;
      const liftAngle = Math.atan2(foot.lift * (1 - 1.5 * compress), leg.reach) + compress * 24 * DEGREE;
      const cycleShare = foot.forward / stride;
      const excursion = KNEE_EXCURSION[leg.pair];
      // A held leg in the air paddles a little instead of freezing.
      const paddle = Math.sin(this.phase * 2 * Math.PI + leg.pair) * 14 * DEGREE * airborne;
      const walkSwing = swingAngle * (1 - airborne * 0.6) + paddle;
      const walkLift = liftAngle * (1 - airborne) + airborne * 40 * DEGREE;
      leg.coxaSwing.target = mix(leg.coxaSwing.target, walkSwing, moving);
      leg.coxaLift.target = mix(leg.coxaLift.target, walkLift, moving);
      // The outer segments only get gentle targets; their springs add the follow-through and landing jolt.
      const kneeStroke = excursion.sign * excursion.femurTibia * cycleShare * (1 - airborne);
      leg.femurLift.target = mix(leg.femurLift.target, liftAngle * 0.35 + airborne * 10 * DEGREE, moving);
      leg.tibiaFlex.target = mix(leg.tibiaFlex.target, kneeStroke + foot.swing * 12 * DEGREE * (1 - airborne) + airborne * 34 * DEGREE, moving);
      leg.tarsusFlex.target = mix(leg.tarsusFlex.target, foot.swing * 12 * DEGREE, moving);
    }

    // Body: a side sway with each tripod, a dip on every touchdown that the bob spring turns into a bounce, and
    // the sprint's nose-up pitch with the body raised so the hind feet stay on the ground.
    // Amplitudes from running cockroaches (Weihmann et al. 2017, N. cinerea, peak to peak): lateral about 0.06
    // body lengths, yaw 7-8 deg, pitch 5-7 deg. One sway per stride, as each tripod pushes from its own side.
    const strideWave = Math.sin(this.phase * 2 * Math.PI);
    const quadrupedal = 1 - bipedal;
    motion.bodyRoll.target = mix(motion.bodyRoll.target, strideWave * 2.5 * DEGREE * quadrupedal, moving);
    motion.bodyYaw.target = mix(motion.bodyYaw.target, Math.cos(this.phase * 2 * Math.PI) * 3.7 * DEGREE * quadrupedal, moving);
    motion.bodySway.target = mix(motion.bodySway.target, strideWave * 0.16 * quadrupedal, moving);
    motion.bodyPitch.target = mix(motion.bodyPitch.target, bipedal * 15 * DEGREE, moving);
    if (touchdowns > 0) motion.bodyBob.velocity -= 4.5 * touchdowns * (0.6 + motion.speed / 20);
    motion.bodyBob.target = mix(motion.bodyBob.target, bipedal * 0.3, moving);

    // Head steady and level; antennae swept back and out, more at speed. Their springs whip with the bounce.
    motion.headYaw.target = mix(motion.headYaw.target, 0, moving);
    motion.headPitch.target = mix(motion.headPitch.target, -bipedal * 6 * DEGREE, moving);
    const sweepBack = (10 + 22 * Math.min(motion.speed / 20, 1)) * DEGREE;
    for (const [side, antenna] of Object.entries(motion.antennae)) {
      const sideSign = side === 'L' ? 1 : -1;
      antenna.baseYaw.target = mix(antenna.baseYaw.target, sideSign * sweepBack, moving);
      antenna.basePitch.target = mix(antenna.basePitch.target, -4 * DEGREE, moving);
    }
  }
}
