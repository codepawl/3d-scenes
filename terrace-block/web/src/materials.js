import * as THREE from 'three';

let maxAnisotropy = 8;
const loader = new THREE.TextureLoader();

function loadTexture(url, isColor) {
  return new Promise((resolve, reject) => {
    loader.load(url, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = maxAnisotropy;
      texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      resolve(texture);
    }, undefined, reject);
  });
}

export async function loadTextureSet(name) {
  const [diffuse, normal, roughness] = await Promise.all([
    loadTexture(`tex/${name}/diff.jpg`, true),
    loadTexture(`tex/${name}/nor.jpg`, false),
    loadTexture(`tex/${name}/rough.jpg`, false),
  ]);
  return { diffuse, normal, roughness };
}

export async function loadAllTextures(renderer) {
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const names = ['mud', 'grass', 'forest', 'rock', 'laterite', 'planks', 'thatch'];
  const sets = await Promise.all(names.map((name) => loadTextureSet(name)));
  const result = {};
  names.forEach((name, index) => { result[name] = sets[index]; });
  return result;
}

export function tiledMaterial(set, tile, options = {}) {
  const repeat = new THREE.Vector2(1 / tile, 1 / tile);
  const copies = [set.diffuse, set.normal, set.roughness].map((texture) => {
    const copy = texture.clone();
    copy.repeat.copy(repeat);
    copy.needsUpdate = true;
    return copy;
  });
  return new THREE.MeshStandardMaterial({
    map: copies[0],
    normalMap: copies[1],
    roughnessMap: copies[2],
    roughness: 1,
    ...options,
  });
}

// Procedural canvas textures for things no scan covers (leaves, straw, hide).
export function makeCanvasTexture(size, paint, isColor = true) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
}
