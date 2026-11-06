#!/usr/bin/env node
// Desktop launcher. Double-click scripts in the release packages call this.
//
// 1. Picks a per-user folder for your data, outside the app folder, so
//    upgrading or deleting the app never touches your saved designs/catalog:
//      Windows: %APPDATA%\STLTools      macOS: ~/Library/Application Support/STLTools
//      Linux:   ~/.local/share/stltools  (or $XDG_DATA_HOME/stltools)
//    It holds data/ (catalog, designs) and custom/ (your own generators and presets).
// 2. If STL Tools already runs on the port, it just opens the browser.
//    If the port is used by something else, it tries the next ports.
// 3. Starts the server and opens http://127.0.0.1:<port>.
//
// 4. Opens it in its own app window (Edge or Chrome / Chromium in app mode)
//    when one is installed, else in the default browser. --browser forces a tab.
//
// Options: --port 3000   --lan (listen on all interfaces, for phones/tablets)
//          --no-browser  --browser  --data <folder>
//          --portable    keep all data next to the app (USB drive). Same as a file
//                        named portable.txt next to the start script.
//          --temp        one-time session: data in a temp folder, deleted on exit
//          --hours <n>   stop by itself after n hours (e.g. 2 or 0.5)
// Without --lan / --port, Settings > Hosting (data/settings.json) decides.

import { mkdirSync, existsSync, copyFileSync, writeFileSync, readFileSync, accessSync, mkdtempSync, rmSync, constants as fsConstants } from 'node:fs';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`STL Tools needs Node.js 18 or newer. This is ${process.versions.node}.`);
  process.exit(1);
}

// Release packages put app/ next to node/ and the start scripts (the package root).
// On macOS the app sits in "STL Tools.app/Contents/Resources/app": use the folder that holds the .app.
const macBundle = APP_ROOT.match(/^(.*)[\\/][^\\/]+\.app[\\/]Contents[\\/]Resources[\\/]app$/);
const PACKAGE_ROOT = macBundle ? macBundle[1] : dirname(APP_ROOT);
const portableMarker = [join(PACKAGE_ROOT, 'portable.txt'), join(APP_ROOT, 'portable.txt')].find((f) => existsSync(f));
const MODE = flag('temp') ? 'temp' : flag('portable') || portableMarker ? 'portable' : opt('data') ? 'custom' : 'desktop';

function userFolder() {
  if (opt('data')) return opt('data');
  if (MODE === 'temp') return mkdtempSync(join(tmpdir(), 'stltools-temp-'));
  if (MODE === 'portable') return join(portableMarker ? dirname(portableMarker) : PACKAGE_ROOT, 'stltools-data');
  if (process.env.STLTOOLS_HOME) return process.env.STLTOOLS_HOME;
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'STLTools');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'STLTools');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'stltools');
}

const home = userFolder();
const dataDir = process.env.STLTOOLS_DATA || join(home, 'data');
const customDir = process.env.STLTOOLS_CUSTOM || join(home, 'custom');
for (const d of [dataDir, join(customDir, 'generators'), join(customDir, 'presets')]) mkdirSync(d, { recursive: true });
const readme = join(APP_ROOT, 'custom', 'README.md');
if (existsSync(readme) && !existsSync(join(customDir, 'README.md'))) copyFileSync(readme, join(customDir, 'README.md'));
// Custom generators are ES modules. Node 18/20 need this marker to load .js files as modules.
if (!existsSync(join(customDir, 'package.json'))) writeFileSync(join(customDir, 'package.json'), '{ "type": "module" }\n');
for (const ex of ['generators/_example-bracket.js', 'presets/_example-presets.json']) {
  if (existsSync(join(APP_ROOT, 'custom', ex)) && !existsSync(join(customDir, ex))) copyFileSync(join(APP_ROOT, 'custom', ex), join(customDir, ex));
}

