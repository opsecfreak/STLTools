#!/usr/bin/env node
// Browser smoke test of the web UI (Chromium through Playwright). Not part of
// `npm test` because it needs a browser; CI runs it on Linux and Windows.
//
//   node scripts/ui-smoke.mjs            (needs: npm i -g playwright && npx playwright install chromium)
//
// Checks, with a fake SV07 (test/helpers/mock-moonraker.js):
//   1. Every page opens without a script error: home, browse, a designer tab, projects,
//      My Parts, STL files, import, printers, settings.
//   2. A preset generates and the 3D view draws (WebGL canvas).
//   3. The Printers page shows live MJPEG video from the printer's camera.
//   4. Settings > Self-hosting shows the run mode; Settings > Printers > Printer features
//      "Off" hides the Printers tab and header chip.
//   5. A browser without WebGL gets the fallback panel, and Generate + STL download still work.
// Exit code 1 on any failure.

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  try { ({ chromium } = createRequire(join(process.env.NODE_PATH ?? '', 'x'))('playwright')); } catch {
    console.error('Playwright is not installed. Run: npm i -g playwright && npx playwright install chromium');
    process.exit(1);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'stltools-ui-'));
process.env.STLTOOLS_DATA = dataDir;
const { startServer } = await import('../src/server.js');
const { initKernel } = await import('../src/core/kernel.js');
const { startMockMoonraker } = await import('../test/helpers/mock-moonraker.js');
await initKernel();
const srv = await startServer({ host: '127.0.0.1', port: 0, dataDir });
const base = `http://127.0.0.1:${srv.address().port}`;
const mock = await startMockMoonraker({ state: 'printing' });
const post = (path, body, method = 'POST') => fetch(base + path, { method, body: JSON.stringify(body) }).then((r) => r.json());

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const printer = await post('/api/printers', { name: 'SV07', url: `127.0.0.1:${mock.port}`, model: 'sovol-sv07' });
await post('/api/settings', { printers: { defaultPrinter: printer.id } }, 'PUT');
await fetch(`${base}/api/printers/${printer.id}/machine`);

