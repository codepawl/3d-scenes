// Deterministic frame capture: serves the app with Vite, drives window.renderFrame(n) in headless
// Chrome (GPU flags), pipes PNG frames into ffmpeg.
// Usage: node scripts/capture.mjs [--out ../render.mp4] [--frames 180] [--ss 2] [--stills dir --at 0,90,179]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = 1280, H = 720, FPS = 30;
const frames = Number(arg('frames', 180));
const ss = Number(arg('ss', 2));                 // supersampling factor
const out = resolve(process.cwd(), arg('out', resolve(root, '..', 'render.mp4')));
const stillsDir = arg('stills', null);
const stillsAt = (arg('at', '0,90,179')).split(',').map(Number);
const t0 = Number(arg('t0', 0));

const server = await createServer({ root, logLevel: 'error', server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`${url}?capture=1&w=${W * ss}&h=${H * ss}&t0=${t0}`);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

async function grab(n) {
  const b64 = await page.evaluate(async (n) => {
    await window.renderFrame(n);
    return document.querySelector('canvas').toDataURL('image/png').split(',')[1];
  }, n);
  return Buffer.from(b64, 'base64');
}

if (stillsDir) {
  mkdirSync(stillsDir, { recursive: true });
  for (const n of stillsAt) {
    const png = await grab(n);
    const f = resolve(stillsDir, `still_${String(n).padStart(4, '0')}.png`);
    writeFileSync(f, png);
    console.log('wrote', f);
  }
} else {
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-vf', `scale=${W}:${H}:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-preset', 'slow', '-r', String(FPS), '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const started = Date.now();
  for (let n = 0; n < frames; n++) {
    const png = await grab(n);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % 30 === 0) console.log(`frame ${n}/${frames} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exit ' + c)))));
  console.log('wrote', out);
}

await browser.close();
await server.close();
