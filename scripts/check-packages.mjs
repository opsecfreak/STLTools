#!/usr/bin/env node
// Checks the release packages in dist/ (built by scripts/package.mjs) without
// running them: the bundled Node.js binary is for the right OS and CPU, start
// scripts are present and executable, Windows scripts have CRLF line endings,
// SHA256SUMS.txt matches, and no personal data folder slipped in.
//
//   node scripts/check-packages.mjs [dist]
//
// Running the packages for real is done by CI (Windows x64, Linux ARM64, Linux x64).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = process.argv[2] ?? join(ROOT, 'dist');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

/** OS / CPU of a binary from its header: PE (Windows), ELF (Linux), Mach-O (macOS). */
function binaryKind(file) {
  const b = readFileSync(file).subarray(0, 4096);
  if (b[0] === 0x4d && b[1] === 0x5a) {
    const pe = b.readUInt32LE(0x3c);
    const machine = b.readUInt16LE(pe + 4);
    return { os: 'windows', cpu: { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'x86' }[machine] ?? machine.toString(16) };
  }
  if (b[0] === 0x7f && b.toString('latin1', 1, 4) === 'ELF') {
    const machine = b.readUInt16LE(18);
    return { os: 'linux', cpu: { 0x3e: 'x64', 0xb7: 'arm64', 0x28: 'armv7l' }[machine] ?? machine.toString(16), bits: b[4] === 2 ? 64 : 32 };
  }
  if (b.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = b.readUInt32LE(4);
    return { os: 'macos', cpu: { 0x0100000c: 'arm64', 0x01000007: 'x64' }[cpu] ?? cpu.toString(16) };
  }
  return { os: 'unknown', cpu: '?' };
}

const EXPECT = {
  'windows-x64': { os: 'windows', cpu: 'x64', node: 'node/node.exe', scripts: ['Start STL Tools.bat', 'Start STL Tools (USB portable).bat', 'Start STL Tools (one-time session).bat', 'Install STL Tools.bat', 'install/install-windows.ps1'] },
  'linux-x64': { os: 'linux', cpu: 'x64', node: 'node/bin/node', scripts: ['start.sh', 'start-portable.sh', 'install/install-linux.sh', 'app/deploy/install-pi.sh'] },
  'linux-arm64': { os: 'linux', cpu: 'arm64', node: 'node/bin/node', scripts: ['start.sh', 'start-portable.sh', 'install/install-linux.sh', 'app/deploy/install-pi.sh'] },
  'linux-armv7l': { os: 'linux', cpu: 'armv7l', node: 'node/bin/node', scripts: ['start.sh', 'start-portable.sh', 'install/install-linux.sh', 'app/deploy/install-pi.sh'] },
  'macos-arm64': { os: 'macos', cpu: 'arm64', node: 'STL Tools.app/Contents/Resources/node/bin/node', scripts: ['Start STL Tools.command', 'Start STL Tools (USB portable).command', 'STL Tools.app/Contents/MacOS/STLTools'] },
  'macos-x64': { os: 'macos', cpu: 'x64', node: 'STL Tools.app/Contents/Resources/node/bin/node', scripts: ['Start STL Tools.command', 'Start STL Tools (USB portable).command', 'STL Tools.app/Contents/MacOS/STLTools'] },
  'any-os': { node: null, scripts: ['Start STL Tools.bat', 'start.sh', 'start-portable.sh', 'Start STL Tools.command'] },
};

const files = existsSync(DIST) ? readdirSync(DIST) : [];
const sums = existsSync(join(DIST, 'SHA256SUMS.txt')) ? readFileSync(join(DIST, 'SHA256SUMS.txt'), 'utf8') : '';
const work = mkdtempSync(join(tmpdir(), 'stltools-pkgcheck-'));
try {
  let seen = 0;
  for (const [target, want] of Object.entries(EXPECT)) {
    const archive = files.find((f) => f === `stltools-${VERSION}-${target}.zip` || f === `stltools-${VERSION}-${target}.tar.gz`);
    if (!archive) { console.log(`skip ${target} (not built)`); continue; }
    seen++;
    const full = join(DIST, archive);
    const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
    check(sums.includes(`${hash}  ${archive}`), `${archive}: listed in SHA256SUMS.txt with the right hash`);
    const out = join(work, target);
    execFileSync('mkdir', ['-p', out]);
    if (archive.endsWith('.zip')) execFileSync('unzip', ['-q', full, '-d', out]);
    else execFileSync('tar', ['-xzf', full, '-C', out]);
    const root = join(out, `stltools-${VERSION}-${target}`);
    if (want.node) {
      const k = binaryKind(join(root, want.node));
      check(k.os === want.os && k.cpu === want.cpu, `${target}: bundled Node.js is ${k.os} ${k.cpu}${k.bits ? ` (${k.bits}-bit)` : ''}`);
    }
    for (const s of want.scripts) {
      const p = join(root, s);
      if (!existsSync(p)) { check(false, `${target}: ${s} present`); continue; }
      const text = readFileSync(p, 'latin1');
      if (/\.(bat|ps1)$/.test(s)) check(!/[^\r]\n/.test(text), `${target}: ${s} has CRLF line endings`);
      else if (!/\.(js)$/.test(s)) check(target.startsWith('windows') || (statSync(p).mode & 0o111) !== 0, `${target}: ${s} is executable`);
    }
    const app = existsSync(join(root, 'app')) ? join(root, 'app') : join(root, 'STL Tools.app', 'Contents', 'Resources', 'app');
    check(existsSync(join(app, 'node_modules', 'manifold-3d')), `${target}: manifold-3d bundled`);
    check(!existsSync(join(app, 'data')) && !existsSync(join(app, 'test')), `${target}: no data/ or test/ folder shipped`);
    const readme = readFileSync(join(root, 'README-FIRST.txt'), 'utf8');
    check(readme.includes(VERSION), `${target}: README-FIRST names version ${VERSION}`);
  }
  check(seen > 0, `at least one package found in ${DIST}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} package check(s) failed` : '\nPackage check passed');
process.exit(failures.length ? 1 : 0);
