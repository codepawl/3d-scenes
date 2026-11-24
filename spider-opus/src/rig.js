// Loads the spider model (the GLB, or the stand-in while it is missing) and turns it into the data the walker needs.
// Lengths and positions come from the model's extras; the node graph is the fallback when an extra is
// missing or disagrees with the joints that are actually rendered.
import * as THREE from "three";
import { buildStandInSpider } from "./standin.js";

export const LEG_NAMES = ["LegL1", "LegL2", "LegL3", "LegR1", "LegR2", "LegR3"];
const LENGTH_TOLERANCE = 0.01;
const POSITION_TOLERANCE = 0.08;

export async function loadSpiderModel() {
  const response = await fetch(`model-info.json${window.location.search}`);
  const modelInfo = await response.json();
  if (!modelInfo.model) {
    return { root: buildStandInSpider(), source: "stand-in" };
  }
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(modelInfo.model);
  const root = gltf.scene.getObjectByName("Spider") || gltf.scene;
  return { root, source: modelInfo.model };
}

function requireNode(root, name) {
  const node = root.getObjectByName(name);
  if (!node) {
    throw new Error(`The spider model has no node named "${name}"`);
  }
  return node;
}

function worldPositionOf(node) {
  return node.getWorldPosition(new THREE.Vector3());
}

function toVector(entry) {
  if (Array.isArray(entry) && entry.length >= 3) {
    return new THREE.Vector3(entry[0], entry[1], entry[2]);
  }
  if (entry && Number.isFinite(entry.x)) {
    return new THREE.Vector3(entry.x, entry.y, entry.z);
  }
  return null;
}

// Extras may arrive keyed by leg name, as six triples, or as eighteen flat numbers. Lists follow the
// model's `legOrder` extra when it has one, else LEG_NAMES order.
function readLegPositions(extra, legOrder) {
  const positions = {};
  if (!extra) {
    return positions;
  }
  const order = Array.isArray(legOrder) ? legOrder : LEG_NAMES;
  const isFlatList = Array.isArray(extra) && typeof extra[0] === "number";
  LEG_NAMES.forEach((legName) => {
    const legIndex = order.indexOf(legName);
    let entry = extra[legName];
    if (isFlatList) {
      entry = extra.slice(legIndex * 3, legIndex * 3 + 3);
    } else if (Array.isArray(extra)) {
      entry = extra[legIndex];
    }
    positions[legName] = toVector(entry);
  });
  return positions;
}

function preferDeclared(label, declared, measured) {
  if (!declared) {
    console.warn(`${label}: not in the model extras, measured from the nodes instead`);
    return measured;
  }
  if (declared.distanceTo(measured) > POSITION_TOLERANCE) {
    console.warn(`${label}: the extras disagree with the nodes, using the nodes`);
    return measured;
  }
  return declared;
}

function readSegmentLength(pivot, child) {
  const measured = child.position.length();
  const declared = pivot.userData.segmentLength;
  if (!Number.isFinite(declared) || Math.abs(declared - measured) > LENGTH_TOLERANCE) {
    console.warn(`${pivot.name}: segmentLength extra missing or off, using the joint spacing ${measured.toFixed(3)}`);
    return measured;
  }
  return declared;
}

function tripodGroupOf(legName) {
  const isLeft = legName[3] === "L";
  const pairIndex = Number(legName[4]);
  return (isLeft ? pairIndex : pairIndex + 1) % 2;
}

// How far the rest pose leans the tarsus outward from vertical, so the solver reproduces the modelled stance.
function measureRestLean(hip, ankle, foot) {
  const outward = new THREE.Vector3(foot.x - hip.x, 0, foot.z - hip.z).normalize();
  const tarsusDirection = foot.clone().sub(ankle);
  return Math.atan2(tarsusDirection.dot(outward), -tarsusDirection.y);
}

function createLeg(spiderRoot, legName, declaredHips, declaredFeet) {
  const coxa = requireNode(spiderRoot, `${legName}_Coxa`);
  const femur = requireNode(spiderRoot, `${legName}_Femur`);
  const tibia = requireNode(spiderRoot, `${legName}_Tibia`);
  const tarsus = requireNode(spiderRoot, `${legName}_Tarsus`);
  const tip = requireNode(spiderRoot, `${legName}_Tip`);
  const hipOffset = preferDeclared(`${legName} hip`, declaredHips[legName], worldPositionOf(coxa));
  const homeOffset = preferDeclared(`${legName} rest foot`, declaredFeet[legName], worldPositionOf(tip));
  return {
    name: legName,
    group: tripodGroupOf(legName),
    coxa,
    femur,
    tibia,
    tarsus,
    tip,
    lengths: {
      coxa: readSegmentLength(coxa, femur),
      femur: readSegmentLength(femur, tibia),
      tibia: readSegmentLength(tibia, tarsus),
      tarsus: readSegmentLength(tarsus, tip),
    },
    hipOffset,
    homeOffset: new THREE.Vector3(homeOffset.x, 0, homeOffset.z),
    restReach: Math.hypot(homeOffset.x - hipOffset.x, homeOffset.z - hipOffset.z),
    restLean: measureRestLean(hipOffset, worldPositionOf(tarsus), worldPositionOf(tip)),
  };
}

