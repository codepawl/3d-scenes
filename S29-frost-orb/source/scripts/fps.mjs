// Measures live-mode frame rate at 1280x720 in headless Chrome (GPU). Usage: node scripts/fps.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(server.resolvedUrls.local[0]);
await page.waitForTimeout(8000);
const fps = await page.evaluate(() => new Promise((res) => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  let n = 0; const t0 = performance.now();
  (function f() { gl.finish(); n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); })();
}));
console.log('live fps (uncapped):', fps.toFixed(1));
await browser.close(); await server.close();
