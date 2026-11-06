#!/usr/bin/env node
// Screenshots for README.md (docs/screenshots/*.png).
//
// Starts STL Tools with a temporary data folder, a fake SV07 (the test
// Moonraker mock), demo designs, a project and an imported STL, then captures
// each page in Chromium. Needs Playwright with Chromium installed
// (npm i -g playwright && npx playwright install chromium). Not used by the app.
//
//   node scripts/screenshots.mjs [outDir]

import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] ?? join(ROOT, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}
const dataDir = mkdtempSync(join(tmpdir(), 'stltools-shots-'));
process.env.STLTOOLS_DATA = dataDir;
const { startServer } = await import('../src/server.js');
const { initKernel } = await import('../src/core/kernel.js');
const { startMockMoonraker } = await import('../test/helpers/mock-moonraker.js');
await initKernel();
const srv = await startServer({ host: '127.0.0.1', port: 0, dataDir });
const base = `http://127.0.0.1:${srv.address().port}`;
const mock = await startMockMoonraker({});
const post = (path, body, method = 'POST') => fetch(base + path, { method, body: JSON.stringify(body) }).then((r) => r.json());

// demo data (My Parts from the MTS starter set)
await post('/api/parts/seed', { set: 'mts-v1' });
const printer = await post('/api/printers', { name: 'SV07', url: `127.0.0.1:${mock.port}`, model: 'sovol-sv07' });
await post('/api/settings', { printers: { defaultPrinter: printer.id } }, 'PUT');
const d1 = await post('/api/designs', { name: 'ESC tray 16 mm arm, long', generator: 'component-mount', params: { itemLength: 60 }, section: 'quads' });
await post('/api/designs', { name: 'Clamp 12 mm gear leg', generator: 'tube-clamp', params: { tubeOD: 12 }, section: 'accessories' });
const gen = await post('/api/generate/lidar-mount', {});
const stlBytes = await (await fetch(base + gen.parts[0].url)).arrayBuffer();
const stl = await (await fetch(`${base}/api/library/upload?filename=ld19-plate.stl&folder=Lidar&tags=ld19`, { method: 'PUT', body: stlBytes })).json();
const project = await post('/api/projects', { name: 'ZD550 sensor mounts', description: 'TF-Luna down, Pi 5 on the boom, LD19 on top.', tags: ['zd550'], status: 'active' });
for (const it of [{ kind: 'preset', ref: 'tfluna-tape' }, { kind: 'preset', ref: 'pi5-case-vents' }, { kind: 'design', ref: d1.id, qty: 4 }, { kind: 'stl', ref: stl.id }]) await post(`/api/projects/${project.id}/items`, it);
for (const f of [{ kind: 'preset', id: 'pi5-case-vents' }, { kind: 'preset', id: 'tfluna-plate' }, { kind: 'preset', id: 'xiao-c6-clip-plate' }]) await post('/api/favorites/toggle', f);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });
const shot = async (name, hash, wait = 3000, before = null) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(wait);
  if (before) await before();
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}.png`);
};
await page.goto(`${base}/#home`);
await page.waitForTimeout(4000);
await shot('home', 'home', 6000);
await page.evaluate(() => { location.hash = 'shop'; });
await page.waitForTimeout(1500);
await shot('designer-pi5-case', 'robotics', 2000, async () => {
  await page.fill('#presetSearch', 'pi 5 case');
  await page.locator('#presetList li').first().click();
  await page.waitForTimeout(4000);
});
await shot('designer-tfluna-verify', 'robotics', 1500, async () => {
  await page.fill('#presetSearch', 'tf-luna 30');
  await page.locator('#presetList li').first().click();
  await page.waitForTimeout(3500);
  await page.locator('.vt', { hasText: '⚙' }).click();
  await page.waitForTimeout(500);
});
await shot('search', 'home', 1500, async () => {
  await page.fill('#globalSearch', 'xiao');
  await page.waitForTimeout(800);
});
await page.keyboard.press('Escape');
await shot('project', `project/${project.id}`, 6000);
await shot('stl-files', 'stls', 5000);
await shot('import', 'import', 1500);
await shot('settings-printers', 'settings/printers', 2000, async () => {
  await page.locator('.printer-row button', { hasText: 'Test connection' }).first().click();
  await page.waitForTimeout(1500);
});
await shot('printers', 'printers', 5000);
await shot('my-parts', 'parts', 4000);
await shot('needs-measurement', 'quads', 2500, async () => {
  await page.fill('#presetSearch', 'pixhawk v5');
  await page.locator('#presetList li').first().click();
  await page.waitForTimeout(2000);
});
await page.emulateMedia({ colorScheme: 'dark' });
await shot('dark-mode', 'quads', 2000, async () => {
  await page.fill('#presetSearch', 'typhoon');
  await page.locator('#presetList li').first().click();
  await page.waitForTimeout(3500);
});
await browser.close();
srv.close();
mock.server.close();
rmSync(dataDir, { recursive: true, force: true });
