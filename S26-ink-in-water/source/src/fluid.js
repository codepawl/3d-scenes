// GPU stable-fluids solver (Stam 1999 style) on a 2D half-float grid.
// The grid spans the vertical mid-plane of the tank; the renderer lifts it into a volume.
import * as THREE from 'three';

const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const HEAD = /* glsl */ `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
uniform vec2 texel;   // 1 / grid resolution of the target
`;

// Semi-Lagrangian advection with optional MacCormack correction is overkill here;
// we advect the dye on a 2x finer grid, which keeps filaments crisp enough.
const ADVECT = HEAD + /* glsl */ `
uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform vec2 domain;      // world size of the grid (x, y)
uniform float dt;
uniform float dissipation;
uniform float isVelocity;
void main() {
  vec2 v = texture(uVel, vUv).xy;
  // RK2 backtrace in world units
  vec2 mid = vUv - 0.5 * dt * v / domain;
  vec2 v2 = texture(uVel, mid).xy;
  vec2 coord = vUv - dt * v2 / domain;
  vec4 r = texture(uSrc, coord) * dissipation;
  if (isVelocity > 0.5) {
    // no-slip-ish walls: kill velocity in the outer cell ring
    vec2 e = step(texel * 1.5, vUv) * step(vUv, 1.0 - texel * 1.5);
    r.xy *= e.x * e.y;
  } else {
    r = max(r, 0.0);
  }
  outColor = r;
}`;

const CURL = HEAD + /* glsl */ `
uniform sampler2D uVel;
uniform float dx;
void main() {
  float L = texture(uVel, vUv - vec2(texel.x, 0.0)).y;
  float R = texture(uVel, vUv + vec2(texel.x, 0.0)).y;
  float B = texture(uVel, vUv - vec2(0.0, texel.y)).x;
  float T = texture(uVel, vUv + vec2(0.0, texel.y)).x;
  outColor = vec4(((R - L) - (T - B)) / (2.0 * dx), 0.0, 0.0, 1.0);
}`;

// Body forces: vorticity confinement + negative buoyancy of the ink + a faint drifting turbulence.
const FORCES = HEAD + /* glsl */ `
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform sampler2D uDye;
uniform float dt;
uniform float dx;
uniform float vort;
uniform float gravity;
uniform float time;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}
void main() {
  float L = abs(texture(uCurl, vUv - vec2(texel.x, 0.0)).x);
  float R = abs(texture(uCurl, vUv + vec2(texel.x, 0.0)).x);
  float B = abs(texture(uCurl, vUv - vec2(0.0, texel.y)).x);
  float T = abs(texture(uCurl, vUv + vec2(0.0, texel.y)).x);
  float C = texture(uCurl, vUv).x;
  vec2 g = vec2(R - L, T - B);
  g /= length(g) + 1e-5;
  vec2 f = vort * dx * vec2(g.y, -g.x) * C;

  vec4 d = texture(uDye, vUv);
  float ink = d.r + d.g * 0.8;
  f.y -= gravity * ink;

  // faint large-scale stirring so the plume never falls perfectly symmetric
  vec2 q = vUv * vec2(3.0, 3.5) + vec2(0.0, time * 0.07);
  float e = 0.01;
  float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0.0)), ny = vnoise(q + vec2(0.0, e));
  f += 0.0035 * vec2(ny - n0, -(nx - n0)) / e;

  vec2 v = texture(uVel, vUv).xy + f * dt;
  v = clamp(v, -3.0, 3.0);
  outColor = vec4(v, 0.0, 1.0);
}`;

const DIVERGENCE = HEAD + /* glsl */ `
uniform sampler2D uVel;
uniform float dx;
void main() {
  vec2 C = texture(uVel, vUv).xy;
  float L = texture(uVel, vUv - vec2(texel.x, 0.0)).x;
  float R = texture(uVel, vUv + vec2(texel.x, 0.0)).x;
  float B = texture(uVel, vUv - vec2(0.0, texel.y)).y;
  float T = texture(uVel, vUv + vec2(0.0, texel.y)).y;
  // reflective walls (the free surface on top is treated as a slip lid)
  if (vUv.x - texel.x < 0.0) L = -C.x;
  if (vUv.x + texel.x > 1.0) R = -C.x;
  if (vUv.y - texel.y < 0.0) B = -C.y;
  if (vUv.y + texel.y > 1.0) T = -C.y;
  outColor = vec4((R - L + T - B) / (2.0 * dx), 0.0, 0.0, 1.0);
}`;

