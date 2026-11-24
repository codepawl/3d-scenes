// Everything the viewer sees of the water: paddy surfaces, cascades over bunds, the forest stream, particles.
import * as THREE from 'three';
import { BLOCK, TERRACE, classify, heightAt, streamPath, streamIntake, downhillDirection } from './terrainField.js';
import { STREAM_GATE_FRACTION, MAX_PARTICLES } from './waterSim.js';

const SURFACE_CELL = 0.2;

export function buildPaddySurface(basins, environmentTexture, terrainSurface) {
  const heightTexture = new THREE.DataTexture(terrainSurface.heights, terrainSurface.columns, terrainSurface.rows, THREE.RedFormat, THREE.FloatType);
  heightTexture.minFilter = THREE.LinearFilter;
  heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.needsUpdate = true;
  const columns = Math.round((BLOCK.halfX * 2) / SURFACE_CELL) + 1;
  const rows = Math.round((BLOCK.halfZ * 2) / SURFACE_CELL) + 1;
  const identifiers = new Int8Array(columns * rows).fill(-1);
  const grounds = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -BLOCK.halfX + column * SURFACE_CELL;
      const z = -BLOCK.halfZ + row * SURFACE_CELL;
      const info = classify(x, z);
      const index = row * columns + column;
      if ((info.kind === 'shelf' || info.kind === 'bund' || info.kind === 'riser') && info.k < TERRACE.count) {
        identifiers[index] = info.k;
        grounds[index] = heightAt(x, z);
      }
    }
  }
  const vertexRemap = new Int32Array(columns * rows).fill(-1);
  const positions = [];
  const idAttribute = [];
  const groundAttribute = [];
  const indices = [];
  const useVertex = (column, row) => {
    const index = row * columns + column;
    if (vertexRemap[index] < 0) {
      vertexRemap[index] = positions.length / 3;
      positions.push(-BLOCK.halfX + column * SURFACE_CELL, 0, -BLOCK.halfZ + row * SURFACE_CELL);
      idAttribute.push(identifiers[index]);
      groundAttribute.push(grounds[index]);
    }
    return vertexRemap[index];
  };
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const id = identifiers[a];
      if (id < 0 || identifiers[a + 1] !== id || identifiers[a + columns] !== id || identifiers[a + columns + 1] !== id) continue;
      const va = useVertex(column, row);
      const vb = useVertex(column + 1, row);
      const vc = useVertex(column, row + 1);
      const vd = useVertex(column + 1, row + 1);
      indices.push(va, vc, vb, vb, vc, vd);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('paddyId', new THREE.Float32BufferAttribute(idAttribute, 1));
  geometry.setAttribute('groundHeight', new THREE.Float32BufferAttribute(groundAttribute, 1));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), 120);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-50, -5, -50), new THREE.Vector3(50, 40, 50));

  const planes = Array.from({ length: TERRACE.count }, () => new THREE.Vector4());
  const uniforms = {
    uPlanes: { value: planes }, uTime: { value: 0 }, uHeights: { value: heightTexture },
    uGridSize: { value: new THREE.Vector4(terrainSurface.columns, terrainSurface.rows, terrainSurface.cell, 0) },
    uSceneColor: { value: null }, uSceneDepth: { value: null }, uProj: { value: new THREE.Matrix4() },
    uNearFar: { value: new THREE.Vector2(1, 900) }, uReflectionBoost: { value: 2.2 },
  };
  // Shallow paddy water: a dark body over wet mud, fresnel reflection that ray-marches the scene rendered without
  // water (screen-space reflection, so forest, houses and bunds mirror), the HDRI as fallback.
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x0b1210, roughness: 0.035, metalness: 0, transparent: true, ior: 1.333, envMap: environmentTexture, envMapIntensity: 1.0, depthWrite: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float paddyId; attribute float groundHeight;
        uniform vec4 uPlanes[${TERRACE.count}]; uniform float uTime;
        varying float vSurfaceY; varying float vGround; varying vec3 vLocalXZ; varying float vPaddy;
        varying vec3 vAxisX; varying vec3 vAxisY; varying vec3 vAxisZ;`)
      .replace('#include <begin_vertex>', `
        vAxisX = normalMatrix * vec3(1.0, 0.0, 0.0);
        vAxisY = normalMatrix * vec3(0.0, 1.0, 0.0);
        vAxisZ = normalMatrix * vec3(0.0, 0.0, 1.0);
        int paddyIndex = int(paddyId + 0.5);
        vec4 plane = uPlanes[paddyIndex];
        vec3 transformed = vec3(position.x, plane.x + plane.y * position.x + plane.z * position.z, position.z);
        vSurfaceY = transformed.y;
        vGround = groundHeight;
        vLocalXZ = vec3(position.x, plane.w, position.z);
        vPaddy = paddyId;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uPlanes[${TERRACE.count}]; uniform float uTime; uniform sampler2D uHeights; uniform vec4 uGridSize;
        uniform sampler2D uSceneColor; uniform sampler2D uSceneDepth; uniform mat4 uProj; uniform vec2 uNearFar; uniform float uReflectionBoost;
        varying float vSurfaceY; varying float vGround; varying vec3 vLocalXZ; varying float vPaddy;
        varying vec3 vAxisX; varying vec3 vAxisY; varying vec3 vAxisZ;
        float groundHeightAt(vec2 p) {
          vec2 grid = (p + vec2(${BLOCK.halfX}.0, ${BLOCK.halfZ}.0)) / uGridSize.z + 0.5;
          return texture2D(uHeights, grid / uGridSize.xy).r;
        }
        float rippleHeight(vec2 p, float t, float amount) {
          float h = sin(p.x * 2.1 + t * 1.3 + sin(p.y * 1.7)) * 0.5 + sin(p.y * 2.9 - t * 1.7 + p.x * 0.8) * 0.4
                  + sin((p.x + p.y) * 4.7 + t * 2.6) * 0.25 + sin((p.x - p.y) * 7.9 - t * 3.3) * 0.12
                  + sin((p.x * 0.7 - p.y) * 13.0 + t * 4.1) * 0.06 + sin((p.x + p.y * 0.6) * 21.0 - t * 5.3) * 0.035;
          return h * amount;
        }
        float viewZFromDepth(float depth, float near, float far) { return (near * far) / ((far - near) * depth - far); }
        vec4 traceReflection(vec3 origin, vec3 direction) {
          float stepLength = 0.3;
          vec3 point = origin + direction * 0.04;
          for (int i = 0; i < 80; i++) {
            point += direction * stepLength;
            stepLength *= 1.065;
            vec4 clip = uProj * vec4(point, 1.0);
            if (clip.w <= 0.0) break;
            vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            float sceneZ = viewZFromDepth(texture2D(uSceneDepth, uv).x, uNearFar.x, uNearFar.y);
            float gap = sceneZ - point.z;
            if (gap > 0.0 && gap < stepLength * 2.2 + 0.25) {
              vec3 low = point - direction * stepLength / 1.065;
              vec3 high = point;
              for (int j = 0; j < 7; j++) {
                vec3 middle = (low + high) * 0.5;
                vec4 middleClip = uProj * vec4(middle, 1.0);
                vec2 middleUv = middleClip.xy / middleClip.w * 0.5 + 0.5;
                float middleZ = viewZFromDepth(texture2D(uSceneDepth, middleUv).x, uNearFar.x, uNearFar.y);
                if (middleZ - middle.z > 0.0) high = middle; else low = middle;
              }
              vec4 hitClip = uProj * vec4(high, 1.0);
              vec2 hitUv = hitClip.xy / hitClip.w * 0.5 + 0.5;
              vec2 edge = smoothstep(0.0, 0.06, hitUv) * smoothstep(1.0, 0.94, hitUv);
              return vec4(texture2D(uSceneColor, hitUv).rgb, edge.x * edge.y);
            }
          }
          return vec4(0.0);
        }`)
      .replace('#include <normal_fragment_begin>', `
        vec4 planeData = uPlanes[int(vPaddy + 0.5)];
        float amount = 0.014 + 0.03 * vLocalXZ.y;
        vec2 rp = vLocalXZ.xz;
        float e = 0.05;
        float hx = rippleHeight(rp + vec2(e, 0.0), uTime, amount) - rippleHeight(rp - vec2(e, 0.0), uTime, amount);
        float hz = rippleHeight(rp + vec2(0.0, e), uTime, amount) - rippleHeight(rp - vec2(0.0, e), uTime, amount);
        vec3 localNormal = normalize(vec3(-planeData.y - hx / (2.0 * e), 1.0, -planeData.z - hz / (2.0 * e)));
        vec3 normal = normalize(vAxisX * localNormal.x + vAxisY * localNormal.y + vAxisZ * localNormal.z);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float waterDepth = vSurfaceY - groundHeightAt(vLocalXZ.xz);
        // Where a tilted water plane reaches out over a riser face or past the block edge, there is no paddy under it.
        if (waterDepth < 0.0008 || waterDepth > 0.9) discard;
        float bodyDepth = smoothstep(0.02, 0.5, waterDepth);
        // Clear shallow water: a light turquoise tint that thickens with depth, so the mud bed shows through at the edges.
        diffuseColor.rgb = mix(vec3(0.16, 0.30, 0.27), vec3(0.03, 0.2, 0.22), bodyDepth);
        diffuseColor.a = mix(0.10, 0.5, bodyDepth) * smoothstep(0.0, 0.04, waterDepth);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          vec3 viewPosition = -vViewPosition;
          vec3 viewDirection = normalize(viewPosition);
          vec3 reflected = reflect(viewDirection, normal);
          float cosine = clamp(dot(normal, -viewDirection), 0.0, 1.0);
          float fresnel = 0.075 + 0.925 * pow(1.0 - cosine, 4.0);
          vec4 hit = traceReflection(viewPosition, reflected);
          reflectedLight.indirectSpecular *= 4.5 * (1.0 - hit.a);
          reflectedLight.indirectSpecular += hit.rgb * hit.a * fresnel * uReflectionBoost;
          // Bright pale-sky sheen with Fresnel where the traced ray found nothing.
          float skyFresnel = (0.04 + 0.96 * pow(1.0 - cosine, 3.4)) * (0.45 + 0.55 * bodyDepth);
          vec3 skyTint = mix(vec3(0.62, 0.82, 0.92), vec3(0.95, 0.98, 1.0), pow(max(reflected.y, 0.0), 0.5));
          reflectedLight.indirectSpecular += skyTint * skyFresnel * 0.95 * (1.0 - hit.a * 0.7);
          float shore = smoothstep(0.0, 0.03, waterDepth);
          reflectedLight.indirectSpecular *= shore;
          reflectedLight.directSpecular *= shore;
        }`)
      .replace('#include <opaque_fragment>', `
        gl_FragColor = vec4(totalDiffuse * diffuseColor.a + totalSpecular, diffuseColor.a);`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;
  void environmentTexture;
  return { mesh, uniforms, planes };
}

const FLOW_VERTEX = `
  attribute vec3 across;
  attribute float along;
  attribute float flow;
  attribute float side;
  varying float vAlong; varying float vFlow; varying float vSide; varying vec3 vWorldPosition;
  void main() {
    float widen = (0.9 + 0.5 * clamp(flow / 1.4, 0.0, 1.0)) * (0.8 + 0.5 * along);
    vec3 displaced = position + across * widen;
    vAlong = along;
    vFlow = flow;
    vSide = side;
    vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
    vWorldPosition = displaced;
    gl_Position = projectionMatrix * mv;
  }`;

const FLOW_FRAGMENT = `
  uniform float uTime; uniform float uScale; uniform float uSpeed; uniform vec3 uTint;
  varying float vAlong; varying float vFlow; varying float vSide; varying vec3 vWorldPosition;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float flowAlpha = smoothstep(0.3, 0.9, vFlow);
    if (flowAlpha < 0.01) discard;
    vec2 p = vec2(vWorldPosition.x * 3.1 + vWorldPosition.z * 2.3, vAlong * uScale - uTime * uSpeed);
    float streaks = noise(p * vec2(1.0, 0.5)) * 0.6 + noise(p * vec2(2.6, 1.3) + 7.0) * 0.4;
    // Clear water: a translucent body, brighter where the sheet thins at its sides (refraction-like), and a thin
    // white foam core only where the sheet breaks (high streak noise, mostly toward the bottom of the fall).
    float edge = abs(vSide);
    float thin = smoothstep(0.45, 1.0, edge);
    float breaking = smoothstep(0.62, 0.92, streaks) * smoothstep(0.25, 0.85, vAlong);
    float core = (1.0 - smoothstep(0.0, 0.3, edge)) * breaking;
    vec3 color = mix(uTint, vec3(0.78, 0.93, 0.97), thin * 0.65);
    color = mix(color, vec3(0.97, 1.0, 1.0), core);
    float alpha = flowAlpha * (0.2 + 0.2 * thin + 0.5 * core) * (1.0 - 0.6 * smoothstep(0.9, 1.0, edge));
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function resamplePath(path, count) {
  const lengths = [0];
  for (let index = 1; index < path.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(path[index].x - path[index - 1].x, path[index].z - path[index - 1].z, path[index].y - path[index - 1].y));
  }
  const total = lengths[lengths.length - 1] || 1;
  const points = [];
  let segment = 0;
  for (let step = 0; step <= count; step += 1) {
    const target = (step / count) * total;
    while (segment < path.length - 2 && lengths[segment + 1] < target) segment += 1;
    const span = lengths[segment + 1] - lengths[segment] || 1;
    const t = Math.min(Math.max((target - lengths[segment]) / span, 0), 1);
    const a = path[segment];
    const b = path[segment + 1];
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  }
  return points;
}

