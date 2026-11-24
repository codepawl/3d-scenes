// Deterministic frame capture: starts a Vite dev server, drives ?capture=1 in headless Chrome (GPU),
// pulls each frame with canvas.toDataURL and encodes with ffmpeg.
//   node scripts/capture.mjs                 -> ../render.mp4 (180 frames, 6 s @ 30 fps)
//   node scripts/capture.mjs --stills 0,90,179 --outdir <dir>   -> PNG stills only
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const stills = opt('--stills', null);
const FRAMES = Number(opt('--frames', 180));
const outFile = path.resolve(root, opt('--out', '../render.mp4'));
const frameDir = path.resolve(root, opt('--outdir', '.capture-frames'));

if (!stills) fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false, open: false } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'commit', timeout: 0 });
  const tc = Date.now();
  await page.waitForFunction(() => window.captureReady === true, null, { timeout: 600000 });
  console.log('ready after', ((Date.now() - tc) / 1000).toFixed(1), 's');
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('renderer:', gpu);

  const list = stills ? stills.split(',').map(Number) : [...Array(FRAMES).keys()];
  const t0 = Date.now();
  for (const n of list) {
    await page.evaluate((k) => window.renderFrame(k), n);
    const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
    const name = stills ? `still_${String(n).padStart(4, '0')}.png` : `f_${String(n).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(frameDir, name), Buffer.from(data.split(',')[1], 'base64'));
    if (!stills && n % 30 === 0) console.log(`frame ${n}/${FRAMES}`);
  }
  console.log(`captured ${list.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  if (!stills) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(frameDir, 'f_%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', outFile], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    fs.rmSync(frameDir, { recursive: true, force: true });
    console.log('wrote', path.relative(process.cwd(), outFile));
  }
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
