// Writes PNG stills of given capture frames, and measures real-time fps of the interactive mode.
// Usage: node scripts/stills.mjs <outDir> <frame> [frame...]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || 'stills');
const frames = process.argv.slice(3).map(Number);
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 3000)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + '?capture=1' + (process.env.EXTRA || ''));
await page.waitForFunction(() => window.captureReady === true, null, { timeout: 60000 });
for (const n of frames) {
  const d = await page.evaluate(async (i) => { await window.renderFrame(i); return document.querySelector('canvas').toDataURL('image/png'); }, n);
  fs.writeFileSync(path.join(outDir, `f${String(n).padStart(3, '0')}.png`), Buffer.from(d.split(',')[1], 'base64'));
}
// real-time fps probe (interactive mode, 1280x720)
const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await p2.goto(base);
await p2.waitForTimeout(4000);
console.log('interactive HUD:', await p2.evaluate(() => document.getElementById('hud').textContent));
await browser.close();
await server.close();