// Everything on the body except the legs: its meshes and their bounding box, in the space it was loaded in.
function measureHull(body) {
  const hullBox = new THREE.Box3();
  const hullMeshes = [];
  const meshBox = new THREE.Box3();
  function visit(node) {
    if (node.name.endsWith("_Coxa")) {
      return;
    }
    if (node.isMesh) {
      node.geometry.computeBoundingBox();
      meshBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
      hullBox.union(meshBox);
      hullMeshes.push(node);
    }
    node.children.forEach(visit);
  }
  visit(body);
  return { hullBox, hullMeshes };
}

// Height of the solid underside: the median of what a grid of upward rays hits first. The bounding box
// would report the tip of a hanging cable or mandible, which is not what has to clear an obstacle.
function measureBellyHeight(hullBox, hullMeshes) {
  const center = hullBox.getCenter(new THREE.Vector3());
  const size = hullBox.getSize(new THREE.Vector3());
  const raycaster = new THREE.Raycaster();
  const upward = new THREE.Vector3(0, 1, 0);
  const origin = new THREE.Vector3();
  const heights = [];
  for (const alongShare of [-0.3, -0.15, 0, 0.15, 0.3]) {
    for (const acrossShare of [-0.15, 0, 0.15]) {
      origin.set(center.x + acrossShare * size.x, hullBox.min.y - 1, center.z + alongShare * size.z);
      raycaster.set(origin, upward);
      const firstHit = raycaster.intersectObjects(hullMeshes, false)[0];
      if (firstHit) {
        heights.push(firstHit.point.y);
      }
    }
  }
  if (heights.length === 0) {
    return hullBox.min.y;
  }
  heights.sort((first, second) => first - second);
  return heights[Math.floor(heights.length / 2)];
}

function collectEyes(body, head) {
  const eyes = [];
  body.traverse((node) => {
    if (node.isMesh && /^Eye\d+/.test(node.name)) {
      eyes.push(node);
    }
  });
  for (const eye of eyes) {
    let isUnderHead = false;
    eye.traverseAncestors((ancestor) => {
      isUnderHead = isUnderHead || ancestor === head;
    });
    // The lamps must follow the head when it scans.
    if (!isUnderHead) {
      head.attach(eye);
    }
  }
  return eyes;
}

// Call while the spider still sits at its loaded pose with an untransformed parent.
export function createRig(spiderRoot) {
  spiderRoot.updateMatrixWorld(true);
  const body = requireNode(spiderRoot, "Body");
  const head = requireNode(spiderRoot, "Head");
  const extras = spiderRoot.userData;
  const declaredHips = readLegPositions(extras.hipPositions, extras.legOrder);
  const declaredFeet = readLegPositions(extras.restFootPositions, extras.legOrder);
  const measuredBodyHeight = worldPositionOf(body).y;
  let bodyRestHeight = extras.bodyRestHeight;
  if (!Number.isFinite(bodyRestHeight)) {
    console.warn("bodyRestHeight: not in the model extras, measured from the Body node instead");
    bodyRestHeight = measuredBodyHeight;
  }
  const { hullBox, hullMeshes } = measureHull(body);
  const bellyHeight = measureBellyHeight(hullBox, hullMeshes);
  return {
    root: spiderRoot,
    body,
    head,
    boiler: requireNode(spiderRoot, "Boiler"),
    vents: [requireNode(spiderRoot, "SteamVent1"), requireNode(spiderRoot, "SteamVent2")],
    eyes: collectEyes(body, head),
    legs: LEG_NAMES.map((legName) => createLeg(spiderRoot, legName, declaredHips, declaredFeet)),
    bodyRestHeight,
    // Distance from the Body origin down to the solid underside of the hull, and the hull's half length.
    bellyHeight,
    bellyDrop: measuredBodyHeight - bellyHeight,
    hullHalfLength: Math.max(Math.abs(hullBox.min.z), Math.abs(hullBox.max.z)),
  };
}
