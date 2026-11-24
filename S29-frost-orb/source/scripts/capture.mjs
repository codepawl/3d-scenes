// Deterministic frame capture: vite dev server -> headless Chrome (GPU) -> PNG frames -> ffmpeg (H.264).
// Usage: node scripts/capture.mjs [--out ../render.mp4] [--frames 180] [--stills 0,90,179 --stillsDir dir] [--sub 12]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const out = path.resolve(root, args.out || '../render.mp4');
const frames = Number(args.frames || 180);
const sub = Number(args.sub || 12);
const stills = args.stills ? args.stills.split(',').map(Number) : null;

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}?capture=1&sub=${sub}`);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

async function grab(n) {
  await page.evaluate((n) => window.renderFrame(n), n);
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

if (stills) {
  const dir = path.resolve(root, args.stillsDir || 'stills');
  mkdirSync(dir, { recursive: true });
  for (const n of stills) {
    const t0 = Date.now();
    writeFileSync(path.join(dir, `frame_${String(n).padStart(3, '0')}.png`), await grab(n));
    console.log(`still ${n} (${Date.now() - t0} ms)`);
  }
} else {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let n = 0; n < frames; n++) {
    const png = await grab(n);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % 30 === 0) console.log(`frame ${n}/${frames} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exit ' + c)))));
  console.log('wrote', out);
}
await browser.close();
await server.close();
