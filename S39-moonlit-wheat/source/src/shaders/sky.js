import { common } from './common.glsl.js';

export const skyVertex = /* glsl */ `
${common}
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // pinned to the far plane
}
`;

export const skyFragment = /* glsl */ `
${common}
uniform vec3 uMoonColor;
varying vec3 vDir;

float treeline(float az) {
  float clump = smoothstep(0.35, 0.65, vnoise(vec2(az * 3.0, 1.7)));
  float crowns = fbm3(vec2(az * 40.0, 0.0)) * 0.6 + vnoise(vec2(az * 140.0, 3.0)) * 0.25;
  return 0.002 + clump * (0.005 + crowns * 0.012);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);
  float mu = max(dot(dir, uMoonDir), 0.0);

  // ---- thin drifting clouds on a virtual plane ----
  vec2 cuv = dir.xz / (dir.y + 0.12);
  vec2 drift = -uWindDir * uTime * 0.012;
  float c = fbm5(cuv * 1.4 + drift + vec2(0.0, 3.0));
  c = smoothstep(0.52, 0.85, c) * smoothstep(0.0, 0.25, dir.y);
  vec3 cloudCol = vec3(0.05, 0.06, 0.085) + vec3(0.55, 0.6, 0.7) * pow(mu, 30.0) * 1.2;

  // ---- stars ----
  vec3 sp = dir * 260.0;
  vec3 cell = floor(sp);
  vec3 fp = fract(sp) - 0.5;
  float h = hash13(cell);
  float star = 0.0;
  if (h > 0.985) {
    vec3 jitter = vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) - 0.5;
    float r = length(fp - jitter * 0.6);
    float mag = pow((h - 0.985) / 0.015, 3.0);
    float tw = 0.75 + 0.25 * sin(uTime * (3.0 + h * 9.0) + h * 100.0);
    star = smoothstep(0.18, 0.0, r) * (0.15 + 2.5 * mag) * tw;
  }
  star *= smoothstep(0.03, 0.25, dir.y) * (1.0 - smoothstep(0.85, 0.99, mu)) * (1.0 - c);
  col += vec3(0.75, 0.82, 1.0) * star * 0.35;

  // ---- moon disc with limb darkening and maria ----
  float moonR = 0.032;
  vec3 mRight = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
  vec3 mUp = normalize(cross(uMoonDir, mRight));
  vec2 mp = vec2(dot(dir, mRight), dot(dir, mUp)) / moonR;
  float md = length(mp);
  if (dot(dir, uMoonDir) > 0.0 && md < 1.2) {
    float disc = smoothstep(1.0, 0.96, md);
    float limb = sqrt(max(1.0 - md * md, 0.0));
    float maria = fbm5(mp * 2.2 + 4.0);
    float albedo = mix(0.55, 1.0, smoothstep(0.35, 0.65, maria));
    albedo *= 0.9 + 0.1 * vnoise(mp * 18.0);
    vec3 moonCol = vec3(1.0, 0.97, 0.9) * 6.0 * albedo * (0.6 + 0.4 * limb);
    col = mix(col, moonCol, disc * (1.0 - c * 0.7));
  }
  col += vec3(0.6, 0.68, 0.85) * pow(mu, 900.0) * 1.2;

  col = mix(col, cloudCol, c * 0.85);

  // ---- distant treeline ----
  float az = atan(dir.x, dir.z);
  float tl = treeline(az);
  float sil = smoothstep(tl + 0.0015, tl - 0.0015, dir.y);
  vec3 treeCol = skyBase(vec3(dir.x, 0.0, dir.z)) * 0.42;
  col = mix(col, treeCol, sil);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither(gl_FragCoord.xy, uTime);
}
`;
