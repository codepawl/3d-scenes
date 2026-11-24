// The orbit shot that both spider demos record for the side-by-side battle video. The camera path is a
// function of the shot time only and every length is in leg spans (the distance between the outermost
// left and right resting feet), so two models of different size get the same framing and every recording
// repeats. It imports nothing: the Opus page and the Node recorders of both projects load this one file.

export const ORBIT_SHOT = {
  durationSeconds: 22,
  walkStartSeconds: 6,
  // The halt is ordered early so the spider has come to rest when the push-in starts.
  haltSeconds: 15.2,
  walkStopSeconds: 16,
  steamBurstSeconds: 17,
};

// The spider faces +Z; azimuth 0 looks straight at its face and grows toward +X.
const START_AZIMUTH_DEGREES = 24;

// Degrees per second against shot time, joined by straight ramps: half a turn around the standing spider,
// from its front around the +X flank to its rear, the same half turn back while it walks, then a short
// drift to rest during the push-in. The camera swings back instead of closing the circle because the Opus
// room has a wall with machinery 4.6 units off the track on -X; a camera 11 units out cannot pass there.
const ANGULAR_SPEED_KEYFRAMES = [
  { seconds: 0, degreesPerSecond: 30 },
  { seconds: 5.25, degreesPerSecond: 30 },
  { seconds: 6.75, degreesPerSecond: -16.5 },
  { seconds: 16, degreesPerSecond: -16.5 },
  { seconds: 17.5, degreesPerSecond: 0 },
];

const PUSH_IN = { startSeconds: 16, endSeconds: 19.5 };
// 1.65 spans of height leave the stepping legs a margin inside the battle video's nearly square panel.
const WIDE_FRAMING = { visibleHeightInSpans: 1.65, elevationDegrees: 14 };
const CLOSE_FRAMING = { visibleHeightInSpans: 0.66, elevationDegrees: 9 };

// The wide framing looks at a point this far above the ground under the body.
export const BODY_LOOK_HEIGHT_IN_SPANS = 0.3;
// How quickly the look point catches up with the spider, per second.
export const TRACKING_RATE = 6;

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function smoothstep(start, end, value) {
  const amount = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

// Area under the angular speed keyframes from the start of the shot up to `seconds`.
function orbitedDegrees(seconds) {
  let degrees = 0;
  for (let index = 1; index < ANGULAR_SPEED_KEYFRAMES.length; index++) {
    const previous = ANGULAR_SPEED_KEYFRAMES[index - 1];
    const next = ANGULAR_SPEED_KEYFRAMES[index];
    if (seconds <= previous.seconds) {
      break;
    }
    const spanEnd = Math.min(seconds, next.seconds);
    const rampAmount = (spanEnd - previous.seconds) / (next.seconds - previous.seconds);
    const speedAtSpanEnd = lerp(previous.degreesPerSecond, next.degreesPerSecond, rampAmount);
    degrees += ((previous.degreesPerSecond + speedAtSpanEnd) / 2) * (spanEnd - previous.seconds);
  }
  return degrees;
}

// `headWeight` moves the look point from the body (0) to the head (1) during the push-in.
export function orbitCameraAt(seconds) {
  const pushIn = smoothstep(PUSH_IN.startSeconds, PUSH_IN.endSeconds, seconds);
  const azimuthDegrees = START_AZIMUTH_DEGREES + orbitedDegrees(seconds);
  const elevationDegrees = lerp(WIDE_FRAMING.elevationDegrees, CLOSE_FRAMING.elevationDegrees, pushIn);
  return {
    azimuthRadians: (azimuthDegrees * Math.PI) / 180,
    elevationRadians: (elevationDegrees * Math.PI) / 180,
    visibleHeightInSpans: lerp(WIDE_FRAMING.visibleHeightInSpans, CLOSE_FRAMING.visibleHeightInSpans, pushIn),
    headWeight: pushIn,
  };
}

// Where the camera sits relative to its look point, `distance` away along the pose's direction.
export function orbitCameraOffset(pose, distance) {
  const horizontalDistance = Math.cos(pose.elevationRadians) * distance;
  return {
    x: Math.sin(pose.azimuthRadians) * horizontalDistance,
    y: Math.sin(pose.elevationRadians) * distance,
    z: Math.cos(pose.azimuthRadians) * horizontalDistance,
  };
}

// The values both recorders report next to their video.
export function describeOrbitShot() {
  return {
    ...ORBIT_SHOT,
    startAzimuthDegrees: START_AZIMUTH_DEGREES,
    endAzimuthDegrees: START_AZIMUTH_DEGREES + orbitedDegrees(ORBIT_SHOT.durationSeconds),
    angularSpeedKeyframes: ANGULAR_SPEED_KEYFRAMES,
    pushIn: PUSH_IN,
    wideFraming: WIDE_FRAMING,
    closeFraming: CLOSE_FRAMING,
    bodyLookHeightInSpans: BODY_LOOK_HEIGHT_IN_SPANS,
    trackingRate: TRACKING_RATE,
  };
}