const exe = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(`${base}/#home`);
  await page.waitForSelector('.tiles', { timeout: 30000 });
  const stray = [];
  for (const hash of ['browse', 'quads', 'projects', 'parts', 'stls', 'import', 'settings', 'printers', 'home']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(hash === 'browse' ? 2500 : 1200);
    if (/(^|\n)\s*(null|undefined)\s*(\n|$)/.test(await page.locator('body').innerText())) stray.push(hash);
  }
  check(stray.length === 0, `no stray "null" / "undefined" text on a page${stray.length ? `: ${stray.join(', ')}` : ''}`);
  check(errors.length === 0, `pages open without script errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);

  // 2. generate + 3D view
  await page.evaluate(() => { location.hash = 'accessories'; });
  await page.waitForSelector('#presetList li', { timeout: 20000 });
  await page.locator('#presetList li').first().click();
  await page.waitForTimeout(3000);
  check(await page.locator('#viewer canvas').count() === 1, '3D view canvas present (WebGL)');
  check(/About \d/.test(await page.locator('#estimate').innerText()), 'print estimate shown');
  check(/own limits/.test(await page.locator('#estimate select[aria-label="Print on"]').innerText()), 'estimate can use the printer\'s own limits');
  // switching generator shows the new part without touching a setting
  const before = await page.locator('#dlStl').getAttribute('href');
  const other = await page.locator('#generator option').nth(1).getAttribute('value');
  await page.locator('#generator').selectOption(other);
  await page.waitForFunction(() => /^Landing|part/.test(document.querySelector('#status')?.textContent ?? '') && !/^Generating/.test(document.querySelector('#status').textContent), null, { timeout: 30000 }).catch(() => {});
  const status = await page.locator('#status').innerText();
  check(/part/.test(status) && !/^Generating/.test(status) && ((await page.locator('#dlStl').getAttribute('href')) !== before || await page.locator('#zipAll').isVisible()), `changing the generator regenerates the 3D view (${other}: ${status})`);

  // 2b. Stress Lab from the designer: quick setup, solve in the worker, every mode opens
  await page.locator('#toLab').click();
  await page.waitForSelector('.lab-status', { timeout: 20000 });
  await page.waitForFunction(() => /cells of/.test(document.querySelector('.lab-status')?.textContent ?? ''), null, { timeout: 30000 });
  // Draft detail keeps the solve short on slow CI machines
  await page.locator('.lab-left select').nth(1).selectOption('3000');
  await page.waitForFunction(() => /cells of/.test(document.querySelector('.lab-status')?.textContent ?? ''), null, { timeout: 30000 });
  await page.locator('summary', { hasText: 'Quick setups' }).click();
  await page.locator('button', { hasText: 'Hold the bottom' }).click();
  await page.locator('button', { hasText: 'Hook / bracket' }).click();
  await page.locator('button', { hasText: /^Solve/ }).click();
  try {
    await page.waitForSelector('.lab-panel h4', { timeout: 180000 });
  } catch (err) {
    throw new Error(`Stress Lab solve did not finish: ${await page.locator('.lab-status').innerText()}`);
  }
  check(/safety factor/.test(await page.locator('.lab-panel').innerText()), 'Stress Lab solves a load case and reports the safety factor');
  for (const mode of ['Weak points', 'Wind tunnel', 'Environment', 'Materials']) {
    await page.locator('.lab-modes button', { hasText: mode }).click();
    await page.waitForTimeout(1500);
  }
  check(/eSUN/.test(await page.locator('.lab-panel').innerText()), 'Stress Lab modes open (materials list shows datasheet entries)');
  await page.evaluate(() => { location.hash = 'accessories'; });
  await page.waitForTimeout(1500);

  // 3. live webcam
  await page.evaluate(() => { location.hash = 'printers'; });
  await page.waitForSelector('.cam-box img.cam', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const src = await page.locator('.cam-box img.cam').getAttribute('src');
  check(/\/stream\?cam=0/.test(src ?? ''), `Printers page uses the live stream (${src})`);
  check(await page.locator('.cam-box img.cam').evaluate((img) => img.naturalWidth > 0), 'live video frame decoded');
  check(mock.streams.open >= 1, 'camera stream opened on the printer');
  await page.locator('.insights-box button', { hasText: 'Health check' }).click();
  await page.waitForSelector('.health li', { timeout: 10000 });
  check(/pressure_advance/.test(await page.locator('.health').innerText()), 'printer health check shows the Klipper setup');
  await page.locator('.insights-box button', { hasText: 'Config files' }).click();
  await page.waitForSelector('.cfg-view .sec', { timeout: 10000 });
  check(/max_velocity/.test(await page.locator('.cfg-view').innerText()), 'printer.cfg viewer shows the file');
  await page.locator('.insights-box button', { hasText: 'Bed mesh' }).click();
  await page.waitForSelector('.insights-box canvas', { timeout: 10000 });
  check(/Range .* mm/.test(await page.locator('.insights-box').innerText()), 'bed mesh heat map shows the range');
  await page.locator('.insights-box button', { hasText: 'Logs' }).click();
  await page.waitForSelector('.insights-box .cfg-view div', { timeout: 10000 });
  check(/MCU version/.test(await page.locator('.insights-box .cfg-view').innerText()), 'log viewer shows klippy.log');
  // control mode: off by default, warning dialog to turn on, confirm per action, logged
  check(/Control: off/.test(await page.locator('.control-box').innerText()), 'printer control is off by default');
  page.on('dialog', (d) => d.accept());
  await page.locator('.control-box button', { hasText: 'Turn on control' }).click();
  await page.waitForSelector('.control-box.on', { timeout: 10000 });
  await page.locator('.control-box button', { hasText: 'Pause' }).click();
  await page.waitForTimeout(1500);
  check(mock.sim.state === 'paused', 'Pause (after confirm) paused the printer');
  await page.locator('.control-box button', { hasText: 'Resume' }).click();
  await page.waitForTimeout(1500);
  check(mock.sim.state === 'printing' && /resume/.test(await page.locator('.control-log').innerText()), 'Resume works and the control log shows it');
  await page.locator('.control-box button', { hasText: 'Turn off control' }).click();
  await page.waitForSelector('.control-box:not(.on)', { timeout: 10000 });
  page.removeAllListeners('dialog');
  await page.evaluate(() => { location.hash = 'home'; });
  for (let i = 0; i < 30 && mock.streams.closed < mock.streams.open; i++) await page.waitForTimeout(200);
  check(mock.streams.closed === mock.streams.open, `stream closed when leaving the Printers page (${mock.streams.closed}/${mock.streams.open})`);

  // 4. hosting + printer toggle
  await page.evaluate(() => { location.hash = 'settings/hosting'; });
  await page.waitForSelector('#set-hosting .pin-box', { timeout: 10000 });
  check(/Server started from the command line|Desktop app|Service/.test(await page.locator('#set-hosting').innerText()), 'Self-hosting section shows the run mode');
  check(await page.locator('nav [data-tab="printers"]').isVisible(), 'Printers tab visible with a saved printer');
  await page.locator('#set-printers select').filter({ hasText: 'Always show' }).selectOption('off');
  await page.waitForTimeout(1200);
  check(!(await page.locator('nav [data-tab="printers"]').isVisible()), 'Printer features Off hides the Printers tab');
  check(!(await page.locator('#printerChip').isVisible()), 'and the header chip');
  await page.locator('#set-printers select').filter({ hasText: 'Always show' }).selectOption('auto');
  await page.waitForTimeout(800);
  check(await page.locator('nav [data-tab="printers"]').isVisible(), 'Auto shows it again');
  await page.close();

  // 5. no WebGL
  const noGl = await chromium.launch({ executablePath: exe, args: ['--disable-3d-apis', '--disable-gpu'] });
  try {
    const p2 = await noGl.newPage({ viewport: { width: 1280, height: 860 } });
    const e2 = [];
    p2.on('pageerror', (e) => e2.push(e.message));
    await p2.goto(`${base}/#accessories`);
    await p2.waitForSelector('#presetList li', { timeout: 30000 });
    await p2.locator('#presetList li').first().click();
    await p2.waitForTimeout(3000);
    check(await p2.locator('.viewer-fallback').isVisible(), 'no WebGL: fallback panel instead of the 3D view');
    check(/mm/.test(await p2.locator('.viewer-fallback ul').innerText()), 'fallback lists the part sizes');
    const href = await p2.locator('#downloads a[href*="/api/stl/"], a[href*="/api/stl/"]').first().getAttribute('href');
    const res = href ? await fetch(base + href) : null;
    check(res?.ok && (await res.arrayBuffer()).byteLength > 84, 'STL download works without WebGL');
    check(e2.length === 0, `no script errors without WebGL${e2.length ? `: ${e2[0]}` : ''}`);
  } finally { await noGl.close(); }
} finally {
  await browser.close();
  srv.closeAllConnections?.();
  srv.close();
  mock.server.closeAllConnections?.();
  mock.server.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} UI check(s) failed` : '\nUI smoke test passed');
process.exit(failures.length ? 1 : 0);
