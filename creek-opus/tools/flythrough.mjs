// Records a 1920x1080 flythrough up the creek that cycles the four time-of-day presets.
// Frames are captured deterministically (fixed time step) and encoded with ffmpeg.
// Usage: node tools/flythrough.mjs [--url http://localhost:5199] [--frames-dir <dir>] [--seconds 20] [--fps 30]
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
const seconds = Number(option('seconds', 20));
const fps = Number(option('fps', 30));
const framesDir = path.resolve(option('frames-dir', path.join(os.tmpdir(), 'creek-flythrough-frames')));
const output = path.join(projectDir, 'shots', 'flythrough.mp4');
const frameCount = Math.round(seconds * fps);

// Preset changes (seconds into the video); each change animates over the app's transition time.
const presetCues = [
  { at: 0, preset: 'afternoon' },
  { at: 4.6, preset: 'golden' },
  { at: 9.6, preset: 'blue' },
  { at: 14.6, preset: 'night' },
];

const smooth = (t) => t * t * (3 - 2 * t);

function cameraAt(timeSeconds) {
  const t = timeSeconds / seconds;
  const travel = smooth(Math.min(t * 1.02, 1));
  const z = 33 - travel * 55;
  const lateral = Math.sin(t * Math.PI * 1.6) * 0.55;
  const yawOffset = Math.sin(t * Math.PI * 1.3 + 0.4) * 0.14;
  const pitch = -0.13 + smooth(Math.max((t - 0.7) / 0.3, 0)) * 0.17;
  return { z, lateral, options: { yawOffset, pitch } };
}

// Only this script's own frame files are ever deleted, never the folder contents at large.
async function removeFrames() {
  const names = await readdir(framesDir).catch(() => []);
  await Promise.all(names.filter((name) => /^frame_\d{4}\.jpg$/.test(name)).map((name) => unlink(path.join(framesDir, name))));
}

await mkdir(framesDir, { recursive: true });
await removeFrames();
await mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (error) => problems.push(error.message));
await page.goto(`${baseUrl}/?capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.creek?.ready, null, { timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate((first) => {
  const creek = window.creek;
  creek.setPreset('afternoon', true);
  creek.setToggle('dof', true);
  creek.setToggle('dslr', true);
  creek.placeAlongCreek(first.z, first.lateral, first.options);
  creek.step(1 / 30, 45);
}, cameraAt(0));

const started = Date.now();
let cueIndex = 1;
for (let frame = 0; frame < frameCount; frame++) {
  const timeSeconds = frame / fps;
  let cue = null;
  if (cueIndex < presetCues.length && timeSeconds >= presetCues[cueIndex].at) {
    cue = presetCues[cueIndex].preset;
    cueIndex++;
  }
  await page.evaluate(({ view, cue, deltaTime }) => {
    const creek = window.creek;
    if (cue) {
      creek.setPreset(cue, false);
    }
    creek.placeAlongCreek(view.z, view.lateral, view.options);
    creek.step(deltaTime);
  }, { view: cameraAt(timeSeconds), cue, deltaTime: 1 / fps });
  await page.screenshot({ path: path.join(framesDir, `frame_${String(frame).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93 });
  if (frame % 60 === 0) {
    console.log(`frame ${frame}/${frameCount}  ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
}
await browser.close();
if (problems.length) {
  console.log('page errors:', problems.slice(0, 10).join('\n'));
}

const written = (await readdir(framesDir)).filter((name) => name.endsWith('.jpg')).length;
console.log(`captured ${written} frames in ${((Date.now() - started) / 1000).toFixed(1)} s; encoding`);
const encode = spawnSync('ffmpeg', [
  '-y', '-v', 'error',
  '-framerate', String(fps),
  '-i', path.join(framesDir, 'frame_%04d.jpg'),
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
  '-color_range', 'tv', '-movflags', '+faststart',
  output,
], { stdio: 'inherit' });
if (encode.status !== 0) {
  console.log('ffmpeg failed; frames kept in', framesDir);
  process.exit(1);
}
await removeFrames();
await rmdir(framesDir).catch(() => {});
console.log('wrote', output);