if (MODE === 'temp') {
  // one-time session: remove everything when STL Tools stops
  const cleanup = () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* already gone */ } };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
}

// Settings > Hosting (saved by the app) apply when no flag or variable says otherwise.
let hosting = {};
try { hosting = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).hosting ?? {}; } catch { /* first start */ }
const host = flag('lan') ? '0.0.0.0' : process.env.HOST ?? (hosting.lan ? '0.0.0.0' : '127.0.0.1');
const firstPort = Number(opt('port') ?? process.env.PORT ?? hosting.port ?? 3000);
const hours = Number(opt('hours') ?? hosting.autoStopHours ?? 0);
const stopAt = hours > 0 ? new Date(Date.now() + hours * 3600e3) : null;

async function isStlTools(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.json()).name === 'stltools';
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

/** A Chromium-based browser that can open a plain app window (no tabs, no address bar). */
function appBrowser() {
  const env = process.env;
  const candidates = process.platform === 'win32'
    ? [
      join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : (env.PATH ?? '').split(':').flatMap((d) => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map((b) => join(d, b)));
  for (const c of candidates) {
    try { accessSync(c, fsConstants.X_OK); return c; } catch { /* next */ }
  }
  return null;
}

function openBrowser(url) {
  if (flag('no-browser')) return;
  const app = flag('browser') ? null : appBrowser();
  if (app) {
    try {
      spawn(app, [`--app=${url}`, '--window-size=1440,900'], { stdio: 'ignore', detached: true }).unref();
      return;
    } catch { /* fall back to the default browser */ }
  }
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref();
  } catch {
    /* no browser available (headless): the URL is printed below */
  }
}

let port = firstPort;
for (; port < firstPort + 20; port++) {
  if (await isStlTools(port)) {
    console.log(`STL Tools is already running: http://127.0.0.1:${port}`);
    openBrowser(`http://127.0.0.1:${port}`);
    process.exit(0);
  }
  if (await portFree(port)) break;
}
if (port >= firstPort + 20) {
  console.error(`No free port between ${firstPort} and ${firstPort + 19}. Use --port.`);
  process.exit(1);
}

// The server and registry read these at import time, so set them first.
process.env.STLTOOLS_DATA = dataDir;
process.env.STLTOOLS_CUSTOM = customDir;
process.env.STLTOOLS_MODE = MODE;
if (stopAt) process.env.STLTOOLS_STOP_AT = stopAt.toISOString();
const { startServer } = await import('../src/server.js');
const { initKernel } = await import('../src/core/kernel.js');
const { registryIssues } = await import('../src/core/registry.js');
const { presetIssues } = await import('../src/core/presets.js');
await initKernel();
await startServer({ host, port, dataDir });

const url = `http://127.0.0.1:${port}`;
console.log('');
console.log('  STL Tools is running.');
console.log(`  Open:        ${url}`);
if (host === '0.0.0.0') {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  for (const ip of ips) console.log(`  On your LAN: http://${ip}:${port}`);
}
console.log(`  Your data:   ${dataDir}`);
console.log(`  Your custom: ${customDir}`);
const issues = [...registryIssues(), ...presetIssues()];
if (issues.length) console.log(`  Skipped custom files:\n    ${issues.join('\n    ')}`);
if (MODE === 'portable') console.log('  Portable:    all data stays in the folder above (USB drive). Unplug only after stopping.');
if (MODE === 'temp') console.log('  Temporary:   this session and its data are deleted when you stop STL Tools.');
if (stopAt) {
  console.log(`  Auto-stop:   at ${stopAt.toLocaleTimeString()} (${hours} h)`);
  setTimeout(() => { console.log('Time limit reached: stopping STL Tools.'); process.exit(0); }, hours * 3600e3).unref?.();
  setTimeout(() => process.exit(0), hours * 3600e3);
}
console.log('  Close this window (or press Ctrl+C) to stop.');
console.log('');
openBrowser(url);
