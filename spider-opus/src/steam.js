// Steam, dust and sparks drawn as camera-facing quads in one instanced draw call.
// Each quad is shaded like a small lit puff with a ragged edge, so a cloud of them reads as vapour, not blobs.
import * as THREE from "three";
import { clamp, lerp } from "./math.js";

const CAPACITY = 900;
const KIND = { steam: 0, dust: 1, spark: 2 };

const vertexShader = /* glsl */ `
  attribute vec4 instanceOffsetSize;
  attribute vec4 instanceLook;
  varying vec2 vCorner;
  varying vec2 vScreenCorner;
  varying vec4 vLook;
  #include <fog_pars_vertex>
  void main() {
    vCorner = position.xy * 2.0;
    vLook = instanceLook;
    float angle = instanceLook.y;
    vec2 rotated = vec2(
      cos(angle) * position.x - sin(angle) * position.y,
      sin(angle) * position.x + cos(angle) * position.y
    );
    vScreenCorner = rotated * 2.0;
    vec4 mvPosition = viewMatrix * vec4(instanceOffsetSize.xyz, 1.0);
    mvPosition.xy += rotated * instanceOffsetSize.w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vCorner;
  varying vec2 vScreenCorner;
  varying vec4 vLook;
  #include <fog_pars_fragment>

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 blend = local * local * (3.0 - 2.0 * local);
    float bottom = mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x);
    float top = mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), blend.x);
    return mix(bottom, top, blend.y);
  }

  void main() {
    float radius = length(vCorner);
    if (radius > 1.0) discard;
    float alpha = vLook.x;
    float seed = vLook.z;
    float kind = vLook.w;
    vec3 color;
    float coverage;
    float glow = 0.0;
    if (kind > 1.5) {
      coverage = pow(1.0 - radius, 2.0);
      color = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.86, 0.55), coverage) * 4.0;
      glow = 1.0;
    } else {
      float wisp = valueNoise(vCorner * 2.1 + seed * 37.0) * 0.6 + valueNoise(vCorner * 4.7 - seed * 11.0) * 0.4;
      float edge = 1.0 - smoothstep(0.2 + wisp * 0.3, 1.0, radius);
      // Noise eats holes into each puff so overlapping quads build ragged vapour, not a solid ball.
      coverage = edge * smoothstep(0.18, 0.78, wisp);
      float dome = sqrt(max(0.0, 1.0 - radius * radius));
      vec3 normal = normalize(vec3(vScreenCorner, dome + 0.3));
      float keyLight = clamp(dot(normal, normalize(vec3(0.3, 0.85, 0.45))), 0.0, 1.0);
      float rimLight = pow(clamp(dot(normal, normalize(vec3(-0.85, 0.3, 0.15))), 0.0, 1.0), 2.0);
      // Kept well below white: a dense burst stacks dozens of quads and would otherwise burn out.
      vec3 shadowColor = kind > 0.5 ? vec3(0.09, 0.08, 0.07) : vec3(0.06, 0.07, 0.09);
      vec3 litColor = kind > 0.5 ? vec3(0.3, 0.27, 0.23) : vec3(0.33, 0.35, 0.39);
      color = mix(shadowColor, litColor, keyLight) + vec3(0.3, 0.5, 0.75) * rimLight * 0.35;
    }
    #ifdef USE_FOG
      float fogAmount = smoothstep(fogNear, fogFar, vFogDepth);
      color = mix(color, fogColor, fogAmount * (1.0 - glow));
      coverage *= 1.0 - fogAmount * glow;
    #endif
    float opacity = clamp(coverage * alpha, 0.0, 1.0);
    // Premultiplied output: smoke blends over the scene, sparks add light (alpha 0).
    gl_FragColor = vec4(color * opacity, opacity * (1.0 - glow));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createParticleMesh() {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  const offsetSize = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  const look = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  offsetSize.setUsage(THREE.DynamicDrawUsage);
  look.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("instanceOffsetSize", offsetSize);
  geometry.setAttribute("instanceLook", look);
  geometry.instanceCount = CAPACITY;
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    fog: true,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, offsetSize, look };
}

function createParticle() {
  return {
    isAlive: false,
    kind: KIND.steam,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 0,
    life: 1,
    startSize: 0.1,
    endSize: 0.5,
    opacity: 1,
    drag: 1,
    lift: 0,
    rotation: 0,
    spin: 0,
    seed: 0,
  };
}

export function createSteam(scene, random) {
  const { mesh, offsetSize, look } = createParticleMesh();
  scene.add(mesh);
  const particles = Array.from({ length: CAPACITY }, createParticle);
  let nextSlot = 0;
  let burstSecondsLeft = 0;
  let wispTimer = 0;
  const ventPosition = new THREE.Vector3();
  const bodyUp = new THREE.Vector3();
  const bodyQuaternion = new THREE.Quaternion();

  function spread(amount) {
    return (random() * 2 - 1) * amount;
  }

  function emit(settings) {
    const particle = particles[nextSlot];
    nextSlot = (nextSlot + 1) % CAPACITY;
    particle.isAlive = true;
    particle.age = 0;
    particle.rotation = random() * Math.PI * 2;
    particle.seed = random();
    particle.spin = spread(0.6);
    particle.position.copy(settings.position);
    particle.velocity.copy(settings.velocity);
    particle.kind = settings.kind;
    particle.life = settings.life;
    particle.startSize = settings.startSize;
    particle.endSize = settings.endSize;
    particle.opacity = settings.opacity;
    particle.drag = settings.drag;
    particle.lift = settings.lift;
  }

  function readVent(vent) {
    vent.getWorldPosition(ventPosition);
    vent.parent.getWorldQuaternion(bodyQuaternion);
    bodyUp.set(0, 1, 0).applyQuaternion(bodyQuaternion);
  }

  function emitSteamFrom(vent, strength, bodyVelocity) {
    readVent(vent);
    const velocity = bodyUp.clone().multiplyScalar(lerp(0.9, 1.6, strength));
    velocity.x += spread(0.25) + bodyVelocity.x * 0.4;
    velocity.y += spread(0.2);
    velocity.z += spread(0.25) + bodyVelocity.z * 0.4;
    emit({
      kind: KIND.steam,
      position: ventPosition,
      velocity,
      life: lerp(1.4, 2.6, random()),
      startSize: lerp(0.08, 0.16, strength),
      endSize: lerp(0.55, 1.25, strength) * lerp(0.8, 1.2, random()),
      opacity: lerp(0.16, 0.34, strength),
      drag: 1.6,
      lift: 0.55,
    });
  }

  function emitVentJet(vent, ventIndex) {
    readVent(vent);
    // Jets fan out sideways from each vent: the first vent to one side, the second to the other.
    const sideways = new THREE.Vector3(ventIndex === 0 ? 1 : -1, 0, 0).applyQuaternion(bodyQuaternion);
    const velocity = bodyUp.clone().multiplyScalar(lerp(1.6, 2.6, random()));
    velocity.addScaledVector(sideways, lerp(0.8, 1.8, random()));
    velocity.x += spread(0.4);
    velocity.z += spread(0.4);
    emit({
      kind: KIND.steam,
      position: ventPosition,
      velocity,
      life: lerp(1.6, 2.8, random()),
      startSize: 0.1,
      endSize: lerp(0.9, 1.6, random()),
      opacity: 0.18,
      drag: 2.4,
      lift: 0.7,
    });
  }

  function updateParticle(particle, deltaSeconds) {
    particle.age += deltaSeconds;
    if (particle.age >= particle.life) {
      particle.isAlive = false;
      return;
    }
    const dragFactor = Math.exp(-particle.drag * deltaSeconds);
    particle.velocity.multiplyScalar(dragFactor);
    if (particle.kind === KIND.spark) {
      particle.velocity.y -= 7 * deltaSeconds;
    } else {
      particle.velocity.y += particle.lift * deltaSeconds;
      // A slow swirl so the plume curls instead of rising in a straight column.
      const swirl = particle.seed * 40 + particle.age * 1.7;
      particle.velocity.x += Math.sin(swirl) * 0.35 * deltaSeconds;
      particle.velocity.z += Math.cos(swirl * 1.3) * 0.35 * deltaSeconds;
    }
    particle.position.addScaledVector(particle.velocity, deltaSeconds);
    if (particle.position.y < 0.02) {
      particle.position.y = 0.02;
      particle.velocity.y = Math.abs(particle.velocity.y) * 0.3;
    }
    particle.rotation += particle.spin * deltaSeconds;
  }

  function writeParticle(particle, slot) {
    const lifeShare = particle.age / particle.life;
    const fadeIn = clamp(particle.age / 0.12, 0, 1);
    const fadeOut = Math.pow(1 - lifeShare, 1.4);
    const growth = 1 - Math.pow(1 - lifeShare, 2.2);
    const size = particle.isAlive ? lerp(particle.startSize, particle.endSize, growth) : 0;
    offsetSize.setXYZW(slot, particle.position.x, particle.position.y, particle.position.z, size);
    // The noise seed drifts with age so each puff keeps churning as it rises.
    const churningSeed = particle.seed + lifeShare * 0.35;
    look.setXYZW(slot, particle.opacity * fadeIn * fadeOut, particle.rotation, churningSeed, particle.kind);
  }

  return {
    // A chuff from one stack, timed with a tripod lifting.
    puff(vent, bodyVelocity) {
      for (let count = 0; count < 7; count++) {
        emitSteamFrom(vent, 0.6 + random() * 0.4, bodyVelocity);
      }
    },

    startBurst() {
      burstSecondsLeft = 0.6;
    },

    // Grit and a few sparks where a foot strikes.
    footStrike(position) {
      for (let count = 0; count < 4; count++) {
        emit({
          kind: KIND.dust,
          position,
          velocity: new THREE.Vector3(spread(0.6), lerp(0.15, 0.45, random()), spread(0.6)),
          life: lerp(0.7, 1.2, random()),
          startSize: 0.06,
          endSize: lerp(0.25, 0.42, random()),
          opacity: 0.45,
          drag: 3,
          lift: 0.05,
        });
      }
      for (let count = 0; count < 6; count++) {
        emit({
          kind: KIND.spark,
          position,
          velocity: new THREE.Vector3(spread(1.6), lerp(0.8, 2.2, random()), spread(1.6)),
          life: lerp(0.25, 0.55, random()),
          startSize: 0.04,
          endSize: 0.025,
          opacity: 1,
          drag: 1.2,
          lift: 0,
        });
      }
    },

    update(deltaSeconds, vents, bodyVelocity) {
      if (burstSecondsLeft > 0) {
        burstSecondsLeft -= deltaSeconds;
        vents.forEach((vent, ventIndex) => emitVentJet(vent, ventIndex));
      }
      wispTimer -= deltaSeconds;
      if (wispTimer <= 0) {
        wispTimer = 0.2;
        vents.forEach((vent) => emitSteamFrom(vent, 0.1, bodyVelocity));
      }
      particles.forEach((particle, slot) => {
        if (particle.isAlive) {
          updateParticle(particle, deltaSeconds);
        }
        writeParticle(particle, slot);
      });
      offsetSize.needsUpdate = true;
      look.needsUpdate = true;
    },
  };
}
