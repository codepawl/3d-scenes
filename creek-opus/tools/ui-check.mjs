// Smoke test of the live page: wheel, WASD, drag, toolbar buttons, shortcuts, frame rate, phone layout.
// Usage: node tools/ui-check.mjs [--url http://localhost:5199] [--out shots]
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
const outDir = path.resolve(projectDir, option('out', 'shots'));
const results = [];
const check = (name, passed, detail = '') => results.push(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
await page.goto(baseUrl, { waitUntil: 'load' });
await page.waitForFunction(() => window.creek?.ready, null, { timeout: 120000 });
await wait(1500);
const camera = () => page.evaluate(() => window.creek.stats().camera);

const start = await camera();
await page.mouse.move(960, 600);
for (let index = 0; index < 6; index++) {
  await page.mouse.wheel(0, 240);
  await wait(60);
}
await wait(1800);
const afterScroll = await camera();
check('scroll moves upstream along the creek', afterScroll[2] < start[2] - 1, `z ${start[2].toFixed(2)} -> ${afterScroll[2].toFixed(2)}`);

await page.keyboard.down('d');
await wait(800);
await page.keyboard.up('d');
await wait(300);
const afterStrafe = await camera();
check('D strafes sideways', Math.abs(afterStrafe[0] - afterScroll[0]) > 0.8, `x ${afterScroll[0].toFixed(2)} -> ${afterStrafe[0].toFixed(2)}`);

const yawBefore = await page.evaluate(() => window.creek.app.controls.yaw);
await page.mouse.move(900, 600);
await page.mouse.down();
await page.mouse.move(1150, 560, { steps: 12 });
await page.mouse.up();
await wait(600);
const yawAfter = await page.evaluate(() => window.creek.app.controls.yaw);
check('drag turns the view', Math.abs(yawAfter - yawBefore) > 0.3, `yaw ${yawBefore.toFixed(2)} -> ${yawAfter.toFixed(2)}`);

await page.click('[data-preset="night"]');
await wait(2600);
const night = await page.evaluate(() => ({
  pressed: document.querySelector('[data-preset="night"]').getAttribute('aria-pressed'),
  others: [...document.querySelectorAll('[data-preset][aria-pressed="true"]')].length,
  stars: window.creek.app.lighting.stars,
}));
check('Night button relights the scene', night.pressed === 'true' && night.others === 1 && night.stars > 0.95, JSON.stringify(night));

await page.keyboard.press('2');
await wait(2600);
const golden = await page.evaluate(() => ({ name: window.creek.app.presetName, elevation: window.creek.app.lighting.sunElevation }));
check('key 2 switches to Golden', golden.name === 'golden' && Math.abs(golden.elevation - 9) < 0.5, JSON.stringify(golden));

await page.keyboard.press('f');
const dof = await page.evaluate(() => ({ toggle: window.creek.app.toggles.dof, pressed: document.querySelector('[data-toggle="dof"]').getAttribute('aria-pressed') }));
check('F toggles DOF off', dof.toggle === false && dof.pressed === 'false', JSON.stringify(dof));
await page.click('[data-toggle="dof"]');
await page.click('[data-toggle="dslr"]');
const toggles = await page.evaluate(() => window.creek.app.toggles);
check('toolbar toggles DOF on and DSLR off', toggles.dof === true && toggles.dslr === false, JSON.stringify(toggles));
await page.click('[data-toggle="dslr"]');
await page.click('[data-preset="afternoon"]');

await wait(2500);
const fpsSamples = [];
for (let index = 0; index < 5; index++) {
  await wait(700);
  fpsSamples.push(await page.evaluate(() => window.creek.stats().fps));
}
const fps = fpsSamples.reduce((sum, value) => sum + value, 0) / fpsSamples.length;
check('live frame rate at 1920x1080', fps > 55, `${fps.toFixed(1)} fps (requestAnimationFrame, headless, capped by vsync)`);

await page.keyboard.press('Tab');
await page.screenshot({ path: path.join(outDir, 'ui-toolbar-focus.png'), clip: { x: 560, y: 0, width: 800, height: 90 } });

await page.setViewportSize({ width: 390, height: 844 });
await wait(1500);
const layout = await page.evaluate(() => {
  const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
  const title = document.querySelector('.title-card').getBoundingClientRect();
  return {
    toolbarLeft: toolbar.left, toolbarRight: toolbar.right, toolbarBottom: toolbar.bottom,
    titleTop: title.top, scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth,
  };
});
check('phone width: toolbar fits, no horizontal scroll, title clear of toolbar',
  layout.toolbarLeft >= 8 && layout.toolbarRight <= layout.width - 8 && layout.scrollWidth <= layout.width && layout.titleTop > layout.toolbarBottom,
  JSON.stringify(layout));
await page.screenshot({ path: path.join(outDir, 'ui-phone.png') });

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