function hashNumber(index) {
  return Math.abs(Math.sin(index * 127.1 + 31.7) * 43758.5453) % 1;
}

// The sheet leaves the lip nearly horizontally, bows out over it and bends down onto the shelf below,
// instead of lying as a flat strip on the riser.
function arcOverLip(path, count) {
  const start = path[0];
  const end = path[path.length - 1];
  const reach = { x: end.x - start.x, z: end.z - start.z };
  const drop = Math.max(start.y - end.y, 0.05);
  const points = [];
  for (let step = 0; step <= count; step += 1) {
    const u = step / count;
    const outward = 1 - Math.pow(1 - u, 1.8);
    points.push({ x: start.x + reach.x * outward, y: start.y + 0.03 - (drop + 0.03) * Math.pow(u, 1.6), z: start.z + reach.z * outward });
  }
  return points;
}

function createFlowMaterial(options) {
  return new THREE.ShaderMaterial({
    vertexShader: FLOW_VERTEX,
    fragmentShader: FLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: options.scale }, uSpeed: { value: options.speed }, uTint: { value: new THREE.Color(options.tint) },
    },
  });
}

// One thin ribbon per lip: from the lip, down the face of the riser, to the shelf below.
export function buildCascades(lips, intakeItem) {
  const items = [...lips.map((lip, lipIndex) => ({ path: lip.path, width: lip.isNotch ? lip.width * (0.95 + 0.7 * hashNumber(lipIndex)) : lip.width * 1.2, edge: lip.edge, arc: Boolean(lip.isNotch) && !lip.edge })), intakeItem];
  const segments = 8;
  const perItem = (segments + 1) * 2;
  const positions = new Float32Array(items.length * perItem * 3);
  const across = new Float32Array(items.length * perItem * 3);
  const alongs = new Float32Array(items.length * perItem);
  const sides = new Float32Array(items.length * perItem);
  const flows = new Float32Array(items.length * perItem);
  const indices = [];
  items.forEach((item, itemIndex) => {
    const points = item.arc ? arcOverLip(item.path, segments) : resamplePath(item.path, segments);
    for (let step = 0; step <= segments; step += 1) {
      const current = points[step];
      const next = points[Math.min(step + 1, segments)];
      const previous = points[Math.max(step - 1, 0)];
      const tangent = new THREE.Vector3(next.x - previous.x, next.y - previous.y, next.z - previous.z).normalize();
      const sideways = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0));
      if (sideways.lengthSq() < 1e-4) sideways.set(item.edge ? item.edge.z : 1, 0, item.edge ? -item.edge.x : 0);
      sideways.normalize().multiplyScalar(item.width * 0.55);
      for (let side = 0; side < 2; side += 1) {
        const vertex = itemIndex * perItem + step * 2 + side;
        const sign = side === 0 ? -1 : 1;
        const lift = item.edge ? 0.04 : 0.06;
        positions.set([current.x + (item.edge ? item.edge.x * 0.04 : 0), current.y + (item.edge ? 0 : lift), current.z + (item.edge ? item.edge.z * 0.04 : 0)], vertex * 3);
        across.set([sideways.x * sign, sideways.y * sign, sideways.z * sign], vertex * 3);
        alongs[vertex] = step / segments;
        sides[vertex] = sign;
      }
      if (step < segments) {
        const a = itemIndex * perItem + step * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('across', new THREE.BufferAttribute(across, 3));
  geometry.setAttribute('along', new THREE.BufferAttribute(alongs, 1));
  geometry.setAttribute('side', new THREE.BufferAttribute(sides, 1));
  const flowAttribute = new THREE.BufferAttribute(flows, 1);
  flowAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('flow', flowAttribute);
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), 120);
  const material = createFlowMaterial({ scale: 1.6, speed: 3.2, tint: 0x5f7f86 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return {
    mesh,
    itemCount: items.length,
    update(lipFlows, intakeFlow, time) {
      for (let item = 0; item < items.length; item += 1) {
        const isBlockEdge = item < lipFlows.length && items[item].edge;
        const isCrest = item < lipFlows.length && !items[item].arc && !items[item].edge;
        // Plain bund crests only show when they carry real flow; small sloshing trickles would read as a glass fence.
        const value = isBlockEdge ? 0 : (item < lipFlows.length ? lipFlows[item] * (isCrest ? 0.5 : 1) : intakeFlow);
        for (let vertex = 0; vertex < perItem; vertex += 1) flows[item * perItem + vertex] = value;
      }
      flowAttribute.needsUpdate = true;
      material.uniforms.uTime.value = time;
    },
  };
}

export function buildIntakeItem() {
  const intake = streamIntake();
  const direction = downhillDirection(intake.x, intake.z);
  const path = [];
  let px = intake.x;
  let pz = intake.z;
  for (let step = 0; step < 14; step += 1) {
    path.push({ x: px, z: pz, y: heightAt(px, pz) + 0.02 });
    const info = classify(px, pz);
    if (info.kind === 'shelf') break;
    px += direction.x * 0.45;
    pz += direction.z * 0.45;
  }
  return { path, width: 1.5, edge: null };
}

export function buildStream() {
  const points = streamPath();
  const positions = [];
  const across = [];
  const alongs = [];
  const flows = [];
  const sideValues = [];
  const indices = [];
  points.forEach((point, index) => {
    const next = points[Math.min(index + 1, points.length - 1)];
    const previous = points[Math.max(index - 1, 0)];
    const tangent = new THREE.Vector3(next.x - previous.x, next.y - previous.y, next.z - previous.z).normalize();
    const sideways = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.8);
    const fraction = index / (points.length - 1);
    for (const sign of [-1, 1]) {
      positions.push(point.x, point.y, point.z);
      across.push(sideways.x * sign, 0, sideways.z * sign);
      sideValues.push(sign);
      alongs.push(fraction);
      flows.push(1.6);
    }
    if (index < points.length - 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('across', new THREE.Float32BufferAttribute(across, 3));
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(alongs, 1));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(sideValues, 1));
  geometry.setAttribute('flow', new THREE.Float32BufferAttribute(flows, 1));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), 120);
  const material = createFlowMaterial({ scale: 14, speed: 4.5, tint: 0x4b6e72 });
  material.uniforms.uExtent = { value: 1 };
  material.fragmentShader = material.fragmentShader
    .replace('uniform float uTime;', 'uniform float uExtent; uniform float uTime;')
    .replace('float flowAlpha = smoothstep(0.015, 0.25, vFlow);', 'float flowAlpha = smoothstep(0.0, 0.1, vFlow) * smoothstep(uExtent + 0.004, uExtent - 0.03, vAlong);');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return {
    mesh,
    update(extent, time) {
      material.uniforms.uExtent.value = extent;
      material.uniforms.uTime.value = time;
    },
  };
}

