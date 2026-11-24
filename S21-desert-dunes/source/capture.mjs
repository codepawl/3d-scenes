// Deterministic frame capture: vite preview + headless Chrome (GPU) + ffmpeg.
// Usage: npm run build && node capture.mjs [out.mp4] [--frames N] [--ss 2] [--stills]
import { chromium } from 'playwright';
import { preview } from 'vite';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const out = resolve(here, args.find((a) => a.endsWith('.mp4')) || '../render.mp4');
const ss = opt('--ss', '2');
const only = opt('--only', null); // comma-separated frame list for quick stills
const framesDir = resolve(here, '.capture');

if (!existsSync(resolve(here, 'dist/index.html'))) {
  console.error('dist/ missing: run `npm run build` first');
  process.exit(1);
}
mkdirSync(framesDir, { recursive: true });
for (const f of readdirSync(framesDir)) if (f.endsWith('.png')) rmSync(resolve(framesDir, f));

const server = await preview({ root: here, preview: { port: 4321, strictPort: false, open: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(`${url}?capture=1&ss=${ss}`);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
const info = await page.evaluate(() => window.captureInfo);
const renderer = await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log('GPU:', renderer, info);

if (args.includes('--bench')) {
  // GPU timing at 1280x720 (ss=1): render frames back-to-back with glFinish
  const ms = await page.evaluate(async () => {
    const res = [];
    for (const n of [10, 60, 100, 150]) {
      await window.renderFrame(n);
      const t = performance.now();
      for (let i = 0; i < 30; i++) await window.renderFrameSync(n);
      res.push(((performance.now() - t) / 30).toFixed(2));
    }
    return res;
  });
  console.log('ms/frame at frames 10,60,100,150:', ms.join(', '));
}
const list = only ? only.split(',').map(Number) : [...Array(info.frames).keys()];
const t0 = Date.now();
for (const n of list) {
  await page.evaluate((k) => window.renderFrame(k), n);
  const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  writeFileSync(resolve(framesDir, `f${String(n).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
  if (n % 30 === 0) console.log(`frame ${n} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
await browser.close();
await server.close();

if (only) {
  console.log('stills written to', framesDir);
} else {
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(info.fps), '-i', resolve(framesDir, 'f%04d.png'),
    '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-preset', 'slow', '-movflags', '+faststart', out,
  ], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log('wrote', out);
}
