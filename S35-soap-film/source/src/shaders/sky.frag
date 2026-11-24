precision highp float;
#include <common>
#include <env>
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  gl_FragColor = vec4(envColor(d, 0.0), 1.0);
}
