// Stand-in spider built from boxes and cylinders, used until assets/spider.glb exists.
// It follows the model contract exactly (node names, pivot axes, extras), so the rig cannot tell them apart.
import * as THREE from "three";
import { solveLegAngles, applyLegAngles } from "./ik.js";

const BODY_REST_HEIGHT = 1.12;
const SEGMENT_LENGTHS = { coxa: 0.32, femur: 0.95, tibia: 1.05, tarsus: 0.8 };
const REST_TARSUS_LEAN = -0.1;
const LEFT_LEG_LAYOUT = [
  { index: 1, hip: [0.42, -0.04, 0.52], foot: [1.45, 0, 1.35] },
  { index: 2, hip: [0.46, -0.04, 0.0], foot: [1.6, 0, 0.0] },
  { index: 3, hip: [0.42, -0.04, -0.52], foot: [1.45, 0, -1.3] },
];
const EYE_POSITIONS = [
  [0.11, 0.1, 1.1],
  [-0.11, 0.1, 1.1],
  [0.23, 0.0, 1.06],
  [-0.23, 0.0, 1.06],
];

function createMaterials() {
  return {
    iron: new THREE.MeshStandardMaterial({ color: "#2c3542", metalness: 0.75, roughness: 0.64 }),
    darkIron: new THREE.MeshStandardMaterial({ color: "#191c21", metalness: 0.8, roughness: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: "#b38a3e", metalness: 1, roughness: 0.34 }),
    copper: new THREE.MeshStandardMaterial({ color: "#9a4f2e", metalness: 1, roughness: 0.4 }),
    eyeGlow: new THREE.MeshStandardMaterial({
      name: "EyeGlow",
      color: "#2a1404",
      emissive: "#ffa32b",
      emissiveIntensity: 3,
      roughness: 0.3,
    }),
  };
}

function createMesh(name, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

// A box whose length runs along local +Z starting at the pivot, as the contract asks of every segment.
function createSegmentBeam(width, height, length, material) {
  const geometry = new THREE.BoxGeometry(width, height, length);
  geometry.translate(0, 0, length / 2);
  return createMesh("SegmentBeam", geometry, material);
}

function createJointDisc(radius, width, material) {
  const geometry = new THREE.CylinderGeometry(radius, radius, width, 14);
  geometry.rotateZ(Math.PI / 2);
  return createMesh("JointDisc", geometry, material);
}

function createPivot(name, segmentLength) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.userData.segmentLength = segmentLength;
  return pivot;
}

function buildCoxa(name, materials) {
  const coxa = createPivot(name, SEGMENT_LENGTHS.coxa);
  const turret = createMesh("Turret", new THREE.CylinderGeometry(0.13, 0.15, 0.22, 14), materials.brass);
  coxa.add(turret);
  coxa.add(createSegmentBeam(0.18, 0.15, SEGMENT_LENGTHS.coxa, materials.iron));
  return coxa;
}

function buildFemur(name, materials) {
  const length = SEGMENT_LENGTHS.femur;
  const femur = createPivot(name, length);
  femur.add(createJointDisc(0.12, 0.2, materials.brass));
  const leftPlate = createSegmentBeam(0.035, 0.17, length, materials.iron);
  leftPlate.position.x = 0.055;
  const rightPlate = createSegmentBeam(0.035, 0.17, length, materials.iron);
  rightPlate.position.x = -0.055;
  femur.add(leftPlate, rightPlate);
  const cylinderGeometry = new THREE.CylinderGeometry(0.045, 0.045, length * 0.5, 10);
  cylinderGeometry.rotateX(Math.PI / 2);
  const pistonCylinder = createMesh("PistonCylinder", cylinderGeometry, materials.copper);
  pistonCylinder.position.set(0, 0.13, length * 0.33);
  const rodGeometry = new THREE.CylinderGeometry(0.018, 0.018, length * 0.4, 8);
  rodGeometry.rotateX(Math.PI / 2);
  const pistonRod = createMesh("PistonRod", rodGeometry, materials.brass);
  pistonRod.position.set(0, 0.13, length * 0.76);
  femur.add(pistonCylinder, pistonRod);
  return femur;
}

