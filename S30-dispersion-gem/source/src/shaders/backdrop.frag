// Studio backdrop: the same environment, softened, with faint mottling. Original work.
varying vec3 vObjPos;
varying vec3 vObjN;
varying vec3 vWorldPos;
void main() {
  vec3 d = normalize(vWorldPos - cameraPosition);
  vec3 col = env(d, 0.7) * 0.9;
  col *= 0.88 + 0.24 * fbm(d * 6.0);
  gl_FragColor = vec4(col, 1.0);
}
