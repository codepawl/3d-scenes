// generic object vertex shader: object-space position/normal + world position
varying vec3 vObjPos;
varying vec3 vObjN;
varying vec3 vWorldPos;
void main() {
  vObjPos = position;
  vObjN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
