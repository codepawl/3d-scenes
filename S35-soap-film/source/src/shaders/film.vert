uniform float uTime;
varying vec2 vLocal;
varying vec3 vWorld;
varying vec3 vNormalW;
#include <loop>
void main() {
  vec2 p = position.xy;
  float e = 0.004;
  float w = filmDisp(p, uTime);
  float wx = filmDisp(p + vec2(e, 0.0), uTime);
  float wy = filmDisp(p + vec2(0.0, e), uTime);
  vec3 n = normalize(vec3(-(wx - w) / e, -(wy - w) / e, 1.0));
  vec4 world = modelMatrix * vec4(p, w, 1.0);
  vLocal = p;
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * world;
}
