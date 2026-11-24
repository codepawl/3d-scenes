import * as THREE from 'three';

const WALK_SPEED = 2.4;
const RUN_SPEED = 5.0;
const EYE_ABOVE_WATER = 0.95;
const EYE_ABOVE_GROUND = 1.5;

export class CreekControls {
  constructor(camera, element, field, path) {
    this.camera = camera;
    this.element = element;
    this.field = field;
    this.path = path;
    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.scrollVelocity = 0;
    this.keys = new Set();
    this.dragging = false;
    this.handheld = true;
    this.enabled = true;
    this.sMin = path.sAtZ(47);
    this.sMax = path.culvertS - 3.2;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.tangent = new THREE.Vector2();
    this.bind();
  }

  bind() {
    const element = this.element;
    element.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.button !== 0) {
        return;
      }
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-dragging');
    });
    element.addEventListener('pointermove', (event) => {
      if (!this.dragging) {
        return;
      }
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.targetYaw -= dx * 0.0032;
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - dy * 0.0032, -1.2, 1.0);
    });
    const release = (event) => {
      if (!this.dragging) {
        return;
      }
      this.dragging = false;
      element.classList.remove('is-dragging');
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('wheel', (event) => {
      if (!this.enabled) {
        return;
      }
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      this.scrollVelocity = THREE.MathUtils.clamp(this.scrollVelocity + delta * 0.006, -7, 7);
    }, { passive: false });
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) {
        return;
      }
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
        this.keys.add(key);
        if (key.startsWith('arrow')) {
          event.preventDefault();
        }
      }
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Places the camera on the creek: s along the centreline, lateral offset, optional view angles.
  placeAlongCreek(s, lateral = 0, { yawOffset = 0, pitch = -0.1 } = {}) {
    const point = this.path.point(s, lateral);
    this.position.set(point.x, 0, point.z);
    this.position.y = this.eyeHeight(point.x, point.z);
    this.path.tangent(s, this.tangent);
    const yaw = Math.atan2(-this.tangent.x, -this.tangent.y) + yawOffset;
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.scrollVelocity = 0;
    this.apply(0);
  }

  setView({ x, y, z, yaw, pitch }) {
    this.position.set(x, y ?? this.eyeHeight(x, z), z);
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.scrollVelocity = 0;
    this.apply(0);
  }

  eyeHeight(x, z) {
    const ground = this.field.height(x, z);
    const water = this.field.water(x, z);
    return Math.max(ground + EYE_ABOVE_GROUND, water + EYE_ABOVE_WATER);
  }

  update(deltaTime, time) {
    const damping = 1 - Math.exp(-deltaTime * 10);
    this.yaw += (this.targetYaw - this.yaw) * damping;
    this.pitch += (this.targetPitch - this.pitch) * damping;

    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const ahead = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const strafe = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    if (ahead || strafe) {
      const speed = this.keys.has('shift') ? RUN_SPEED : WALK_SPEED;
      const move = this.forward.clone().multiplyScalar(ahead).addScaledVector(this.right, strafe).normalize();
      this.position.addScaledVector(move, speed * deltaTime);
    }

    if (Math.abs(this.scrollVelocity) > 0.01) {
      const { s } = this.path.locate(this.position.x, this.position.z);
      this.path.tangent(s, this.tangent);
      this.position.x += this.tangent.x * this.scrollVelocity * deltaTime;
      this.position.z += this.tangent.y * this.scrollVelocity * deltaTime;
      this.scrollVelocity *= Math.exp(-deltaTime * 2.6);
    } else {
      this.scrollVelocity = 0;
    }

    this.clampToCreek();
    const targetY = this.eyeHeight(this.position.x, this.position.z);
    this.position.y += (targetY - this.position.y) * (1 - Math.exp(-deltaTime * 5));
    this.apply(time);
  }

  clampToCreek() {
    const { s, lateral } = this.path.locate(this.position.x, this.position.z);
    const halfWidth = this.path.value(this.path.halfWidth, s);
    const clampedS = THREE.MathUtils.clamp(s, this.sMin, this.sMax);
    const clampedLateral = THREE.MathUtils.clamp(lateral, -halfWidth - 8, halfWidth + 8);
    if (clampedS !== s || clampedLateral !== lateral) {
      const point = this.path.point(clampedS, clampedLateral);
      this.position.x = point.x;
      this.position.z = point.z;
      if (clampedS !== s) {
        this.scrollVelocity = 0;
      }
    }
  }

  apply(time) {
    let yaw = this.yaw;
    let pitch = this.pitch;
    let roll = 0;
    if (this.handheld) {
      yaw += Math.sin(time * 0.53) * 0.0035 + Math.sin(time * 1.37 + 1.3) * 0.0012;
      pitch += Math.sin(time * 0.71 + 0.4) * 0.0028 + Math.sin(time * 1.91) * 0.001;
      roll = Math.sin(time * 0.43 + 2.1) * 0.0035;
    }
    this.camera.position.copy(this.position);
    if (this.handheld) {
      this.camera.position.y += Math.sin(time * 0.9) * 0.006;
    }
    this.camera.rotation.set(pitch, yaw, roll, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  // Distance along the view ray to the first terrain or water hit, for autofocus.
  focusDistance(direction, maxDistance = 70) {
    const origin = this.camera.position;
    let travelled = 0.3;
    let step = 0.08;
    while (travelled < maxDistance) {
      const x = origin.x + direction.x * travelled;
      const y = origin.y + direction.y * travelled;
      const z = origin.z + direction.z * travelled;
      if (!this.field.contains(x, z)) {
        return maxDistance;
      }
      const surface = Math.max(this.field.height(x, z), this.field.water(x, z));
      if (y <= surface) {
        return travelled;
      }
      travelled += step;
      step = Math.min(step * 1.04, 0.6);
    }
    return maxDistance;
  }
}
