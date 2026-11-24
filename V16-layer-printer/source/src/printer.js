// Printer hardware: frame, bed, moving gantry and hot end.
import * as THREE from 'three';

export const POST = 3.9;
const BENCH_Y = -1.15;
const GANTRY_DY = 1.15;

export function buildPrinter(T) {
  const root = new THREE.Group();
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z, parent = root) => {
    const m = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
    m.position.set(x, y, z); parent.add(m); return m;
  };
  const cyl = (rt, rb, h, mat, x, y, z, parent = root, seg = 24) => {
    const m = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat));
    m.position.set(x, y, z); parent.add(m); return m;
  };

  const anod = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.75, roughness: 1, map: T.brushed.map, roughnessMap: T.brushed.roughnessMap });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 1, map: T.brushed.map, roughnessMap: T.brushed.roughnessMap });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd6d8dc, metalness: 1.0, roughness: 0.22, map: T.brushed.map });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0, roughness: 1, map: T.grain.map, roughnessMap: T.grain.roughnessMap });
  const accent = new THREE.MeshStandardMaterial({ color: 0xc9561c, metalness: 0, roughness: 1, map: T.grain.map, roughnessMap: T.grain.roughnessMap });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8963e, metalness: 1, roughness: 0.32, map: T.brushed.map });
  const sock = new THREE.MeshStandardMaterial({ color: 0x8a2a1c, metalness: 0, roughness: 0.85, map: T.grain.map });
  const motor = new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.4, roughness: 0.6, map: T.grain.map });
  const bedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 1, map: T.bed.map, roughnessMap: T.bed.roughnessMap });

  // bench
  const bench = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 1, map: T.bench.map, roughnessMap: T.bench.roughnessMap, dithering: true }));
  bench.rotation.x = -Math.PI / 2; bench.position.y = BENCH_Y; bench.receiveShadow = true;
  root.add(bench);

  // frame
  const H = 6.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(0.3, H - BENCH_Y, 0.3, anod, sx * POST, (H + BENCH_Y) / 2, sz * POST);
    box(0.36, 0.08, 0.36, plastic, sx * POST, BENCH_Y + 0.04, sz * POST); // feet
  }
  for (const y of [BENCH_Y + 0.35, H - 0.15]) {
    for (const s of [-1, 1]) {
      box(2 * POST - 0.3, 0.3, 0.3, anod, 0, y, s * POST);
      box(0.3, 0.3, 2 * POST - 0.3, anod, s * POST, y, 0);
    }
  }
  // motors + lead screws on the back posts
  for (const sx of [-1, 1]) {
    box(0.45, 0.45, 0.45, motor, sx * (POST - 0.45), BENCH_Y + 0.75, -POST + 0.1);
    box(0.47, 0.06, 0.47, alu, sx * (POST - 0.45), BENCH_Y + 0.99, -POST + 0.1);
    cyl(0.045, 0.045, H - BENCH_Y - 1.4, steel, sx * (POST - 0.45), (H + BENCH_Y + 1.0) / 2, -POST + 0.1, root, 10);
  }
  // bed: spring steel sheet on heated aluminium plate on a carriage
  const bed = box(6.2, 0.06, 6.2, bedMat, 0, -0.03, 0);
  bed.castShadow = false;
  box(6.4, 0.22, 6.4, alu, 0, -0.17, 0);
  box(5.0, 0.12, 0.6, anod, 0, -0.5, 1.8); box(5.0, 0.12, 0.6, anod, 0, -0.5, -1.8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.11, 0.11, 0.3, brass, sx * 2.9, -0.36, sz * 2.9, root, 16);
  box(0.6, 0.08, 0.5, plastic, -2.5, -0.37, 3.15); // bed cable strain relief

  // moving gantry
  const gantry = new THREE.Group(); root.add(gantry);
  const sideRails = [];
  for (const s of [-1, 1]) {
    sideRails.push(box(0.24, 0.24, 2 * POST - 0.3, anod, s * (POST - 0.3), 0, 0, gantry));
    box(0.5, 0.4, 0.35, plastic, s * (POST - 0.18), 0, -POST + 0.1, gantry); // Z nuts
  }
  const beam = new THREE.Group(); gantry.add(beam);
  box(2 * POST - 0.85, 0.22, 0.22, anod, 0, 0, 0, beam);
  for (const dy of [-0.16, 0.16]) {
    const rod = cyl(0.03, 0.03, 2 * POST - 0.85, steel, 0, dy, 0.17, beam, 10);
    rod.rotation.z = Math.PI / 2;
  }
  for (const s of [-1, 1]) box(0.3, 0.32, 0.4, plastic, s * (POST - 0.3), 0, 0, beam);

  // head: everything placed relative to the nozzle tip at (0,0,0)
  const head = new THREE.Group(); root.add(head);
  const G = GANTRY_DY;
  box(0.7, 0.62, 0.32, plastic, 0, G - 0.02, 0.27, head);
  box(0.72, 0.1, 0.34, accent, 0, G + 0.31, 0.27, head);
  const fan = cyl(0.2, 0.2, 0.06, motor, 0, G - 0.05, 0.45, head); fan.rotation.x = Math.PI / 2;
  const hub = cyl(0.06, 0.06, 0.07, alu, 0, G - 0.05, 0.47, head, 12); hub.rotation.x = Math.PI / 2;
  for (let f = 0; f < 7; f++) cyl(0.15, 0.15, 0.025, alu, 0, 0.42 + f * 0.065, 0.1, head, 20); // heat sink
  cyl(0.04, 0.04, 0.5, steel, 0, 0.6, 0.1, head, 10);
  box(0.34, 0.2, 0.28, alu, 0.02, 0.24, 0.07, head);
  box(0.38, 0.2, 0.3, sock, 0.02, 0.24, 0.07, head).scale.set(1, 1.02, 1);
  cyl(0.06, 0.06, 0.06, brass, 0, 0.11, 0.0, head, 6); // hex
  cyl(0.055, 0.016, 0.09, brass, 0, 0.045, 0.0, head, 20); // nozzle cone
  box(0.3, 0.2, 0.12, accent, 0, 0.16, -0.22, head); // part cooling duct
  box(0.08, 0.12, 0.1, plastic, 0.32, 0.6, 0.27, head); // probe
  // filament + cable bundle
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, G + 0.35, 0.27), new THREE.Vector3(0.1, G + 1.0, 0.2), new THREE.Vector3(0.6, G + 1.6, -0.6), new THREE.Vector3(1.5, G + 1.9, -2.0),
  ]), 24, 0.035, 8), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.35, transparent: true, opacity: 0.85 }));
  tube.castShadow = true; head.add(tube);

  // nozzle glow (small point light)
  const glow = new THREE.PointLight(0xff9a50, 0.0, 1.2, 2);
  glow.position.set(0, 0.02, 0); head.add(glow);

  function update(hx, hy, hz, heat) {
    head.position.set(hx, hy, hz);
    gantry.position.y = hy + G;
    beam.position.z = hz;
    glow.intensity = heat;
  }
  return { root, update };
}
