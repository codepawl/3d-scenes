// Deterministic frame capture: vite dev server -> headless Chrome (GPU) -> PNG frames -> ffmpeg (H.264).
// Usage: node scripts/capture.mjs [--out ../render.mp4] [--frames 180] [--stills 0,90,179 --stills-dir dir]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const out = path.resolve(root, opt('out', '../render.mp4'));
const frames = parseInt(opt('frames', '180'), 10);
const stills = opt('stills', null);
const stillsDir = path.resolve(root, opt('stills-dir', '../stills'));

const server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.config.server.port === 0 ? server.httpServer.address().port : server.httpServer.address().port}/?capture=1`;

const launch = {
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
};
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
else launch.channel = 'chrome';
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 120000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

async function grab(n) {
  await page.evaluate((i) => window.renderFrame(i), n);
  const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

if (stills) {
  mkdirSync(stillsDir, { recursive: true });
  for (const s of stills.split(',').map(Number)) {
    writeFileSync(path.join(stillsDir, `frame_${String(s).padStart(3, '0')}.png`), await grab(s));
    console.log('still', s);
  }
} else {
  const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', '30', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const t = Date.now();
  for (let i = 0; i < frames; i++) {
    const buf = await grab(i);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 30 === 0) console.log(`frame ${i}/${frames}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`wrote ${out} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
await browser.close();
await server.close();
