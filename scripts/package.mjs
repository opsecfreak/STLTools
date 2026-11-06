#!/usr/bin/env node
// Builds release packages into dist/.
//
//   node scripts/package.mjs              all targets
//   node scripts/package.mjs any-os linux-x64   only these
//
// Each desktop package bundles an official Node.js runtime (checksum verified),
// so the user needs nothing else installed. "any-os" has no runtime and needs
// Node.js 18+ on the machine. Needs: npm, tar, zip, unzip, xz (Linux/macOS build host).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const NODE_VERSION = process.env.BUNDLED_NODE_VERSION ?? '22.12.0';
const DIST = join(ROOT, 'dist');
const BUILD = join(DIST, 'build');
const CACHE = join(ROOT, '.cache', 'node');
const P = join(ROOT, 'packaging');

const TARGETS = {
  'any-os': { kind: 'any' },
  'windows-x64': { kind: 'win', node: `node-v${NODE_VERSION}-win-x64.zip` },
  'macos-arm64': { kind: 'mac', node: `node-v${NODE_VERSION}-darwin-arm64.tar.gz` },
  'macos-x64': { kind: 'mac', node: `node-v${NODE_VERSION}-darwin-x64.tar.gz` },
  'linux-x64': { kind: 'linux', node: `node-v${NODE_VERSION}-linux-x64.tar.xz` },
  'linux-arm64': { kind: 'linux', node: `node-v${NODE_VERSION}-linux-arm64.tar.xz` },
  'linux-armv7l': { kind: 'linux', node: `node-v${NODE_VERSION}-linux-armv7l.tar.xz` },
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
for (const t of wanted) if (!TARGETS[t]) throw new Error(`Unknown target ${t}. Known: ${Object.keys(TARGETS).join(', ')}`);

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
/** Copy a Windows script with CRLF line endings (cmd.exe misreads some LF-only batch files). */
const copyCrlf = (from, to) => writeFileSync(to, readFileSync(from, 'utf8').replace(/\r?\n/g, '\r\n'));
const log = (msg) => console.log(`\n==> ${msg}`);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ---------- 1. stage the app ----------
log(`STL Tools ${VERSION}: staging app`);
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
for (const f of existsSync(DIST) ? readdirSync(DIST) : []) if (/\.(zip|tar\.gz)$|^SHA256SUMS|^RELEASE_NOTES/.test(f)) rmSync(join(DIST, f));
const APP = join(BUILD, 'app');
for (const item of ['bin', 'src', 'public', 'presets', 'printer-profiles', 'seed', 'custom', 'deploy', 'docs', 'package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'AGENTS.md', 'LICENSE', 'NOTICE', 'EDITION.json']) {
  if (!existsSync(join(ROOT, item))) continue; // EDITION.json exists only on personal editions
  // README screenshots stay on GitHub; the packages do not need them
  cpSync(join(ROOT, item), join(APP, item), { recursive: true, filter: (src) => !src.includes(`${join('docs', 'screenshots')}`) });
}
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: APP });

// ---------- 2. prune node_modules to what runs ----------
// Runtime needs: manifold-3d (JS + WASM), opentype.js (+2 small deps), one font
// file, and three.js core + two example modules for the browser preview.
log('pruning dependencies');
const NM = join(APP, 'node_modules');
const keep = new Set(['manifold-3d', 'opentype.js', 'tiny-inflate', 'string.prototype.codepointat', '@fontsource', 'three']);
for (const name of readdirSync(NM)) {
  if (name.startsWith('.')) continue;
  if (!keep.has(name)) rmSync(join(NM, name), { recursive: true, force: true });
}
for (const name of readdirSync(join(NM, '@fontsource'))) if (name !== 'roboto-condensed') rmSync(join(NM, '@fontsource', name), { recursive: true, force: true });
const fontDir = join(NM, '@fontsource', 'roboto-condensed', 'files');
for (const f of readdirSync(fontDir)) if (f !== 'roboto-condensed-latin-700-normal.woff') rmSync(join(fontDir, f));
rmSync(join(NM, 'manifold-3d', 'dist'), { recursive: true, force: true });
rmSync(join(NM, 'manifold-3d', 'node_modules'), { recursive: true, force: true });
const three = join(NM, 'three');
const threeKeep = ['package.json', 'LICENSE', 'build/three.module.js', 'examples/jsm/controls/OrbitControls.js', 'examples/jsm/loaders/STLLoader.js'];
const threeTmp = join(BUILD, 'three-keep');
for (const f of threeKeep) cpSync(join(three, f), join(threeTmp, f), { recursive: true });
rmSync(three, { recursive: true, force: true });
renameSync(threeTmp, three);

