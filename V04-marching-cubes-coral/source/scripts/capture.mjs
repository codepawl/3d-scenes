// Render the scene frame-by-frame in headless Chrome and encode render.mp4 with ffmpeg.
// Usage: node scripts/capture.mjs [--frames 180] [--out ../render.mp4] [--stills 0,90,179]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const frames = +opt('--frames', 180);
const out = path.resolve(root, opt('--out', '../render.mp4'));
const stills = opt('--stills', '');
const stillDir = path.resolve(root, opt('--stilldir', '../stills'));

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false, hmr: false, watch: null } });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1' + (opt('--query', '') ? '&' + opt('--query', '') : '');

const browser = await chromium.launch({
  headless: true,
  // --soft: CPU SwiftShader, for quick preview stills only (no GPU needed)
  args: args.includes('--soft')
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 300000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

const grab = async (n) => {
  const b64 = await page.evaluate(async (n) => {
    await window.renderFrame(n);
    return document.querySelector('canvas').toDataURL('image/png').split(',')[1];
  }, n);
  return Buffer.from(b64, 'base64');
};

if (stills) {
  fs.mkdirSync(stillDir, { recursive: true });
  for (const s of stills.split(',').map(Number)) {
    fs.writeFileSync(path.join(stillDir, `frame_${String(s).padStart(3, '0')}.png`), await grab(s));
    console.log('still', s);
  }
} else {
  const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let n = 0; n < frames; n++) {
    const png = await grab(n);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % 30 === 0) console.log(`frame ${n}/${frames} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('wrote', out);
}
await browser.close();
await server.close();
