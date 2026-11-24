// Procedural walking. The body chases a target with inertia; the feet stay planted in the world and
// step, one tripod at a time, when they drift too far from where they belong under the moving body.
import * as THREE from "three";
import { clamp, lerp, moveToward, smoothstep, createSpring, stepSpring, wrapAngle, servoEase } from "./math.js";
import { solveLegAngles, applyLegAngles } from "./ik.js";

// Distances are in model units and tuned for the contract's size: 3-unit leg span, 0.9 clearance.
const GAIT = {
  maximumSpeed: 0.9,
  maximumTurnRate: 0.55,
  acceleration: 1.2,
  turnAcceleration: 1.5,
  arriveRadius: 0.45,
  slowRadius: 1.5,
  stepThreshold: 0.42,
  restingStepThreshold: 0.1,
  launchThresholdFactor: 0.35,
  minimumStepError: 0.06,
  maximumLead: 0.62,
  leadSeconds: 0.3,
  slowStepDuration: 0.4,
  fastStepDuration: 0.3,
  legStaggerFraction: 0.13,
  groupGapFactor: 1.75,
  liftClearance: 0.36,
  curlAngle: 0.6,
  plantJolt: 0.2,
  liftSag: 0.07,
  plantTilt: 0.12,
  tiltFollow: 0.75,
  // Kept above the plant jolt (about 0.07), which briefly drops the body below its goal height.
  bellyMargin: 0.24,
  swayAmount: 0.035,
};

// A step is staged like a machine cycle: hoist the foot, swing it across, then drive it down.
const STEP_PHASES = { liftEnd: 0.3, swingStart: 0.16, swingEnd: 0.8, dropStart: 0.7 };
const FOOTING_NUDGES = [0, 0.17, -0.17];
const FLAT_ENOUGH = 0.8;

function easeOutCubic(amount) {
  const remaining = 1 - amount;
  return 1 - remaining * remaining * remaining;
}