const SCALE = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform float k;
void main() { outColor = texture(uSrc, vUv) * k; }`;

const JACOBI = HEAD + /* glsl */ `
uniform sampler2D uP;
uniform sampler2D uDiv;
uniform float dx;
void main() {
  float L = texture(uP, vUv - vec2(texel.x, 0.0)).x;
  float R = texture(uP, vUv + vec2(texel.x, 0.0)).x;
  float B = texture(uP, vUv - vec2(0.0, texel.y)).x;
  float T = texture(uP, vUv + vec2(0.0, texel.y)).x;
  float div = texture(uDiv, vUv).x;
  outColor = vec4((L + R + B + T - div * dx * dx) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADSUB = HEAD + /* glsl */ `
uniform sampler2D uP;
uniform sampler2D uVel;
uniform float dx;
void main() {
  float L = texture(uP, vUv - vec2(texel.x, 0.0)).x;
  float R = texture(uP, vUv + vec2(texel.x, 0.0)).x;
  float B = texture(uP, vUv - vec2(0.0, texel.y)).x;
  float T = texture(uP, vUv + vec2(0.0, texel.y)).x;
  vec2 v = texture(uVel, vUv).xy - vec2(R - L, T - B) / (2.0 * dx);
  outColor = vec4(v, 0.0, 1.0);
}`;

// Gaussian splat: adds `value` weighted by an anisotropic gaussian around `point` (uv space).
const SPLAT = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 point;
uniform vec2 radius;   // uv-space radii
uniform vec4 value;
uniform float aspect;
void main() {
  vec2 d = (vUv - point) / radius;
  float w = exp(-dot(d, d));
  outColor = texture(uSrc, vUv) + value * w;
}`;

// Low-res blurred copy of the dye; the renderer uses it as a local "plume thickness" estimate.
const BLUR = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 srcTexel;
void main() {
  vec4 s = vec4(0.0);
  float wsum = 0.0;
  for (int j = -3; j <= 3; j++)
  for (int i = -3; i <= 3; i++) {
    vec2 o = vec2(float(i), float(j));
    float w = exp(-dot(o, o) / 6.0);
    s += texture(uSrc, vUv + o * srcTexel * 3.0) * w;
    wsum += w;
  }
  outColor = s / wsum;
}`;

function rt(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

class PingPong {
  constructor(w, h) { this.a = rt(w, h); this.b = rt(w, h); this.w = w; this.h = h; }
  get read() { return this.a; }
  get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
}

export class Fluid {
  constructor(renderer, { simW = 320, domain = new THREE.Vector2(2.0, 2.14), dyeScale = 2 } = {}) {
    this.renderer = renderer;
    this.domain = domain;
    this.simW = simW;
    this.simH = Math.round(simW * domain.y / domain.x);
    this.dx = domain.x / this.simW;
    this.dyeW = this.simW * dyeScale;
    this.dyeH = this.simH * dyeScale;

    this.vel = new PingPong(this.simW, this.simH);
    this.dye = new PingPong(this.dyeW, this.dyeH);
    this.pres = new PingPong(this.simW, this.simH);
    this.div = rt(this.simW, this.simH);
    this.curl = rt(this.simW, this.simH);
    this.blur = rt(Math.round(this.dyeW / 4), Math.round(this.dyeH / 4));

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const m = (frag, uniforms) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag,
      uniforms: { texel: { value: new THREE.Vector2() }, ...uniforms },
      depthTest: false, depthWrite: false,
    });
    const u = (v) => ({ value: v });
    this.m = {
      advect: m(ADVECT, { uVel: u(null), uSrc: u(null), domain: u(domain), dt: u(0), dissipation: u(1), isVelocity: u(0) }),
      curl: m(CURL, { uVel: u(null), dx: u(this.dx) }),
      forces: m(FORCES, { uVel: u(null), uCurl: u(null), uDye: u(null), dt: u(0), dx: u(this.dx), vort: u(18), gravity: u(0.55), time: u(0) }),
      div: m(DIVERGENCE, { uVel: u(null), dx: u(this.dx) }),
      scale: m(SCALE, { uSrc: u(null), k: u(1) }),
      jacobi: m(JACOBI, { uP: u(null), uDiv: u(null), dx: u(this.dx) }),
      grad: m(GRADSUB, { uP: u(null), uVel: u(null), dx: u(this.dx) }),
      splat: m(SPLAT, { uSrc: u(null), point: u(new THREE.Vector2()), radius: u(new THREE.Vector2()), value: u(new THREE.Vector4()), aspect: u(1) }),
      blur: m(BLUR, { uSrc: u(null), srcTexel: u(new THREE.Vector2(1 / this.dyeW, 1 / this.dyeH)) }),
    };
    this.pressureIters = 36;
    this.time = 0;
    this.clear();
  }

  pass(mat, target) {
    mat.uniforms.texel.value.set(1 / target.width, 1 / target.height);
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  clear() {
    const r = this.renderer;
    const prev = r.getClearColor(new THREE.Color());
    const pa = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of [this.vel.a, this.vel.b, this.dye.a, this.dye.b, this.pres.a, this.pres.b, this.div, this.curl, this.blur]) {
      r.setRenderTarget(t); r.clear();
    }
    r.setRenderTarget(null);
    r.setClearColor(prev, pa);
    this.time = 0;
  }

  // world-space splat: x in [-1,1], y in tank-floor-relative [0, domain.y]
  splat(target, wx, wy, rx, ry, value) {
    const s = this.m.splat;
    s.uniforms.uSrc.value = target.read.texture;
    s.uniforms.point.value.set((wx + this.domain.x / 2) / this.domain.x, wy / this.domain.y);
    s.uniforms.radius.value.set(rx / this.domain.x, ry / this.domain.y);
    s.uniforms.value.value.copy(value);
    this.pass(s, target.write);
    target.swap();
  }

  addVelocity(wx, wy, rx, ry, vx, vy) { this.splat(this.vel, wx, wy, rx, ry, new THREE.Vector4(vx, vy, 0, 0)); }
  addDye(wx, wy, rx, ry, r, g) { this.splat(this.dye, wx, wy, rx, ry, new THREE.Vector4(r, g, 0, 0)); }

  step(dt) {
    const M = this.m;
    this.time += dt;

    M.curl.uniforms.uVel.value = this.vel.read.texture;
    this.pass(M.curl, this.curl);

    M.forces.uniforms.uVel.value = this.vel.read.texture;
    M.forces.uniforms.uCurl.value = this.curl.texture;
    M.forces.uniforms.uDye.value = this.dye.read.texture;
    M.forces.uniforms.dt.value = dt;
    M.forces.uniforms.time.value = this.time;
    this.pass(M.forces, this.vel.write); this.vel.swap();

    M.div.uniforms.uVel.value = this.vel.read.texture;
    this.pass(M.div, this.div);

    M.scale.uniforms.uSrc.value = this.pres.read.texture;
    M.scale.uniforms.k.value = 0.8;
    this.pass(M.scale, this.pres.write); this.pres.swap();

    M.jacobi.uniforms.uDiv.value = this.div.texture;
    for (let i = 0; i < this.pressureIters; i++) {
      M.jacobi.uniforms.uP.value = this.pres.read.texture;
      this.pass(M.jacobi, this.pres.write); this.pres.swap();
    }

    M.grad.uniforms.uP.value = this.pres.read.texture;
    M.grad.uniforms.uVel.value = this.vel.read.texture;
    this.pass(M.grad, this.vel.write); this.vel.swap();

    M.advect.uniforms.dt.value = dt;
    M.advect.uniforms.uVel.value = this.vel.read.texture;
    M.advect.uniforms.uSrc.value = this.vel.read.texture;
    M.advect.uniforms.dissipation.value = 0.999;
    M.advect.uniforms.isVelocity.value = 1;
    this.pass(M.advect, this.vel.write); this.vel.swap();

    M.advect.uniforms.uVel.value = this.vel.read.texture;
    M.advect.uniforms.uSrc.value = this.dye.read.texture;
    M.advect.uniforms.dissipation.value = 0.9995;
    M.advect.uniforms.isVelocity.value = 0;
    this.pass(M.advect, this.dye.write); this.dye.swap();
  }

  updateBlur() {
    this.m.blur.uniforms.uSrc.value = this.dye.read.texture;
    this.pass(this.m.blur, this.blur);
  }
}
