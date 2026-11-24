// Draws the whole swarm as one instanced mesh. The vertex shader looks the pose up in the baked textures
// (swarm-bake.js) by each roach's gait phase, blends the walk and sprint poses by its sprint mix, then turns, scales
// and places it. A lit material draws the scene; a matching normal material draws the ASCII pass's normal buffer
// (glow-ascii.js looks for `userData.normalMaterial`), because the pass's own override material cannot deform.
import * as THREE from 'three';

const POSE_DECLARATIONS = /* glsl */ `
attribute vec4 placement;
attribute vec4 gait;
attribute float bakedIndex;
uniform sampler2D bakedPositions;
uniform sampler2D bakedNormals;
uniform float gaitFrames;
vec3 poseNormal;
vec3 poseWorld;

vec3 bakedRow(sampler2D pose, float set, float frame) {
  return texelFetch(pose, ivec2(int(bakedIndex), int(set * gaitFrames + frame)), 0).xyz;
}

vec3 gaitBlend(sampler2D pose) {
  float position = fract(gait.x) * gaitFrames;
  float first = floor(position);
  float second = mod(first + 1.0, gaitFrames);
  float between = position - first;
  vec3 walk = mix(bakedRow(pose, 0.0, first), bakedRow(pose, 0.0, second), between);
  if (gait.y < 0.002) return walk;
  vec3 sprint = mix(bakedRow(pose, 1.0, first), bakedRow(pose, 1.0, second), between);
  return mix(walk, sprint, gait.y);
}

vec3 turnToHeading(vec3 local) {
  float sine = sin(placement.z);
  float cosine = cos(placement.z);
  return vec3(local.x * cosine + local.z * sine, local.y, -local.x * sine + local.z * cosine);
}

void computePose() {
  poseNormal = normalize(turnToHeading(gaitBlend(bakedNormals)));
  poseWorld = turnToHeading(gaitBlend(bakedPositions)) * placement.w + vec3(placement.x, 0.0, placement.y);
}
`;

function injectBakedPose(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', `${POSE_DECLARATIONS}\nvoid main() {`)
    .replace('#include <beginnormal_vertex>', 'computePose();\nvec3 objectNormal = poseNormal;')
    .replace('#include <begin_vertex>', shader.vertexShader.includes('<beginnormal_vertex>') ? 'vec3 transformed = poseWorld;' : 'computePose();\nvec3 transformed = poseWorld;');
}

/** Builds the instanced swarm mesh and the buffers the simulation fills each frame. */
export function createSwarmMesh(baked, count) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = baked.geometry.index;
  for (const name of ['position', 'normal', 'color', 'bakedIndex']) {
    geometry.setAttribute(name, baked.geometry.attributes[name]);
  }
  geometry.instanceCount = count;
  const placement = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const gait = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  placement.setUsage(THREE.DynamicDrawUsage);
  gait.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('placement', placement);
  geometry.setAttribute('gait', gait);

  const uniforms = {
    bakedPositions: { value: baked.positionTexture },
    bakedNormals: { value: baked.normalTexture },
    gaitFrames: { value: baked.gaitFrames },
  };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  // The baked brown is dark; lift it so the roaches read as warm marks against a near-black floor.
  material.color.setScalar(2.4);
  material.onBeforeCompile = (shader) => injectBakedPose(shader, uniforms);
  const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  normalMaterial.onBeforeCompile = (shader) => injectBakedPose(shader, uniforms);

  // The shadow pass needs the same deformation, with a depth material of its own.
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => injectBakedPose(shader, uniforms);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'swarm';
  mesh.userData.normalMaterial = normalMaterial;
  mesh.userData.placement = placement;
  mesh.userData.gait = gait;
  return mesh;
}

export function uploadInstances(mesh, simulation) {
  const { placement, gait } = mesh.userData;
  simulation.writeInstances(placement.array, gait.array);
  placement.needsUpdate = true;
  gait.needsUpdate = true;
}