export function createWalker({ rig, sampleGround }) {
  const root = new THREE.Group();
  root.name = "WalkerRoot";
  root.add(rig.root);

  const bodyRestPosition = rig.body.position.clone();
  const bodyRestQuaternion = rig.body.quaternion.clone();
  const motion = { position: new THREE.Vector3(), heading: 0, speed: 0, turnRate: 0 };
  const target = new THREE.Vector3();
  const pose = {
    height: createSpring(rig.bodyRestHeight),
    pitch: createSpring(),
    roll: createSpring(),
    sway: createSpring(),
  };
  const legs = rig.legs.map((rigLeg) => ({
    rig: rigLeg,
    footPosition: new THREE.Vector3(),
    supportHeight: 0,
    step: null,
    curl: 0,
  }));
  const gait = { lastSteppedGroup: 0, lastGroupStartTime: -Infinity, isTravelling: false, isLaunching: false };
  let events = [];

  const scratchHome = new THREE.Vector3();
  const currentHome = new THREE.Vector3();
  const predictedHome = new THREE.Vector3();
  const predictedPosition = new THREE.Vector3();
  const lead = new THREE.Vector3();
  const footInHipSpace = new THREE.Vector3();
  const tiltEuler = new THREE.Euler();
  const tiltQuaternion = new THREE.Quaternion();

  // Where a leg's foot belongs for a given body position and heading.
  function homePositionAt(leg, position, heading, result) {
    const cosine = Math.cos(heading);
    const sine = Math.sin(heading);
    const offset = leg.rig.homeOffset;
    result.x = position.x + offset.x * cosine + offset.z * sine;
    result.y = 0;
    result.z = position.z - offset.x * sine + offset.z * cosine;
    return result;
  }

  function footError(leg) {
    homePositionAt(leg, motion.position, motion.heading, scratchHome);
    return Math.hypot(leg.footPosition.x - scratchHome.x, leg.footPosition.z - scratchHome.z);
  }

  // Raycast for a landing spot; a foot aimed at a slope tries a little ahead and behind for flatter ground.
  function findFooting(x, z, directionX, directionZ, result) {
    let bestFlatness = -1;
    for (const nudge of FOOTING_NUDGES) {
      const candidateX = x + directionX * nudge;
      const candidateZ = z + directionZ * nudge;
      const ground = sampleGround(candidateX, candidateZ);
      if (ground.flatness > bestFlatness) {
        bestFlatness = ground.flatness;
        result.set(candidateX, ground.height, candidateZ);
      }
      if (ground.flatness >= FLAT_ENOUGH) {
        break;
      }
    }
    return result;
  }

  function highestGroundBetween(from, to) {
    let highest = Math.max(from.y, to.y);
    for (const amount of [0.25, 0.5, 0.75]) {
      const ground = sampleGround(lerp(from.x, to.x, amount), lerp(from.z, to.z, amount));
      highest = Math.max(highest, ground.height);
    }
    return highest;
  }

  function beginStep(leg, time, delay, duration) {
    // Aim at where the foot's home will be shortly after it lands, so it lands ahead of the body.
    const leadSeconds = delay + duration + GAIT.leadSeconds;
    const travelHeading = motion.heading + motion.turnRate * leadSeconds * 0.5;
    predictedPosition.x = motion.position.x + Math.sin(travelHeading) * motion.speed * leadSeconds;
    predictedPosition.z = motion.position.z + Math.cos(travelHeading) * motion.speed * leadSeconds;
    homePositionAt(leg, motion.position, motion.heading, currentHome);
    homePositionAt(leg, predictedPosition, motion.heading + motion.turnRate * leadSeconds, predictedHome);
    lead.subVectors(predictedHome, currentHome);
    const leadLength = lead.length();
    let directionX = 0;
    let directionZ = 0;
    if (leadLength > 0.0001) {
      directionX = lead.x / leadLength;
      directionZ = lead.z / leadLength;
    }
    if (leadLength > GAIT.maximumLead) {
      lead.multiplyScalar(GAIT.maximumLead / leadLength);
    }
    const from = leg.footPosition.clone();
    const landing = findFooting(currentHome.x + lead.x, currentHome.z + lead.z, directionX, directionZ, new THREE.Vector3());
    leg.step = {
      from,
      to: landing,
      apexHeight: highestGroundBetween(from, landing) + GAIT.liftClearance,
      startTime: time + delay,
      duration,
      hasLifted: false,
    };
  }

  function stepDemand() {
    const speedShare = Math.abs(motion.speed) / GAIT.maximumSpeed;
    const turnShare = Math.abs(motion.turnRate) / GAIT.maximumTurnRate;
    return clamp(speedShare + turnShare, 0, 1);
  }

  function beginGroupStep(members, group, time) {
    const duration = lerp(GAIT.slowStepDuration, GAIT.fastStepDuration, stepDemand());
    let order = 0;
    for (const leg of members) {
      if (footError(leg) < GAIT.minimumStepError) {
        continue;
      }
      beginStep(leg, time, order * duration * GAIT.legStaggerFraction, duration);
      order += 1;
    }
    gait.lastSteppedGroup = group;
    gait.lastGroupStartTime = time;
    gait.isLaunching = false;
    events.push({ type: "groupLift", group });
  }

  // One tripod at a time: a group may lift only while the other three feet are all planted.
  function updateGait(time) {
    if (legs.some((leg) => leg.step)) {
      return;
    }
    const isMoving = Math.abs(motion.speed) > 0.04 || Math.abs(motion.turnRate) > 0.04;
    let threshold = isMoving ? GAIT.stepThreshold : GAIT.restingStepThreshold;
    if (isMoving && gait.isLaunching) {
      // Leaving a standstill, the first tripod goes early so the two groups end up half a cycle apart.
      threshold = GAIT.stepThreshold * GAIT.launchThresholdFactor;
    }
    const expectedDuration = lerp(GAIT.slowStepDuration, GAIT.fastStepDuration, stepDemand());
    if (isMoving && time - gait.lastGroupStartTime < expectedDuration * GAIT.groupGapFactor) {
      return;
    }
    const nextGroup = 1 - gait.lastSteppedGroup;
    for (const group of [nextGroup, gait.lastSteppedGroup]) {
      const members = legs.filter((leg) => leg.rig.group === group);
      const worstError = Math.max(...members.map(footError));
      if (worstError > threshold) {
        beginGroupStep(members, group, time);
        return;
      }
    }
  }

  function applyPlantImpulse(leg) {
    pose.height.velocity -= GAIT.plantJolt;
    pose.pitch.velocity += Math.sign(leg.rig.homeOffset.z) * GAIT.plantTilt;
    pose.roll.velocity -= Math.sign(leg.rig.homeOffset.x) * GAIT.plantTilt;
  }

  function finishStep(leg) {
    // How far the foot drove down onto its landing spot; the sound track scales the impact by it.
    const dropHeight = leg.step.apexHeight - leg.step.to.y;
    leg.footPosition.copy(leg.step.to);
    leg.supportHeight = leg.footPosition.y;
    leg.curl = 0;
    leg.step = null;
    applyPlantImpulse(leg);
    events.push({ type: "plant", legName: leg.rig.name, position: leg.footPosition.clone(), dropHeight });
  }

  function moveSteppingFoot(leg, progress) {
    const step = leg.step;
    const lift = easeOutCubic(clamp(progress / STEP_PHASES.liftEnd, 0, 1));
    const dropAmount = clamp((progress - STEP_PHASES.dropStart) / (1 - STEP_PHASES.dropStart), 0, 1);
    // The drop accelerates into the ground and stops dead: no easing out at contact.
    const raise = lift * (1 - dropAmount * dropAmount);
    const swingAmount = (progress - STEP_PHASES.swingStart) / (STEP_PHASES.swingEnd - STEP_PHASES.swingStart);
    const swing = servoEase(swingAmount);
    leg.footPosition.lerpVectors(step.from, step.to, swing);
    leg.supportHeight = leg.footPosition.y;
    leg.footPosition.y = lerp(leg.footPosition.y, step.apexHeight, raise);
    // The tarsus folds in during the hoist and snaps back out just before contact.
    const fold = smoothstep(0, STEP_PHASES.liftEnd, progress);
    const unfold = smoothstep(STEP_PHASES.dropStart, 0.95, progress);
    leg.curl = fold * (1 - unfold);
  }

  function advanceSteps(time) {
    for (const leg of legs) {
      if (!leg.step) {
        continue;
      }
      const progress = (time - leg.step.startTime) / leg.step.duration;
      if (progress <= 0) {
        continue;
      }
      if (!leg.step.hasLifted) {
        leg.step.hasLifted = true;
        pose.height.velocity -= GAIT.liftSag;
        events.push({ type: "lift", legName: leg.rig.name });
      }
      if (progress >= 1) {
        finishStep(leg);
        continue;
      }
      moveSteppingFoot(leg, progress);
    }
  }

  // Slows the body when planted feet are being dragged out of reach, for example mid-climb.
  function gaitLimit() {
    let worstError = 0;
    for (const leg of legs) {
      if (!leg.step) {
        worstError = Math.max(worstError, footError(leg));
      }
    }
    return 1 - clamp((worstError - GAIT.stepThreshold * 1.5) / GAIT.stepThreshold, 0, 0.9);
  }

  function steer(deltaSeconds) {
    const offsetX = target.x - motion.position.x;
    const offsetZ = target.z - motion.position.z;
    const distance = Math.hypot(offsetX, offsetZ);
    const wasTravelling = gait.isTravelling;
    // Hysteresis: once arrived, the target has to move clearly away before the spider sets off again.
    const departRadius = wasTravelling ? GAIT.arriveRadius : GAIT.arriveRadius * 1.6;
    gait.isTravelling = distance > departRadius;
    if (gait.isTravelling && !wasTravelling) {
      gait.isLaunching = true;
    }

    let desiredSpeed = 0;
    let desiredTurnRate = 0;
    if (gait.isTravelling) {
      const headingError = wrapAngle(Math.atan2(offsetX, offsetZ) - motion.heading);
      const alignment = Math.max(0, Math.cos(headingError));
      const approach = Math.max(0.3, Math.min(1, distance / GAIT.slowRadius));
      // Facing the wrong way it pivots on the spot; it only strides out once it is roughly lined up.
      desiredSpeed = GAIT.maximumSpeed * approach * alignment * alignment * alignment;
      desiredTurnRate = clamp(headingError * 2.2, -GAIT.maximumTurnRate, GAIT.maximumTurnRate);
    }
    const limit = gaitLimit();
    motion.speed = moveToward(motion.speed, desiredSpeed * limit, GAIT.acceleration * deltaSeconds);
    motion.turnRate = moveToward(motion.turnRate, desiredTurnRate * limit, GAIT.turnAcceleration * deltaSeconds);
    motion.heading = wrapAngle(motion.heading + motion.turnRate * deltaSeconds);
    motion.position.x += Math.sin(motion.heading) * motion.speed * deltaSeconds;
    motion.position.z += Math.cos(motion.heading) * motion.speed * deltaSeconds;
  }

  function highestGroundUnderBelly() {
    let highest = 0;
    for (const along of [-1, 0, 1]) {
      const distance = along * rig.hullHalfLength * 0.85 + motion.speed * 0.3;
      const sampleX = motion.position.x + Math.sin(motion.heading) * distance;
      const sampleZ = motion.position.z + Math.cos(motion.heading) * distance;
      highest = Math.max(highest, sampleGround(sampleX, sampleZ).height);
    }
    return highest;
  }

  // The body rides the plane through its feet: mean height, plus pitch and roll from a least-squares fit.
  function updateBodyPose(deltaSeconds) {
    let meanHeight = 0;
    for (const leg of legs) {
      meanHeight += leg.supportHeight / legs.length;
    }
    let pitchMoment = 0;
    let pitchArm = 0;
    let rollMoment = 0;
    let rollArm = 0;
    for (const leg of legs) {
      const rise = leg.supportHeight - meanHeight;
      const offset = leg.rig.homeOffset;
      pitchMoment += rise * offset.z;
      pitchArm += offset.z * offset.z;
      rollMoment += rise * offset.x;
      rollArm += offset.x * offset.x;
    }
    const pitchGoal = -Math.atan(pitchMoment / pitchArm) * GAIT.tiltFollow;
    const rollGoal = Math.atan(rollMoment / rollArm) * GAIT.tiltFollow;
    const ridingHeight = meanHeight + rig.bodyRestHeight;
    const clearingHeight = highestGroundUnderBelly() + rig.bellyDrop + GAIT.bellyMargin;

    // The weight shifts over whichever tripod is carrying it.
    const swingingLeg = legs.find((leg) => leg.step && leg.step.hasLifted);
    let swayGoal = 0;
    if (swingingLeg) {
      swayGoal = swingingLeg.rig.group === 1 ? -GAIT.swayAmount : GAIT.swayAmount;
    }
    stepSpring(pose.height, Math.max(ridingHeight, clearingHeight), 60, 10, deltaSeconds);
    stepSpring(pose.pitch, pitchGoal, 45, 9, deltaSeconds);
    stepSpring(pose.roll, rollGoal, 45, 9, deltaSeconds);
    stepSpring(pose.sway, swayGoal, 30, 8, deltaSeconds);
  }

  function poseLeg(leg) {
    footInHipSpace.copy(leg.footPosition);
    leg.rig.coxa.parent.worldToLocal(footInHipSpace);
    const hip = leg.rig.coxa.position;
    const reach = Math.hypot(footInHipSpace.x - hip.x, footInHipSpace.z - hip.z);
    const stretchLean = clamp(leg.rig.restLean + (reach - leg.rig.restReach) * 0.35, -0.45, 0.6);
    const tarsusLean = stretchLean - leg.curl * GAIT.curlAngle;
    applyLegAngles(leg.rig, solveLegAngles(hip, footInHipSpace, leg.rig.lengths, tarsusLean));
  }

  function applyPose() {
    root.position.set(motion.position.x, 0, motion.position.z);
    root.rotation.y = motion.heading;
    rig.body.position.copy(bodyRestPosition);
    rig.body.position.x += pose.sway.value;
    rig.body.position.y += pose.height.value - rig.bodyRestHeight;
    tiltQuaternion.setFromEuler(tiltEuler.set(pose.pitch.value, 0, pose.roll.value));
    rig.body.quaternion.copy(bodyRestQuaternion).multiply(tiltQuaternion);
    root.updateMatrixWorld(true);
    legs.forEach(poseLeg);
    root.updateMatrixWorld(true);
  }

  function plantAllFeet() {
    let meanHeight = 0;
    for (const leg of legs) {
      if (leg.step) {
        leg.footPosition.copy(leg.step.to);
      }
      leg.step = null;
      leg.curl = 0;
      leg.footPosition.y = sampleGround(leg.footPosition.x, leg.footPosition.z).height;
      leg.supportHeight = leg.footPosition.y;
      meanHeight += leg.supportHeight / legs.length;
    }
    return meanHeight;
  }

  function worldPositionOf(node) {
    return node.getWorldPosition(new THREE.Vector3()).toArray();
  }

  return {
    root,
    motion,
    target,

    setTarget(x, z) {
      target.set(x, 0, z);
    },

    // Puts the spider down at rest, feet on their home spots.
    placeAt(x, z, heading) {
      motion.position.set(x, 0, z);
      motion.heading = heading;
      motion.speed = 0;
      motion.turnRate = 0;
      target.set(x, 0, z);
      gait.isTravelling = false;
      gait.lastGroupStartTime = -Infinity;
      for (const leg of legs) {
        leg.step = null;
        homePositionAt(leg, motion.position, motion.heading, leg.footPosition);
      }
      const meanHeight = plantAllFeet();
      for (const spring of Object.values(pose)) {
        spring.value = 0;
        spring.velocity = 0;
      }
      pose.height.value = meanHeight + rig.bodyRestHeight;
      events = [];
      applyPose();
    },

    // The ground changed under it (obstacles shown or hidden): drop every foot onto what is there now.
    settleOnGround() {
      plantAllFeet();
      applyPose();
    },

    update(deltaSeconds, time) {
      steer(deltaSeconds);
      updateGait(time);
      advanceSteps(time);
      updateBodyPose(deltaSeconds);
      applyPose();
    },

    drainEvents() {
      const drained = events;
      events = [];
      return drained;
    },

    distanceToTarget() {
      return Math.hypot(target.x - motion.position.x, target.z - motion.position.z);
    },

    snapshot() {
      const hullBottom = rig.body.getWorldPosition(new THREE.Vector3()).y - rig.bellyDrop;
      return {
        position: [motion.position.x, motion.position.z],
        heading: motion.heading,
        speed: motion.speed,
        turnRate: motion.turnRate,
        bodyHeight: pose.height.value,
        pitch: pose.pitch.value,
        roll: pose.roll.value,
        bellyClearance: hullBottom - highestGroundUnderBelly(),
        restBellyHeight: rig.bellyHeight,
        legs: legs.map((leg) => ({
          name: leg.rig.name,
          group: leg.rig.group,
          isStepping: Boolean(leg.step && leg.step.hasLifted),
          foot: leg.footPosition.toArray(),
          tip: worldPositionOf(leg.rig.tip),
          hip: worldPositionOf(leg.rig.coxa),
          knee: worldPositionOf(leg.rig.tibia),
          ankle: worldPositionOf(leg.rig.tarsus),
        })),
      };
    },
  };
}
