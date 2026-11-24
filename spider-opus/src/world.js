// The prototype room: a gridded floor and back wall, wall machinery, and the obstacle course on the track.
// The track runs along +Z through x = 0; the camera side is +X and the wall stands at -X.
import * as THREE from "three";

export const WALL_X = -4.6;
export const TRACK = { startZ: -4.5, endZ: 4.8 };
const RAY_HEIGHT = 8;

// Every obstacle on the course, in walking order. Heights stay under the 0.9 body clearance.
const COURSE = [
  { kind: "pipe", x: 0, z: -2.75, length: 4.6, radius: 0.17, material: "copper", turn: 0 },
  { kind: "pipe", x: 0.35, z: -2.25, length: 3.6, radius: 0.11, material: "steel", turn: 0.14 },
  { kind: "gear", x: -0.7, z: -1.35, radius: 0.85, thickness: 0.2, teeth: 14 },
  { kind: "gear", x: 0.95, z: -1.05, radius: 0.5, thickness: 0.3, teeth: 9 },
  { kind: "beam", x: 0, z: -0.15, length: 4.4, height: 0.3, turn: -0.14 },
  { kind: "crate", x: -0.9, z: 0.7, width: 0.6, height: 0.5, depth: 0.6, turn: 0.2 },
  { kind: "crate", x: 0.7, z: 0.68, width: 0.5, height: 0.36, depth: 0.5, turn: -0.3 },
  { kind: "crate", x: 1.55, z: 0.32, width: 0.42, height: 0.42, depth: 0.42, turn: 0.5 },
  { kind: "ramp", x: 0, z: 1.25, width: 4.2, length: 1.0, rise: 0.45 },
  { kind: "steps", x: 0, z: 2.25, width: 4.2, depth: 0.4, heights: [0.45, 0.3, 0.15] },
];

function createMaterials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: "#5b636e", metalness: 0.85, roughness: 0.42 }),
    iron: new THREE.MeshStandardMaterial({ color: "#2a2f36", metalness: 0.8, roughness: 0.55 }),
    brass: new THREE.MeshStandardMaterial({ color: "#a9843f", metalness: 1, roughness: 0.36 }),
    copper: new THREE.MeshStandardMaterial({ color: "#9d5a37", metalness: 1, roughness: 0.4 }),
    primer: new THREE.MeshStandardMaterial({ color: "#6a3529", metalness: 0.35, roughness: 0.7 }),
    crate: new THREE.MeshStandardMaterial({ color: "#2e4150", metalness: 0.55, roughness: 0.6 }),
    plate: new THREE.MeshStandardMaterial({ color: "#3a3e45", metalness: 0.5, roughness: 0.72 }),
  };
}

