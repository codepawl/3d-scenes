// Renders ?capture=1 frame by frame in headless Chrome and encodes ../render.mp4 with ffmpeg.
// Usage: node scripts/capture.mjs [frames=180] [--stills]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frames = parseInt(process.argv[2] || '180', 10);
const onlyStills = process.argv.includes('--stills');
const outDir = path.join(root, '.capture-frames');
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(path.join(outDir, f), { force: true });
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.renderReady === true, null, { timeout: 120000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const list = onlyStills ? [0, Math.floor(frames / 2), frames - 1] : [...Array(frames).keys()];
const t0 = Date.now();
for (const n of list) {
  const data = await page.evaluate(async (n) => {
    await window.renderFrame(n);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
  writeFileSync(path.join(outDir, `f${String(n).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
  if (n % 30 === 0) console.log(`frame ${n} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
await browser.close();
await server.close();

if (!onlyStills) {
  const out = path.resolve(root, '..', 'render.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(outDir, 'f%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log('wrote', out);
}
