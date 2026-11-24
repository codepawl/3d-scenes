import { SIMPLEX3 } from './noise.glsl.js';

export const N_ARCS = 16;

// ---------------------------------------------------------------- arcs
// Each filament is a camera-facing ribbon; its whole path is evaluated here from an endpoint
// direction (uEnd) supplied by JS. Branches share the trunk noise and diverge past a split point.
export const arcVert = /* glsl */ `
#define N ${N_ARCS}
${SIMPLEX3}
uniform float uTime;
uniform vec3  uEnd[N];
uniform float uPull[N];
uniform float uLevel[N];
uniform float uCoreR, uGlassR, uWidth;
attribute float aT, aSide, aArc, aBranch;
varying float vT, vS, vI, vSeed;

float splitAt(float t, float br){
  return br < 0.5 ? 0.0 : smoothstep(0.30 + 0.12*br, 0.62 + 0.14*br, t);
}

vec3 arcPos(float t, vec3 e0, vec3 eb, float br, float seed, float pull){
  float sp = splitAt(t, br);
  vec3 e = normalize(mix(e0, eb, sp));
  vec3 so = vnoise(vec3(seed*3.3, 4.0, uTime*0.22));
  so -= e0*dot(so, e0);
  vec3 s = normalize(e0 + so*0.7);
  vec3 dir = normalize(mix(s, e, pow(t, 0.65)));
  float r = mix(uCoreR, uGlassR, t);
  float env = pow(sin(3.14159*clamp(t,0.0,1.0)), 0.85);
  float amp = 0.15 * (1.0 - 0.35*pull);
  vec3 q = vec3(t*2.2 - uTime*0.85, seed, uTime*0.21);
  vec3 d = vnoise(q) + 0.45*vnoise(q*2.13 + 3.7);
  if (br > 0.5) {
    vec3 q2 = vec3(t*3.0 - uTime*1.05, seed + br*11.3, uTime*0.27);
    d = mix(d, vnoise(q2) + 0.45*vnoise(q2*2.3 + 1.3), sp);
  }
  d += 0.08 * vnoise(vec3(t*17.0 - uTime*3.0, seed*5.1, uTime*5.0));
  d -= dir*dot(d, dir);
  return dir*r + d*amp*env;
}

void main(){
  int i = int(aArc + 0.5);
  float seed = aArc*1.731 + 0.37;
  float pull = uPull[i];
  vec3 e0 = uEnd[i];
  vec3 eb = e0;
  if (aBranch > 0.5) {
    vec3 off = vnoise(vec3(seed*7.1, aBranch*13.7, uTime*0.33));
    off -= e0*dot(off, e0);
    eb = normalize(e0 + off*0.55*(1.0 - 0.9*pull));
  }
  vec3 P  = arcPos(aT, e0, eb, aBranch, seed, pull);
  vec3 P2 = arcPos(aT + 0.004, e0, eb, aBranch, seed, pull);
  vec4 mv  = modelViewMatrix * vec4(P, 1.0);
  vec4 mv2 = modelViewMatrix * vec4(P2, 1.0);
  vec3 tg = normalize(mv2.xyz - mv.xyz);
  vec3 side = normalize(cross(tg, normalize(-mv.xyz)));
  float lvl = uLevel[i];
  float sp = splitAt(aT, aBranch);
  float w = uWidth * (aBranch > 0.5 ? 0.7 : 1.0) * (0.7 + 0.6*lvl) * (1.0 + 0.4*pull);
  w *= mix(0.6, 1.0, smoothstep(0.0, 0.25, aT));
  mv.xyz += side * aSide * w;
  gl_Position = projectionMatrix * mv;
  vT = aT; vS = aSide; vSeed = seed + aBranch*3.1;
  vI = lvl * (1.0 + 0.5*pull) * (aBranch > 0.5 ? 0.55*sp : 1.0);
}
`;