// ---------- 3. smoke test the pruned app ----------
log('smoke test: generate parts with the pruned app');
const smokeOut = join(BUILD, 'smoke');
run(process.execPath, [join(APP, 'bin', 'stltools.js'), 'preset', 'clamp-mount-10', '-o', smokeOut], { stdio: 'pipe' });
run(process.execPath, [join(APP, 'bin', 'stltools.js'), 'gen', 'stack-bin', '--labelType', 'emboss', '--labelText', 'TEST', '-o', smokeOut], { stdio: 'pipe' });
if (!readdirSync(smokeOut).some((f) => f.endsWith('.stl'))) throw new Error('smoke test produced no STL');
rmSync(smokeOut, { recursive: true, force: true });

// ---------- 4. Node runtimes ----------
let shasums = null;
async function nodeArchive(file) {
  mkdirSync(CACHE, { recursive: true });
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
  if (!shasums) {
    const res = await fetch(`${base}/SHASUMS256.txt`);
    if (!res.ok) throw new Error(`Cannot download Node.js checksums: HTTP ${res.status}`);
    shasums = await res.text();
  }
  const expected = shasums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`No checksum for ${file}`);
  const dest = join(CACHE, file);
  if (!existsSync(dest) || sha256(dest) !== expected) {
    log(`downloading ${file}`);
    const res = await fetch(`${base}/${file}`);
    if (!res.ok) throw new Error(`Download failed: ${file} HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  if (sha256(dest) !== expected) throw new Error(`Checksum mismatch for ${file}`);
  return dest;
}

/** Extract node binary + LICENSE into targetDir (node.exe for Windows, bin/node otherwise). */
async function addNode(target, targetDir) {
  const archive = await nodeArchive(target.node);
  const tmp = join(BUILD, `extract-${target.node}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (archive.endsWith('.zip')) run('unzip', ['-q', archive, '-d', tmp]);
  else run('tar', ['-xf', archive, '-C', tmp]);
  const inner = join(tmp, readdirSync(tmp)[0]);
  mkdirSync(targetDir, { recursive: true });
  if (target.kind === 'win') {
    cpSync(join(inner, 'node.exe'), join(targetDir, 'node.exe'));
  } else {
    cpSync(join(inner, 'bin', 'node'), join(targetDir, 'bin', 'node'));
    chmodSync(join(targetDir, 'bin', 'node'), 0o755);
  }
  cpSync(join(inner, 'LICENSE'), join(targetDir, 'LICENSE'));
  rmSync(tmp, { recursive: true, force: true });
}

// ---------- 5. assemble packages ----------
const readmeFor = (target) => {
  const text = {
    any: {
      start: 'Needs Node.js 18 or newer (https://nodejs.org).\n  Windows: double-click "Start STL Tools.bat"\n  macOS:   double-click "Start STL Tools.command" (first time: right-click > Open)\n  Linux:   ./start.sh',
      install: 'Linux / Raspberry Pi: ./install/install-linux.sh  (add --service --lan for a shop server)\n  Windows / macOS: no installer for this package. Use the windows-x64 or macos package for shortcuts.',
    },
    win: {
      start: 'Double-click "Start STL Tools.bat".\nIf Windows shows "Windows protected your PC": click More info > Run anyway\n(the download is not code-signed).',
      install: 'Double-click "Install STL Tools.bat". It copies the app to\n%LOCALAPPDATA%\\Programs\\STL Tools and adds Desktop and Start menu shortcuts. No admin rights needed.',
    },
    mac: {
      start: 'Double-click "STL Tools.app".\nFirst time only: right-click (or Control-click) the app > Open > Open,\nbecause the app is not signed by Apple. Quit it from the Dock to stop it.\nPrefer a log window? Use "Start STL Tools.command" instead.',
      install: 'Drag "STL Tools.app" into your Applications folder.',
    },
    linux: {
      start: './start.sh            (this computer only)\n./start.sh --lan      (reachable from phones / PCs on your network)',
      install: './install/install-linux.sh                  menu entry + "stltools-app" command\n./install/install-linux.sh --service --lan  run at boot as a shop server (Raspberry Pi)',
    },
  }[target.kind];
  return readFileSync(join(P, 'README-FIRST.txt'), 'utf8').replaceAll('{{VERSION}}', VERSION).replaceAll('{{TARGET}}', target.id).replaceAll('{{START}}', text.start).replaceAll('{{INSTALL}}', text.install);
};

const assets = [];
for (const id of wanted) {
  const target = { id, ...TARGETS[id] };
  const name = `stltools-${VERSION}-${id}`;
  const root = join(BUILD, name);
  log(`assembling ${name}`);
  mkdirSync(root, { recursive: true });
  const readmeText = readmeFor(target);
  writeFileSync(join(root, 'README-FIRST.txt'), target.kind === 'win' ? readmeText.replace(/\r?\n/g, '\r\n') : readmeText);
  if (target.kind === 'mac') {
    const contents = join(root, 'STL Tools.app', 'Contents');
    cpSync(APP, join(contents, 'Resources', 'app'), { recursive: true });
    await addNode(target, join(contents, 'Resources', 'node'));
    writeFileSync(join(contents, 'Info.plist'), readFileSync(join(P, 'macos', 'Info.plist'), 'utf8').replaceAll('{{VERSION}}', VERSION));
    mkdirSync(join(contents, 'MacOS'), { recursive: true });
    cpSync(join(P, 'macos', 'STLTools'), join(contents, 'MacOS', 'STLTools'));
    chmodSync(join(contents, 'MacOS', 'STLTools'), 0o755);
    cpSync(join(P, 'macos', 'start.command'), join(root, 'Start STL Tools.command'));
    chmodSync(join(root, 'Start STL Tools.command'), 0o755);
  } else {
    cpSync(APP, join(root, 'app'), { recursive: true });
    if (target.kind !== 'any') await addNode(target, join(root, 'node'));
    if (target.kind === 'win' || target.kind === 'any') {
      copyCrlf(join(P, 'windows', 'start.bat'), join(root, 'Start STL Tools.bat'));
    }
    if (target.kind === 'win') {
      copyCrlf(join(P, 'windows', 'install.bat'), join(root, 'Install STL Tools.bat'));
      mkdirSync(join(root, 'install'), { recursive: true });
      copyCrlf(join(P, 'windows', 'install-windows.ps1'), join(root, 'install', 'install-windows.ps1'));
      copyCrlf(join(P, 'windows', 'uninstall-windows.ps1'), join(root, 'install', 'uninstall-windows.ps1'));
    }
    if (target.kind === 'linux' || target.kind === 'any') {
      cpSync(join(P, 'linux', 'start.sh'), join(root, 'start.sh'));
      chmodSync(join(root, 'start.sh'), 0o755);
      mkdirSync(join(root, 'install'), { recursive: true });
      cpSync(join(P, 'linux', 'install-linux.sh'), join(root, 'install', 'install-linux.sh'));
      chmodSync(join(root, 'install', 'install-linux.sh'), 0o755);
    }
    if (target.kind === 'any') {
      cpSync(join(P, 'macos', 'start.command'), join(root, 'Start STL Tools.command'));
      chmodSync(join(root, 'Start STL Tools.command'), 0o755);
    }
  }
  const out = target.kind === 'win' || target.kind === 'any' ? `${name}.zip` : `${name}.tar.gz`;
  rmSync(join(DIST, out), { force: true });
  if (out.endsWith('.zip')) run('zip', ['-q', '-r', '-9', join(DIST, out), name], { cwd: BUILD });
  else run('tar', ['-czf', join(DIST, out), name], { cwd: BUILD });
  assets.push(out);
}

// ---------- 6. checksums + release notes ----------
log('checksums and release notes');
writeFileSync(join(DIST, 'SHA256SUMS.txt'), assets.map((a) => `${sha256(join(DIST, a))}  ${a}`).join('\n') + '\n');
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const latest = changelog.split(/\n(?=## )/).find((s) => s.startsWith('## ')) ?? '';
const notes = `${latest.trim()}

## Download

| Your computer | File |
|---|---|
| Windows 10/11 (64-bit) | \`stltools-${VERSION}-windows-x64.zip\` |
| Mac with Apple chip (M1-M4) | \`stltools-${VERSION}-macos-arm64.tar.gz\` |
| Mac with Intel chip | \`stltools-${VERSION}-macos-x64.tar.gz\` |
| Linux PC (64-bit) | \`stltools-${VERSION}-linux-x64.tar.gz\` |
| Raspberry Pi 4 / 5, 64-bit OS | \`stltools-${VERSION}-linux-arm64.tar.gz\` |
| Raspberry Pi, 32-bit OS | \`stltools-${VERSION}-linux-armv7l.tar.gz\` |
| Any system with Node.js 18+ already installed | \`stltools-${VERSION}-any-os.zip\` |

Each package includes Node.js ${NODE_VERSION}. Unpack it and read \`README-FIRST.txt\`. Full steps: \`docs/INSTALL.md\`. What to test and how to report back: \`docs/TESTING.md\`.

Verify a download: compare its SHA-256 with \`SHA256SUMS.txt\`.
`;
writeFileSync(join(DIST, 'RELEASE_NOTES.md'), notes);
log(`done: ${assets.length} package(s) in dist/`);
for (const a of assets) console.log(`  ${a}`);
