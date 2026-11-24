// Deterministic capture: builds nothing itself; serves dist/ with vite preview,
// drives ?capture=1 in headless Chrome, pipes PNG frames into ffmpeg.
//   node scripts/capture.mjs                 -> ../render.mp4 (180 frames, 30 fps)
//   node scripts/capture.mjs --stills 0,90,179 --outdir ../stills
import { chromium } from 'playwright';
import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FRAMES = parseInt(arg('--frames', '180'), 10);
const stills = arg('--stills', null);
const out = path.resolve(root, arg('--out', '../render.mp4'));
const outdir = path.resolve(root, arg('--outdir', '../stills'));

const server = await preview({ root, logLevel: 'warn', preview: { port: 4317, strictPort: false, open: false } });
const url = server.resolvedUrls.local[0] + '?capture=1';

const launchArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: launchArgs });
} catch {
  browser = await chromium.launch({ headless: true, channel: 'chrome', args: launchArgs });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', gpu);

const grab = (n) =>
  page.evaluate(async (n) => {
    await window.renderFrame(n);
    return document.querySelector('canvas').toDataURL('image/png');
  }, n);
const toBuf = (d) => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');

if (stills) {
  mkdirSync(outdir, { recursive: true });
  for (const s of stills.split(',').map(Number)) {
    const t0 = Date.now();
    writeFileSync(path.join(outdir, `frame_${String(s).padStart(3, '0')}.png`), toBuf(await grab(s)));
    console.log('still', s, Date.now() - t0, 'ms');
  }
} else {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  const t0 = Date.now();
  for (let n = 0; n < FRAMES; n++) {
    const buf = toBuf(await grab(n));
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % 30 === 0) console.log('frame', n, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  ff.stdin.end();
  await done;
  console.log('wrote', out);
}
await browser.close();
await new Promise((r) => server.httpServer.close(r));