function buildTibia(name, materials) {
  const length = SEGMENT_LENGTHS.tibia;
  const tibia = createPivot(name, length);
  tibia.add(createJointDisc(0.11, 0.17, materials.brass));
  tibia.add(createSegmentBeam(0.08, 0.13, length, materials.iron));
  const brace = createSegmentBeam(0.11, 0.05, length * 0.45, materials.darkIron);
  brace.position.set(0, -0.07, length * 0.1);
  tibia.add(brace);
  return tibia;
}

function buildTarsus(name, materials) {
  const length = SEGMENT_LENGTHS.tarsus;
  const tarsus = createPivot(name, length);
  tarsus.add(createJointDisc(0.085, 0.14, materials.brass));
  const spikeGeometry = new THREE.ConeGeometry(0.075, length, 4);
  spikeGeometry.rotateX(Math.PI / 2);
  spikeGeometry.translate(0, 0, length / 2);
  tarsus.add(createMesh("Spike", spikeGeometry, materials.darkIron));
  return tarsus;
}

function buildLeg(legName, hip, foot, materials) {
  const coxa = buildCoxa(`${legName}_Coxa`, materials);
  const femur = buildFemur(`${legName}_Femur`, materials);
  const tibia = buildTibia(`${legName}_Tibia`, materials);
  const tarsus = buildTarsus(`${legName}_Tarsus`, materials);
  const tip = new THREE.Object3D();
  tip.name = `${legName}_Tip`;
  coxa.position.fromArray(hip);
  femur.position.z = SEGMENT_LENGTHS.coxa;
  tibia.position.z = SEGMENT_LENGTHS.femur;
  tarsus.position.z = SEGMENT_LENGTHS.tibia;
  tip.position.z = SEGMENT_LENGTHS.tarsus;
  coxa.add(femur);
  femur.add(tibia);
  tibia.add(tarsus);
  tarsus.add(tip);

  // Rest pose: the same solver the walker uses, aimed at the rest foot position.
  const footInBodySpace = new THREE.Vector3(foot[0], foot[1] - BODY_REST_HEIGHT, foot[2]);
  const restAngles = solveLegAngles(coxa.position, footInBodySpace, SEGMENT_LENGTHS, REST_TARSUS_LEAN);
  applyLegAngles({ coxa, femur, tibia, tarsus }, restAngles);
  return coxa;
}

function buildHull(materials) {
  const hull = new THREE.Group();
  hull.name = "Hull";
  hull.add(createMesh("Chassis", new THREE.BoxGeometry(0.8, 0.34, 1.5), materials.iron));
  const keel = createMesh("Keel", new THREE.BoxGeometry(0.36, 0.1, 1.2), materials.darkIron);
  keel.position.y = -0.2;
  hull.add(keel);
  for (const side of [1, -1]) {
    const rail = createMesh("HipRail", new THREE.BoxGeometry(0.12, 0.2, 1.36), materials.darkIron);
    rail.position.set(side * 0.4, -0.04, 0);
    hull.add(rail);
  }
  return hull;
}

function buildBoiler(materials) {
  const boiler = new THREE.Group();
  boiler.name = "Boiler";
  boiler.position.set(0, 0.5, -0.3);
  const shellGeometry = new THREE.CylinderGeometry(0.46, 0.46, 1.2, 24);
  shellGeometry.rotateX(Math.PI / 2);
  boiler.add(createMesh("BoilerShell", shellGeometry, materials.iron));
  for (const capDirection of [1, -1]) {
    const capGeometry = new THREE.SphereGeometry(0.46, 24, 12);
    capGeometry.scale(1, 1, 0.42);
    const cap = createMesh("BoilerCap", capGeometry, materials.iron);
    cap.position.z = capDirection * 0.6;
    boiler.add(cap);
  }
  for (const bandOffset of [-0.45, 0, 0.45]) {
    const band = createMesh("BoilerBand", new THREE.TorusGeometry(0.47, 0.028, 8, 28), materials.brass);
    band.position.z = bandOffset;
    boiler.add(band);
  }
  // Rows of swept-back spines along the top and flanks of the boiler.
  for (const aroundAngle of [-0.75, 0, 0.75]) {
    for (const alongOffset of [-0.4, -0.1, 0.2, 0.48]) {
      const spineHeight = aroundAngle === 0 ? 0.42 : 0.3;
      const spine = createMesh("BoilerSpine", new THREE.ConeGeometry(0.06, spineHeight, 4), materials.darkIron);
      const surfaceDistance = 0.46 + spineHeight * 0.35;
      spine.position.set(Math.sin(aroundAngle) * surfaceDistance, Math.cos(aroundAngle) * surfaceDistance, alongOffset);
      spine.rotation.set(-0.45, 0, -aroundAngle);
      boiler.add(spine);
    }
  }
  return boiler;
}

