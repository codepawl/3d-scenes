// A dark mosaic tile floor: grout lines and a faint speckle so the ground reads as passing by in a tracking shot.
import * as THREE from 'three';

const TILE_SIZE = 2.5;
const TEXTURE_PIXELS = 512;

function tileTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_PIXELS;
  canvas.height = TEXTURE_PIXELS;
  const context = canvas.getContext('2d');
  context.fillStyle = '#6a625c';
  context.fillRect(0, 0, TEXTURE_PIXELS, TEXTURE_PIXELS);
  // Seeded speckle, so every load looks the same.
  let state = 12345;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  for (let index = 0; index < 2600; index++) {
    const shade = 80 + Math.floor(random() * 70);
    context.fillStyle = `rgb(${shade},${shade - 6},${shade - 10})`;
    context.fillRect(random() * TEXTURE_PIXELS, random() * TEXTURE_PIXELS, 2 + random() * 5, 2 + random() * 5);
  }
  const groutWidth = 56;
  context.fillStyle = '#16120f';
  context.fillRect(0, 0, TEXTURE_PIXELS, groutWidth / 2);
  context.fillRect(0, TEXTURE_PIXELS - groutWidth / 2, TEXTURE_PIXELS, groutWidth / 2);
  context.fillRect(0, 0, groutWidth / 2, TEXTURE_PIXELS);
  context.fillRect(TEXTURE_PIXELS - groutWidth / 2, 0, groutWidth / 2, TEXTURE_PIXELS);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function buildTileFloor(size = 400) {
  const texture = tileTexture();
  texture.repeat.set(size / TILE_SIZE, size / TILE_SIZE);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = size / 2 - 20;
  floor.receiveShadow = true;
  floor.name = 'floor';
  return floor;
}
