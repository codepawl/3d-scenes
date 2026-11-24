// Records a 1920x1080 video of someone using the scene: a visible cursor drags the view, presses DOF, walks up the
// creek and clicks through the four presets. Frames are captured deterministically like flythrough.mjs, and the
// clicks press the real toolbar buttons, so the pills change state on screen.
// Usage: node tools/interactive.mjs [--url http://localhost:5199] [--fps 30]
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = option('url', 'http://localhost:5199');
const fps = Number(option('fps', 30));
const seconds = 24;
const framesDir = path.join(os.tmpdir(), 'creek-interactive-frames');
const output = path.join(projectDir, 'shots', 'interactive.mp4');

const smooth = (value) => value * value * (3 - 2 * value);
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const between = (time, start, end) => smooth(clamp01((time - start) / (end - start)));

// The clicks, in seconds: the cursor arrives a little before, presses at `at`.
const clicks = [
  { at: 4.2, selector: '[data-toggle="dof"]' },
  { at: 6.4, selector: '[data-toggle="dof"]' },
  { at: 9.0, selector: '[data-preset="golden"]' },
  { at: 13.0, selector: '[data-preset="blue"]' },
  { at: 17.0, selector: '[data-preset="night"]' },
  { at: 21.5, selector: '[data-preset="afternoon"]' },
];

// The camera: a drag to look around first, then a walk up the creek toward the cabin.
function cameraAt(time) {
  const dragLook = Math.sin(between(time, 0.6, 3.4) * Math.PI) * 0.42;
  const walk = between(time, 7, 21);
  const z = 30 - walk * 44;
  const lateral = Math.sin(time * 0.35) * 0.35;
  const pitch = -0.12 + between(time, 17, 21) * 0.14;
  return { z, lateral, options: { yawOffset: dragLook + Math.sin(time * 0.4) * 0.05, pitch } };
}

// Where the cursor is: dragging across the middle first, then gliding to each button before its click.
function cursorAt(time, buttonCentres) {
  if (time < 3.6) {
    const progress = between(time, 0.6, 3.4);
    return { x: 960 - Math.sin(progress * Math.PI) * 420, y: 620 + progress * 30, pressed: time > 0.6 && time < 3.4 };
  }
  let previous = { x: 960, y: 650 };
  for (const click of clicks) {
    const target = buttonCentres[click.selector];
    const start = click.at - 0.9;
    if (time < click.at) {
      const progress = between(time, start, click.at - 0.15);
      return { x: previous.x + (target.x - previous.x) * progress, y: previous.y + (target.y - previous.y) * progress, pressed: false };
    }
    if (time < click.at + 0.18) {
      return { ...target, pressed: true };
    }
    previous = target;
  }
  return { ...previous, pressed: false };
}

async function removeFrames() {
  const names = await readdir(framesDir).catch(() => []);
  await Promise.all(names.filter((name) => /^frame_\d{4}\.jpg$/.test(name)).map((name) => unlink(path.join(framesDir, name))));
}

await mkdir(framesDir, { recursive: true });
await removeFrames();

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}/?capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.creek?.ready, null, { timeout: 120000 });
await page.evaluate(() => document.fonts.ready);

const buttonCentres = await page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
  const box = document.querySelector(selector).getBoundingClientRect();
  return [selector, { x: box.left + box.width / 2, y: box.top + box.height / 2 }];
})), [...new Set(clicks.map((click) => click.selector))]);

// A plain arrow cursor drawn in the page, so it shows up in the captured frames.
await page.evaluate(() => {
  const cursor = document.createElement('div');
  cursor.id = 'recording-cursor';
  cursor.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.6L4 20z" fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round"/></svg><span></span>';
  Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: '99999', pointerEvents: 'none', transformOrigin: '4px 2px' });
  const ring = cursor.querySelector('span');
  Object.assign(ring.style, { position: 'absolute', left: '-14px', top: '-16px', width: '36px', height: '36px', borderRadius: '50%', border: '3px solid rgba(255,255,255,0.85)', opacity: '0' });
  document.body.appendChild(cursor);
  window.moveRecordingCursor = (x, y, pressed) => {
    cursor.style.transform = `translate(${x}px, ${y}px) scale(${pressed ? 0.86 : 1})`;
    ring.style.opacity = pressed ? '1' : '0';
  };
});

await page.evaluate((first) => {
  const creek = window.creek;
  creek.setPreset('afternoon', true);
  creek.setToggle('dof', true);
  creek.setToggle('dslr', true);
  creek.placeAlongCreek(first.z, first.lateral, first.options);
  creek.step(1 / 30, 45);
}, cameraAt(0));

const frameCount = seconds * fps;
const done = new Set();
for (let frame = 0; frame < frameCount; frame++) {
  const time = frame / fps;
  const due = clicks.filter((click, index) => !done.has(index) && time >= click.at).map((click) => click.selector);
  clicks.forEach((click, index) => { if (time >= click.at) done.add(index); });
  const cursor = cursorAt(time, buttonCentres);
  await page.evaluate(({ view, due, cursor, deltaTime }) => {
    for (const selector of due) document.querySelector(selector).click();
    window.moveRecordingCursor(cursor.x, cursor.y, cursor.pressed);
    window.creek.placeAlongCreek(view.z, view.lateral, view.options);
    window.creek.step(deltaTime);
  }, { view: cameraAt(time), due, cursor, deltaTime: 1 / fps });
  await page.screenshot({ path: path.join(framesDir, `frame_${String(frame).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93 });
  if (frame % 90 === 0) console.log(`frame ${frame}/${frameCount}`);
}
await browser.close();

const encode = spawnSync('ffmpeg', [
  '-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(framesDir, 'frame_%04d.jpg'),
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
  '-color_range', 'tv', '-movflags', '+faststart', output,
], { stdio: 'inherit' });
if (encode.status !== 0) {
  console.log('ffmpeg failed; frames kept in', framesDir);
  process.exit(1);
}
await removeFrames();
await rmdir(framesDir).catch(() => {});
console.log('wrote', output);
