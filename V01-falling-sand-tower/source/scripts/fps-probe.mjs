// Opens the live scene at 1280x720 in headless Chrome (GPU flags) and prints the HUD (fps / sim / mesh ms) after 8 s.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, logLevel: 'error', server: { port: 5198 } });
await server.listen();
const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
let browser;
for (const channel of ['chrome', 'msedge', 'chromium']) {
  try { browser = await chromium.launch({ channel, headless: true, args }); break; } catch { /* next */ }
}
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(server.resolvedUrls.local[0]);
for (let i = 0; i < 4; i++) { await page.waitForTimeout(3000); console.log(await page.textContent('#hud')); }
await browser.close(); await server.close();