export const arcFrag = /* glsl */ `
${SIMPLEX3}
uniform float uTime;
varying float vT, vS, vI, vSeed;
void main(){
  float s2 = vS*vS;
  float core = exp(-s2*45.0);
  float halo = exp(-s2*4.0) * (1.0 - s2);
  float flick = 0.72 + 0.28*snoise(vec3(vSeed*2.7, uTime*9.0, vT*3.0));
  float fade = smoothstep(0.0, 0.10, vT) * (1.0 + 1.3*smoothstep(0.80, 1.0, vT));
  vec3 hot = mix(vec3(1.0, 0.82, 1.0), vec3(0.80, 0.50, 1.0), smoothstep(0.2, 1.0, vT));
  vec3 col = hot*core*2.0 + vec3(0.55, 0.20, 1.0)*halo*0.40;
  col *= vI * fade * flick;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- glass
// Glow where each filament meets the glass, plus the finger contact spot.
const SPOTS = /* glsl */ `
#define N ${N_ARCS}
uniform vec3  uEnd[N];
uniform float uLevel[N];
uniform float uPull[N];
uniform vec3  uFingerDir;
uniform float uTouch;
vec3 plasmaSpots(vec3 n){
  float tight = 0.0, wide = 0.0;
  for (int i = 0; i < N; i++){
    float a = max(0.0, 1.0 - dot(n, uEnd[i]));
    float l = uLevel[i] * (1.0 + 0.4*uPull[i]);
    tight += l * exp(-a*700.0);
    wide  += l * exp(-a*45.0);
  }
  float c = max(0.0, 1.0 - dot(n, uFingerDir));
  float contact = uTouch * (exp(-c*1500.0)*2.5 + exp(-c*120.0)*0.45);
  return vec3(1.0,0.75,1.0)*(tight*0.9 + contact) + vec3(0.55,0.2,1.0)*(wide*0.06 + contact*0.25);
}
`;

const STUDIO = /* glsl */ `
// Procedural studio environment: two soft boxes + a dim ceiling panel, everything else near black.
float box(vec3 r, vec3 c, vec2 size, float soft){
  vec3 a = normalize(c);
  vec3 u = normalize(cross(vec3(0.0,1.0,0.0), a) + vec3(1e-4, 0.0, 0.0));
  vec3 v = cross(a, u);
  float d = dot(r, a);
  if (d <= 0.0) return 0.0;
  vec2 p = vec2(dot(r,u), dot(r,v)) / d;
  vec2 q = abs(p) - size;
  float dist = length(max(q, 0.0)) + min(max(q.x,q.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, dist);
}
vec3 studio(vec3 r){
  vec3 c = vec3(0.004, 0.003, 0.008) + vec3(0.02,0.018,0.03)*smoothstep(0.2, 1.0, r.y);
  c += vec3(1.0, 0.93, 0.85) * 2.2 * box(r, vec3(-1.0, 0.7, 0.6), vec2(0.22, 0.36), 0.05);
  c += vec3(0.75, 0.82, 1.0) * 0.9 * box(r, vec3(1.0, 0.35, -0.3), vec2(0.18, 0.7), 0.05);
  c += vec3(0.9, 0.9, 1.0) * 0.25 * box(r, vec3(0.05, 1.0, 0.05), vec2(0.6, 0.6), 0.3);
  return c;
}
`;

export const glassVert = /* glsl */ `
varying vec3 vN, vW, vL;
void main(){
  vL = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const glassFrag = /* glsl */ `
${SPOTS}
${STUDIO}
uniform vec3 uCenter;
uniform float uRadius, uBack, uTime;
varying vec3 vN, vW, vL;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  vec3 Nn = normalize(vN);
  vec3 Nf = uBack > 0.5 ? -Nn : Nn;
  float ndv = clamp(dot(Nf, V), 0.0, 1.0);
  float F = 0.04 + 0.96*pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, Nf);
  vec3 refl = studio(R) * F;
  // gas haze: chord length of the view ray through the sphere + glow toward the core
  vec3 rd = -V;
  vec3 oc = cameraPosition - uCenter;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uRadius*uRadius;
  float h = max(b*b - c, 0.0);
  float chord = 2.0*sqrt(h);
  vec3 closest = oc - rd*b;
  float rc = length(closest);
  vec3 haze = vec3(0.30, 0.10, 0.55) * chord * 0.022 + vec3(0.9,0.45,1.0) * exp(-rc*rc*22.0) * 0.25;
  haze *= (1.0 + 0.6*uTouch);
  vec3 spots = plasmaSpots(normalize(vL));
  vec3 col;
  float a;
  if (uBack > 0.5) {
    col = spots*0.9 + refl*0.12;
    a = 0.0;
  } else {
    col = refl + spots + haze;
    a = clamp(F*0.8 + 0.04, 0.0, 0.9);
  }
  gl_FragColor = vec4(col, a);
}
`;

// ---------------------------------------------------------------- core electrode
export const coreVert = /* glsl */ `
varying vec3 vN, vW, vL;
void main(){
  vL = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
export const coreFrag = /* glsl */ `
${SIMPLEX3}
uniform float uTime, uTouch;
varying vec3 vN, vW, vL;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float ndv = clamp(dot(normalize(vN), V), 0.0, 1.0);
  vec3 p = normalize(vL)*3.0;
  float n = snoise(p + vec3(0.0, -uTime*1.3, uTime*0.4))*0.5 + snoise(p*2.7 + uTime*0.8)*0.25;
  float hot = smoothstep(-0.2, 0.7, n);
  vec3 col = mix(vec3(0.45,0.12,0.9), vec3(1.0,0.85,1.0), hot) * (1.6 + 1.6*hot) * (0.7 + 0.5*ndv);
  col *= 1.0 + 0.4*uTouch;
  col += vec3(0.6,0.3,1.0) * pow(1.0 - ndv, 2.0) * 1.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- lit solids (base, stem, finger)
// The plasma acts as a violet point light at the globe centre, plus a dim studio key.
export const solidVert = /* glsl */ `
uniform float uTaper;
varying vec3 vN, vW, vL;
void main(){
  vec3 pos = position;
  vL = position;
  float k = 1.0 + uTaper * clamp(position.y, -1.0, 1.0);
  pos.xz *= k;
  vec4 w = modelMatrix * vec4(pos, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
export const solidFrag = /* glsl */ `
${STUDIO}
uniform vec3 uAlbedo;
uniform float uRough, uSkin, uPlasma, uTouch, uTipGlow, uTime;
uniform vec3 uTipPos;
uniform float uNail, uFingerR;
varying vec3 vN, vW, vL;
void main(){
  vec3 N = normalize(vN);
  // fingernail: local +z side, between the tip and the first joint
  float nail = uNail * smoothstep(0.0, uFingerR*0.35, vL.z - uFingerR*0.35)
             * smoothstep(uFingerR*0.15, uFingerR*0.55, vL.y) * (1.0 - smoothstep(uFingerR*2.6, uFingerR*3.0, vL.y))
             * (1.0 - smoothstep(uFingerR*0.55, uFingerR*0.75, abs(vL.x)));
  // faint knuckle creases
  float crease = uNail * (1.0 - 0.35*exp(-pow((vL.y - uFingerR*4.4)/(uFingerR*0.12), 2.0)) * smoothstep(-0.2, 0.6, vL.z/uFingerR));
  vec3 alb = mix(uAlbedo, vec3(0.80, 0.58, 0.54), nail) * mix(1.0, crease, uNail);
  float rough = mix(uRough, 0.15, nail);
  vec3 V = normalize(cameraPosition - vW);
  float ndv = clamp(dot(N,V), 0.0, 1.0);
  vec3 Lp = -vW; float dp = length(Lp); Lp /= dp;
  float wrap = uSkin;
  float diffP = clamp((dot(N, Lp) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 plasmaCol = vec3(0.62, 0.30, 1.0) * uPlasma * (1.0 + 1.0*uTouch) / (0.6 + dp*dp);
  vec3 Lk = normalize(vec3(-1.0, 0.7, 0.6));
  float diffK = clamp((dot(N, Lk) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 col = alb * (diffP * plasmaCol + diffK * vec3(1.0,0.93,0.85) * 0.35 + vec3(0.02,0.02,0.035));
  col += uSkin * alb * vec3(1.0, 0.2, 0.12) * pow(1.0 - ndv, 1.5) * 0.45 * (0.3 + diffP);
  float F = 0.04 + 0.96*pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  col += studio(R) * F * (1.0 - rough);
  vec3 Hp = normalize(Lp + V);
  float sp = pow(clamp(dot(N, Hp), 0.0, 1.0), mix(400.0, 20.0, rough));
  col += plasmaCol * sp * (1.0 - rough*0.7) * 1.5;
  float dt = length(vW - uTipPos);
  col += vec3(1.0, 0.6, 1.0) * uTipGlow * uTouch * exp(-dt*dt*900.0) * 3.0;
  col += vec3(0.6, 0.25, 1.0) * uTipGlow * uTouch * exp(-dt*dt*90.0) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- floor & backdrop
export const floorFrag = /* glsl */ `
${STUDIO}
uniform float uTouch, uTime;
varying vec3 vN, vW, vL;
void main(){
  float r = length(vW.xz);
  vec3 V = normalize(cameraPosition - vW);
  float pool = exp(-r*r*0.9) * (0.08 + 0.05*uTouch);
  vec3 col = vec3(0.012, 0.010, 0.018) + vec3(0.55, 0.22, 1.0) * pool;
  float F = 0.04 + 0.96*pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
  col += studio(reflect(-V, vec3(0.0,1.0,0.0))) * F * 0.25;
  col *= 1.0 - smoothstep(3.0, 9.0, r);
  gl_FragColor = vec4(col, 1.0);
}
`;
export const skyVert = /* glsl */ `
varying vec3 vD;
void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
export const skyFrag = /* glsl */ `
varying vec3 vD;
void main(){
  vec3 col = mix(vec3(0.003,0.0025,0.005), vec3(0.008,0.006,0.015), smoothstep(-0.2, 0.6, vD.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- post
export const fsVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// 13-tap downsample, after Jimenez, "Next Generation Post Processing in Call of Duty: AW" (SIGGRAPH 2014)
export const downFrag = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst;
varying vec2 vUv;
vec3 s(vec2 o){ vec3 c = texture2D(tSrc, vUv + o*uTexel).rgb; return uFirst > 0.5 ? min(c, vec3(40.0)) : c; }
void main(){
  vec3 a = s(vec2(-2,2)), b = s(vec2(0,2)), c = s(vec2(2,2));
  vec3 d = s(vec2(-2,0)), e = s(vec2(0,0)), f = s(vec2(2,0));
  vec3 g = s(vec2(-2,-2)), h = s(vec2(0,-2)), i = s(vec2(2,-2));
  vec3 j = s(vec2(-1,1)), k = s(vec2(1,1)), l = s(vec2(-1,-1)), m = s(vec2(1,-1));
  vec3 o = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  gl_FragColor = vec4(o, 1.0);
}
`;
export const upFrag = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv).rgb*4.0;
  c += (texture2D(tSrc, vUv+vec2(-t.x,0.0)).rgb + texture2D(tSrc, vUv+vec2(t.x,0.0)).rgb
      + texture2D(tSrc, vUv+vec2(0.0,-t.y)).rgb + texture2D(tSrc, vUv+vec2(0.0,t.y)).rgb)*2.0;
  c += texture2D(tSrc, vUv+vec2(-t.x,-t.y)).rgb + texture2D(tSrc, vUv+vec2(t.x,-t.y)).rgb
     + texture2D(tSrc, vUv+vec2(-t.x,t.y)).rgb + texture2D(tSrc, vUv+vec2(t.x,t.y)).rgb;
  gl_FragColor = vec4(c/16.0*uWeight, 1.0);
}
`;
export const compositeFrag = /* glsl */ `
uniform sampler2D tScene, tBloom;
uniform float uBloom, uExposure, uFrame;
varying vec2 vUv;
// ACES filmic curve fit, Krzysztof Narkowicz (2015)
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
// interleaved gradient noise, Jimenez 2014
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  vec3 sc = texture2D(tScene, vUv).rgb;
  vec3 bl = texture2D(tBloom, vUv).rgb;
  vec3 c = (sc + bl*uBloom) * uExposure;
  vec2 q = (vUv - 0.5) * vec2(1.2, 1.0);
  c *= 1.0 - 0.7*dot(q, q);
  c = toSRGB(aces(c));
  float n = ign(gl_FragCoord.xy + uFrame*5.588238) + ign(gl_FragCoord.xy*1.37 + 17.0 + uFrame*3.1) - 1.0;
  c += n / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;
