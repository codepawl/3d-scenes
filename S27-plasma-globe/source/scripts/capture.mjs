// Deterministic frame capture: serves the app with Vite, drives window.renderFrame(n) in headless Chrome,
// writes PNG frames and encodes them with ffmpeg.
//   node scripts/capture.mjs [--frames 180] [--out ../render.mp4] [--stills]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FRAMES = Number(arg('--frames', 180));
const OUT = path.resolve(root, arg('--out', '../render.mp4'));
const ONLY = arg('--only', null); // comma list of frame numbers -> PNG stills only
const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 's27-frames-'));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return c.find((p) => fs.existsSync(p));
}

const server = await createServer({ root, server: { port: 0, open: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0] + '?capture=1';
const exe = findChrome();
const browser = await chromium.launch({
  headless: true,
  ...(exe ? { executablePath: exe } : {}),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
  const list = ONLY ? ONLY.split(',').map(Number) : [...Array(FRAMES).keys()];
  for (const n of list) {
    const data = await page.evaluate(async (k) => {
      await window.renderFrame(k);
      return document.querySelector('canvas').toDataURL('image/png');
    }, n);
    const file = ONLY ? path.resolve(root, `../still_${String(n).padStart(3, '0')}.png`)
      : path.join(frameDir, `f_${String(n).padStart(4, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    if (n % 30 === 0) console.log('frame', n);
  }
  if (!ONLY) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(frameDir, 'f_%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT],
      { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    console.log('wrote', OUT);
  }
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(frameDir, { recursive: true, force: true });
}
