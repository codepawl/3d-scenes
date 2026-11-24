// Scales and places a loaded roach so its body (without antennae) is `bodyLength` units long, centred on x/z and
// standing on y = 0.
import * as THREE from 'three';

export function normaliseModel(root, bodyLength = 3) {
  const bodyBox = new THREE.Box3();
  root.traverse((node) => {
    if (node.isMesh && /Body|Head/.test(node.name)) bodyBox.expandByObject(node);
  });
  const size = bodyBox.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z);
  root.scale.setScalar(bodyLength / length);
  root.updateMatrixWorld(true);
  const fullBox = new THREE.Box3().setFromObject(root);
  const scaledBody = new THREE.Box3();
  root.traverse((node) => {
    if (node.isMesh && /Body|Head/.test(node.name)) scaledBody.expandByObject(node);
  });
  const center = scaledBody.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= fullBox.min.y;
  root.updateMatrixWorld(true);
}
