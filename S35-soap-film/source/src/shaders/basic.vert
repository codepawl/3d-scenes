varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vObj = position;
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
