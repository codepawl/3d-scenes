// Renders reference screenshots of the scene with headless Chromium on the GPU.
// Usage: node tools/shoot.mjs [--url http://localhost:5199] [--out shots] [--only name1,name2] [--views]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = option('url', 'http://localhost:5199');
const outDir = path.resolve(projectDir, option('out', 'shots'));
const only = option('only', '')?.split(',').filter(Boolean) ?? [];

const mainView = { z: -6, lateral: 0.2, options: { pitch: -0.1 } };
const shots = [];
for (const preset of ['afternoon', 'golden', 'blue', 'night']) {
  for (const dof of [true, false]) {
    shots.push({ name: `${preset}-${dof ? 'dof' : 'nodof'}`, preset, dof, view: mainView });
  }
}
if (args.includes('--views')) {
  shots.push(
    { name: 'view-culvert', preset: 'afternoon', dof: false, view: { z: -22, lateral: -0.3, options: { pitch: -0.05 } } },
    { name: 'view-start', preset: 'afternoon', dof: false, view: { z: 40, lateral: 0.4, options: { pitch: -0.15 } } },
    { name: 'view-bank', preset: 'afternoon', dof: false, view: { z: 14, lateral: 1.2, options: { yawOffset: 0.9, pitch: -0.25 } } },
    { name: 'view-night-cabin', preset: 'night', dof: false, view: { z: -24, lateral: 0.0, options: { pitch: 0.12 } } },
  );
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) {
    problems.push(`${message.type()}: ${message.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

await page.goto(`${baseUrl}/?capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.creek && (window.creek.ready || document.querySelector('.loading.has-error')), null, { timeout: 120000 });
const failed = await page.evaluate(() => document.querySelector('.loading.has-error')?.textContent);
if (failed) {
  console.log('load failed:', failed, problems.join('\n'));
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.fonts.ready);
await mkdir(outDir, { recursive: true });

for (const shot of shots) {
  if (only.length && !only.includes(shot.name)) {
    continue;
  }
  const started = Date.now();
  await page.evaluate(({ preset, dof, view }) => {
    const creek = window.creek;
    creek.setPreset(preset, true);
    creek.setToggle('dof', dof);
    creek.setToggle('dslr', true);
    creek.placeAlongCreek(view.z, view.lateral, view.options);
    creek.step(1 / 30, 40);
  }, shot);
  const file = path.join(outDir, `${shot.name}.png`);
  await page.screenshot({ path: file });
  console.log(`${shot.name}.png  ${Date.now() - started} ms`);
}

const stats = await page.evaluate(() => window.creek.stats());
console.log('stats', JSON.stringify({ calls: stats.renderer.calls, triangles: stats.renderer.triangles, grass: stats.grass, focus: stats.focus }));
if (problems.length) {
  console.log('console problems:\n' + [...new Set(problems)].slice(0, 30).join('\n'));
}
await browser.close();