function buildHead(materials) {
  const head = new THREE.Group();
  head.name = "Head";
  head.position.set(0, 0.04, 0.84);
  head.add(createMesh("Skull", new THREE.BoxGeometry(0.58, 0.32, 0.44), materials.iron));
  const brow = createMesh("Brow", new THREE.BoxGeometry(0.64, 0.08, 0.3), materials.darkIron);
  brow.position.set(0, 0.17, 0.12);
  brow.rotation.x = 0.28;
  head.add(brow);
  for (const side of [1, -1]) {
    const mandible = createMesh("Mandible", new THREE.ConeGeometry(0.055, 0.42, 4), materials.copper);
    mandible.position.set(side * 0.14, -0.2, 0.3);
    mandible.rotation.x = Math.PI * 0.72;
    mandible.rotation.z = side * -0.2;
    head.add(mandible);
  }
  return head;
}

function buildStack(name, side, materials) {
  const stack = new THREE.Group();
  stack.name = name;
  stack.position.set(side * 0.2, 0.94, -0.55);
  stack.rotation.x = -0.16;
  const pipeGeometry = new THREE.CylinderGeometry(0.085, 0.07, 0.56, 14);
  pipeGeometry.translate(0, 0.28, 0);
  stack.add(createMesh("StackPipe", pipeGeometry, materials.darkIron));
  const rim = createMesh("StackRim", new THREE.TorusGeometry(0.09, 0.022, 8, 16), materials.brass);
  rim.position.y = 0.56;
  rim.rotation.x = Math.PI / 2;
  stack.add(rim);
  return stack;
}

function buildSteamVent(name, stack) {
  const vent = new THREE.Object3D();
  vent.name = name;
  // The vent sits at the mouth of its stack, expressed in body space.
  vent.position.set(0, 0.58, 0).applyEuler(stack.rotation).add(stack.position);
  return vent;
}

function buildEyes(materials) {
  return EYE_POSITIONS.map((position, eyeIndex) => {
    const eye = createMesh(`Eye${eyeIndex + 1}`, new THREE.SphereGeometry(0.055, 14, 10), materials.eyeGlow);
    eye.position.fromArray(position);
    return eye;
  });
}

function describeLegs() {
  const legs = [];
  for (const layout of LEFT_LEG_LAYOUT) {
    legs.push({ name: `LegL${layout.index}`, hip: layout.hip, foot: layout.foot });
  }
  for (const layout of LEFT_LEG_LAYOUT) {
    const mirroredHip = [-layout.hip[0], layout.hip[1], layout.hip[2]];
    const mirroredFoot = [-layout.foot[0], layout.foot[1], layout.foot[2]];
    legs.push({ name: `LegR${layout.index}`, hip: mirroredHip, foot: mirroredFoot });
  }
  return legs;
}

export function buildStandInSpider() {
  const materials = createMaterials();
  const spider = new THREE.Group();
  spider.name = "Spider";
  const body = new THREE.Group();
  body.name = "Body";
  body.position.y = BODY_REST_HEIGHT;
  spider.add(body);

  const firstStack = buildStack("Stack1", 1, materials);
  const secondStack = buildStack("Stack2", -1, materials);
  body.add(buildHull(materials), buildBoiler(materials), buildHead(materials), firstStack, secondStack);
  body.add(buildSteamVent("SteamVent1", firstStack), buildSteamVent("SteamVent2", secondStack));
  body.add(...buildEyes(materials));

  const hipPositions = {};
  const restFootPositions = {};
  for (const leg of describeLegs()) {
    body.add(buildLeg(leg.name, leg.hip, leg.foot, materials));
    hipPositions[leg.name] = [leg.hip[0], leg.hip[1] + BODY_REST_HEIGHT, leg.hip[2]];
    restFootPositions[leg.name] = leg.foot;
  }
  spider.userData.hipPositions = hipPositions;
  spider.userData.restFootPositions = restFootPositions;
  spider.userData.bodyRestHeight = BODY_REST_HEIGHT;
  return spider;
}