export function buildParticles() {
  const base = new THREE.InstancedBufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
  base.setIndex([0, 1, 2, 2, 1, 3]);
  const offsets = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const sizes = new Float32Array(MAX_PARTICLES);
  const ages = new Float32Array(MAX_PARTICLES);
  const kinds = new Float32Array(MAX_PARTICLES);
  const attributes = {
    offset: new THREE.InstancedBufferAttribute(offsets, 3).setUsage(THREE.DynamicDrawUsage),
    velocity: new THREE.InstancedBufferAttribute(velocities, 3).setUsage(THREE.DynamicDrawUsage),
    size: new THREE.InstancedBufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage),
    age: new THREE.InstancedBufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage),
    kind: new THREE.InstancedBufferAttribute(kinds, 1).setUsage(THREE.DynamicDrawUsage),
  };
  for (const [name, attribute] of Object.entries(attributes)) base.setAttribute(name, attribute);
  base.instanceCount = MAX_PARTICLES;
  base.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uPixelScale: { value: 900 }, uResolution: { value: new THREE.Vector2(1920, 1080) } },
    vertexShader: `
      attribute vec3 offset; attribute vec3 velocity; attribute float size; attribute float age; attribute float kind;
      uniform float uPixelScale; uniform vec2 uResolution;
      varying float vAlpha; varying vec2 vUv; varying float vKind; varying float vAge; varying float vHash;
      void main() {
        float h1 = fract(sin(size * 7919.0 + 3.1) * 43758.5453);
        float h2 = fract(sin(size * 1301.0 + 7.7) * 24634.6345);
        vHash = h2;
        bool alive = age >= 0.0;
        float trailTime = kind < 0.5 ? mix(0.16, 0.08, smoothstep(0.5, 1.8, age)) : 0.03;
        vec4 headView = viewMatrix * vec4(offset, 1.0);
        vec4 tailView = viewMatrix * vec4(offset - velocity * trailTime, 1.0);
        vec4 headClip = projectionMatrix * headView;
        vec4 tailClip = projectionMatrix * tailView;
        vec2 headPixels = headClip.xy / headClip.w * uResolution * 0.5;
        vec2 tailPixels = tailClip.xy / tailClip.w * uResolution * 0.5;
        vec2 along = headPixels - tailPixels;
        float streakLength = max(length(along), 1.0);
        vec2 direction = along / streakLength;
        vec2 sideways = vec2(-direction.y, direction.x);
        float widthPixels = max(size * uPixelScale / -headView.z * (kind < 0.5 ? 0.8 + 1.0 * h1 : 1.0), kind < 0.5 ? 2.6 : 1.1);
        float breakup = kind < 0.5 ? mix(1.0, 0.55, smoothstep(0.6, 2.6, age)) : 1.0;
        vec2 pixels = mix(tailPixels, headPixels, position.y) + sideways * (position.x * 0.5 * breakup + (h2 - 0.5) * 0.6) * widthPixels;
        if (kind > 0.5) {
          // Spray and mist are soft round puffs that grow as they drift.
          float puff = widthPixels * (0.8 + age * (kind < 1.5 ? 1.1 : 2.2));
          pixels = headPixels + vec2(position.x, position.y * 2.0 - 1.0) * puff;
        }
        gl_Position = vec4(pixels / (uResolution * 0.5) * headClip.w, headClip.z, headClip.w);
        vUv = vec2(position.x, position.y);
        vKind = kind;
        vAge = age;
        float fadeIn = smoothstep(0.0, 0.05, age);
        float fadeOut = kind < 0.5 ? 1.0 - smoothstep(0.8, 1.9, age) : 1.0 - smoothstep(0.2, kind < 1.5 ? 1.0 : 0.8, age);
        float strength = kind < 0.5 ? 0.068 : (kind < 1.5 ? 0.03 : 0.025);
        vAlpha = alive ? fadeIn * fadeOut * strength : 0.0;
        if (!alive) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: `
      varying float vAlpha; varying vec2 vUv; varying float vKind; varying float vAge; varying float vHash;
      void main() {
        float alpha;
        vec3 color;
        if (vKind < 0.5) {
          // Falling water: a soft clear ribbon, brighter at its two sides, white core only once it has fallen and broken up.
          float across = abs(vUv.x);
          // Soft sheet: smooth profile, faint body, thin bright rim, white only when it has broken up low in the fall.
          float ribbon = exp(-across * across * 2.2);
          float rim = smoothstep(0.45, 0.8, across) * (1.0 - smoothstep(0.8, 1.0, across));
          float broken = smoothstep(1.2, 1.9, vAge) * smoothstep(0.55, 0.9, vHash);
          float core = (1.0 - smoothstep(0.0, 0.35, across)) * broken;
          float gap = smoothstep(0.05, 0.3, vHash);
          float lengthFade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - 0.5 * smoothstep(0.8, 1.0, vUv.y));
          alpha = (ribbon * 0.55 + rim * 0.5 + core * 0.6) * gap * lengthFade * vAlpha;
          color = mix(vec3(0.42, 0.78, 0.82), vec3(0.8, 0.95, 0.98), clamp(rim * 0.6 + core, 0.0, 1.0));
        } else {
          float radius = length(vec2(vUv.x, vUv.y * 2.0 - 1.0));
          alpha = pow(1.0 - smoothstep(0.0, 1.0, radius), 2.0) * vAlpha;
          color = vec3(0.8, 0.93, 0.96);
        }
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(color, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(base, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return {
    points: mesh,
    update(particles, pixelScale, resolution) {
      offsets.set(particles.position);
      velocities.set(particles.velocity);
      sizes.set(particles.size);
      kinds.set(particles.kind);
      for (let slot = 0; slot < MAX_PARTICLES; slot += 1) {
        const alive = particles.age[slot] < particles.life[slot];
        ages[slot] = alive ? particles.age[slot] : -1;
      }
      for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
      material.uniforms.uPixelScale.value = pixelScale;
      material.uniforms.uResolution.value.copy(resolution);
    },
  };
}

export const STREAM_GATE = STREAM_GATE_FRACTION;