// Prototype-map grid: one-unit cells with a faint checker, quarter-unit minor lines and bold unit lines.
// The pixel variant drops the minor lines and thickens the rest so they survive the low resolution.
function createGridTexture({ majorWidth, minorWidth, repeatX, repeatY }) {
  const size = 512;
  const pixelsPerUnit = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#15171b";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#1a1d22";
  context.fillRect(0, 0, pixelsPerUnit, pixelsPerUnit);
  context.fillRect(pixelsPerUnit, pixelsPerUnit, pixelsPerUnit, pixelsPerUnit);
  if (minorWidth > 0) {
    context.fillStyle = "#262a31";
    for (let line = 0; line < 8; line++) {
      const offset = line * (pixelsPerUnit / 4);
      context.fillRect(offset - minorWidth / 2, 0, minorWidth, size);
      context.fillRect(0, offset - minorWidth / 2, size, minorWidth);
    }
  }
  context.fillStyle = "#4b525d";
  for (const offset of [0, pixelsPerUnit, size]) {
    context.fillRect(offset - majorWidth / 2, 0, majorWidth, size);
    context.fillRect(0, offset - majorWidth / 2, size, majorWidth);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

function createGriddedSurface(width, height) {
  const fineTexture = createGridTexture({ majorWidth: 3, minorWidth: 1, repeatX: width / 2, repeatY: height / 2 });
  const boldTexture = createGridTexture({ majorWidth: 14, minorWidth: 0, repeatX: width / 2, repeatY: height / 2 });
  const material = new THREE.MeshStandardMaterial({ map: fineTexture, roughness: 0.9, metalness: 0.05 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.receiveShadow = true;
  return {
    mesh,
    setBold(isBold) {
      material.map = isBold ? boldTexture : fineTexture;
    },
  };
}

function addMesh(group, geometry, material, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createPipe({ length, radius, material }, materials) {
  const pipe = new THREE.Group();
  const bodyGeometry = new THREE.CylinderGeometry(radius, radius, length, 20);
  bodyGeometry.rotateZ(Math.PI / 2);
  addMesh(pipe, bodyGeometry, materials[material], new THREE.Vector3(0, radius, 0));
  for (const along of [-0.48, -0.08, 0.48]) {
    const flangeGeometry = new THREE.CylinderGeometry(radius * 1.4, radius * 1.4, 0.07, 20);
    flangeGeometry.rotateZ(Math.PI / 2);
    addMesh(pipe, flangeGeometry, materials.brass, new THREE.Vector3(along * length, radius, 0));
  }
  return pipe;
}

// A gear lying flat, axis along Y, bottom face on y = 0.
function createGear({ radius, thickness, teeth, hubMaterial = "brass", bodyMaterial = "iron" }, materials) {
  const gear = new THREE.Group();
  const rimRadius = radius * 0.86;
  addMesh(gear, new THREE.CylinderGeometry(rimRadius, rimRadius, thickness, 32), materials[bodyMaterial], new THREE.Vector3(0, thickness / 2, 0));
  const toothDepth = radius - rimRadius + 0.02;
  const toothWidth = ((2 * Math.PI * rimRadius) / teeth) * 0.5;
  for (let tooth = 0; tooth < teeth; tooth++) {
    const angle = (tooth / teeth) * Math.PI * 2;
    const toothCenter = rimRadius + toothDepth / 2 - 0.02;
    const position = new THREE.Vector3(Math.sin(angle) * toothCenter, thickness / 2, Math.cos(angle) * toothCenter);
    const toothMesh = addMesh(gear, new THREE.BoxGeometry(toothWidth, thickness, toothDepth), materials[bodyMaterial], position);
    toothMesh.rotation.y = angle;
  }
  const hubRadius = radius * 0.24;
  addMesh(gear, new THREE.CylinderGeometry(hubRadius, hubRadius, thickness + 0.08, 20), materials[hubMaterial], new THREE.Vector3(0, (thickness + 0.08) / 2, 0));
  return gear;
}

function createBeam({ length, height }, materials) {
  const beam = new THREE.Group();
  const flangeThickness = 0.05;
  const flangeWidth = 0.32;
  addMesh(beam, new THREE.BoxGeometry(length, flangeThickness, flangeWidth), materials.primer, new THREE.Vector3(0, flangeThickness / 2, 0));
  addMesh(beam, new THREE.BoxGeometry(length, flangeThickness, flangeWidth), materials.primer, new THREE.Vector3(0, height - flangeThickness / 2, 0));
  addMesh(beam, new THREE.BoxGeometry(length, height - flangeThickness * 2, 0.06), materials.primer, new THREE.Vector3(0, height / 2, 0));
  return beam;
}

function createCrate({ width, height, depth }, materials) {
  const crate = new THREE.Group();
  addMesh(crate, new THREE.BoxGeometry(width, height - 0.04, depth), materials.crate, new THREE.Vector3(0, (height - 0.04) / 2, 0));
  addMesh(crate, new THREE.BoxGeometry(width + 0.04, 0.05, depth + 0.04), materials.steel, new THREE.Vector3(0, height - 0.025, 0));
  for (const cornerX of [-1, 1]) {
    for (const cornerZ of [-1, 1]) {
      const cornerPosition = new THREE.Vector3((cornerX * width) / 2, (height - 0.04) / 2, (cornerZ * depth) / 2);
      addMesh(crate, new THREE.BoxGeometry(0.06, height - 0.04, 0.06), materials.steel, cornerPosition);
    }
  }
  return crate;
}

// A wedge rising toward +Z.
function createRamp({ width, length, rise }, materials) {
  const ramp = new THREE.Group();
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  profile.lineTo(length, 0);
  profile.lineTo(length, rise);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2, 0, 0);
  addMesh(ramp, geometry, materials.plate, new THREE.Vector3());
  return ramp;
}

function createSteps({ width, depth, heights }, materials) {
  const steps = new THREE.Group();
  heights.forEach((height, stepIndex) => {
    const position = new THREE.Vector3(0, height / 2, depth * (stepIndex + 0.5));
    addMesh(steps, new THREE.BoxGeometry(width, height, depth), materials.plate, position);
  });
  return steps;
}

const OBSTACLE_BUILDERS = {
  pipe: createPipe,
  gear: createGear,
  beam: createBeam,
  crate: createCrate,
  ramp: createRamp,
  steps: createSteps,
};

function buildCourse(materials) {
  const course = new THREE.Group();
  course.name = "ObstacleCourse";
  for (const obstacle of COURSE) {
    const piece = OBSTACLE_BUILDERS[obstacle.kind](obstacle, materials);
    piece.position.set(obstacle.x, 0, obstacle.z);
    piece.rotation.y = obstacle.turn || 0;
    course.add(piece);
  }
  return course;
}

// Pipes and slowly turning gears on the back wall give the side view something to track against.
function buildWallMachinery(materials) {
  const machinery = new THREE.Group();
  const turningGears = [];
  const pipeRuns = [
    { y: 2.3, radius: 0.13, material: materials.copper },
    { y: 2.72, radius: 0.07, material: materials.steel },
  ];
  for (const run of pipeRuns) {
    const runGeometry = new THREE.CylinderGeometry(run.radius, run.radius, 60, 16);
    runGeometry.rotateX(Math.PI / 2);
    addMesh(machinery, runGeometry, run.material, new THREE.Vector3(WALL_X + 0.3, run.y, 0));
    for (let flangeZ = -28; flangeZ <= 28; flangeZ += 2.5) {
      const flangeGeometry = new THREE.CylinderGeometry(run.radius * 1.45, run.radius * 1.45, 0.08, 16);
      flangeGeometry.rotateX(Math.PI / 2);
      addMesh(machinery, flangeGeometry, materials.brass, new THREE.Vector3(WALL_X + 0.3, run.y, flangeZ));
    }
  }
  const wallGears = [
    { z: -6.5, y: 4.4, radius: 1.5, teeth: 18, speed: 0.12 },
    { z: -3.1, y: 3.9, radius: 1.05, teeth: 13, speed: -0.17 },
    { z: 1.2, y: 4.6, radius: 1.7, teeth: 20, speed: 0.1 },
    { z: 5.6, y: 3.8, radius: 1.2, teeth: 15, speed: -0.15 },
  ];
  for (const wallGear of wallGears) {
    const mount = new THREE.Group();
    mount.position.set(WALL_X + 0.05, wallGear.y, wallGear.z);
    mount.rotation.z = -Math.PI / 2;
    // Steel hubs: brass ones read as bright discs against the dark wall, worst of all in pixel mode.
    const gear = createGear({ radius: wallGear.radius, thickness: 0.16, teeth: wallGear.teeth, hubMaterial: "steel", bodyMaterial: "plate" }, materials);
    mount.add(gear);
    machinery.add(mount);
    turningGears.push({ gear, speed: wallGear.speed });
  }
  return { machinery, turningGears };
}

export function createWorld(scene) {
  const materials = createMaterials();
  const floor = createGriddedSurface(80, 80);
  floor.mesh.rotation.x = -Math.PI / 2;
  const wall = createGriddedSurface(80, 12);
  wall.mesh.rotation.y = Math.PI / 2;
  wall.mesh.position.set(WALL_X, 6, 0);
  const course = buildCourse(materials);
  const { machinery, turningGears } = buildWallMachinery(materials);
  scene.add(floor.mesh, wall.mesh, course, machinery);
  scene.updateMatrixWorld(true);

  const colliders = [];
  course.traverse((node) => {
    if (node.isMesh) {
      colliders.push(node);
    }
  });
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const downward = new THREE.Vector3(0, -1, 0);
  const hitNormal = new THREE.Vector3();
  raycaster.far = RAY_HEIGHT + 1;

  return {
    // Height of whatever is under (x, z) and how flat it is (1 = level).
    sampleGround(x, z) {
      if (!course.visible) {
        return { height: 0, flatness: 1 };
      }
      rayOrigin.set(x, RAY_HEIGHT, z);
      raycaster.set(rayOrigin, downward);
      const hit = raycaster.intersectObjects(colliders, false)[0];
      if (!hit || hit.point.y <= 0) {
        return { height: 0, flatness: 1 };
      }
      hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      return { height: hit.point.y, flatness: hitNormal.y };
    },

    setObstaclesVisible(isVisible) {
      course.visible = isVisible;
    },

    setPixelLook(isPixel) {
      floor.setBold(isPixel);
      wall.setBold(isPixel);
    },

    update(time) {
      for (const { gear, speed } of turningGears) {
        gear.rotation.y = time * speed;
      }
    },
  };
}
