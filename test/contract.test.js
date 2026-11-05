// Contract tests: rules every generator and preset must follow, so new parts
// (core or custom) can be added without breaking the UI, the CLI or saved data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listGenerators, SECTION_IDS, registryIssues } from '../src/core/registry.js';
import { listPresets, presetIssues } from '../src/core/presets.js';
import { resolveParams } from '../src/core/params.js';

const TYPES = ['number', 'integer', 'boolean', 'string', 'select'];

test('core loads with no issues', () => {
  assert.deepEqual(registryIssues(), []);
  assert.deepEqual(presetIssues(), []);
});

test('every generator follows the schema contract', () => {
  const ids = new Set();
  for (const g of listGenerators()) {
    const at = `generator ${g.id}`;
    assert.match(g.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${at}: id must be lowercase-with-dashes`);
    assert.ok(!ids.has(g.id), `${at}: duplicate id`);
    ids.add(g.id);
    assert.ok(g.name && g.description, `${at}: needs name and description`);
    assert.ok(g.sections.length && g.sections.every((s) => SECTION_IDS.includes(s)), `${at}: sections must be from ${SECTION_IDS}`);
    for (const [key, d] of Object.entries(g.params)) {
      const pat = `${at}.${key}`;
      assert.ok(TYPES.includes(d.type), `${pat}: type must be one of ${TYPES}`);
      assert.ok(d.label, `${pat}: needs a label`);
      assert.ok('default' in d, `${pat}: needs a default`);
      if (d.type === 'number' || d.type === 'integer') {
        assert.ok(d.min === undefined || d.default >= d.min, `${pat}: default below min`);
        assert.ok(d.max === undefined || d.default <= d.max, `${pat}: default above max`);
      }
      if (d.type === 'integer') assert.ok(Number.isInteger(d.default), `${pat}: integer default`);
      if (d.type === 'select') assert.ok(d.options.map((o) => o.value ?? o).includes(d.default), `${pat}: default not in options`);
    }
    resolveParams(g.params, {}); // defaults must validate
  }
});

test('every preset points at a known generator and a known tab', () => {
  const gens = new Set(listGenerators().map((g) => g.id));
  for (const p of listPresets()) {
    assert.ok(gens.has(p.generator), `preset ${p.id}: unknown generator ${p.generator}`);
    assert.ok(SECTION_IDS.includes(p.section), `preset ${p.id}: unknown section ${p.section}`);
  }
});

test('custom folder: good files load, broken files are skipped and reported', () => {
  const d = mkdtempSync(join(tmpdir(), 'stltools-custom-'));
  try {
    mkdirSync(join(d, 'generators'));
    mkdirSync(join(d, 'presets'));
    writeFileSync(join(d, 'package.json'), '{ "type": "module" }'); // the launcher writes this
    cpSync('custom/generators/_example-bracket.js', join(d, 'generators', 'bracket.js'));
    writeFileSync(join(d, 'generators', 'broken.js'), 'export default { id: "x", generate( }');
    writeFileSync(join(d, 'generators', 'clash.js'), 'export default { id: "tube-clamp", name: "x", description: "x", params: {}, generate() { return { parts: [] }; } };');
    cpSync('custom/presets/_example-presets.json', join(d, 'presets', 'mine.json'));
    writeFileSync(join(d, 'presets', 'bad.json'), JSON.stringify({ presets: [{ id: 'bad-one', name: 'Bad', generator: 'tube-clamp', params: { tubeOD: -3 } }] }));
    writeFileSync(join(d, 'presets', 'notjson.json'), '{ nope');
    const script = `
      import { listGenerators, registryIssues, generate } from './src/core/registry.js';
      import { listPresets, presetIssues } from './src/core/presets.js';
      const r = await generate('my-angle-bracket', {});
      console.log(JSON.stringify({ gens: listGenerators().map((g) => g.id), presets: listPresets().map((p) => p.id), parts: r.parts.length, issues: [...registryIssues(), ...presetIssues()] }));`;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, STLTOOLS_CUSTOM: d }, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    assert.ok(out.gens.includes('my-angle-bracket'), 'custom generator loaded');
    assert.equal(out.parts, 1);
    assert.ok(out.presets.includes('my-clamp-12-long'), 'custom preset loaded');
    assert.ok(!out.presets.includes('bad-one'), 'bad preset skipped');
    assert.equal(out.issues.length, 4, `broken.js, clash, bad preset, notjson: ${out.issues.join(' | ')}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('desktop launcher starts, reports its version, and reuses a running server', async () => {
  const home = mkdtempSync(join(tmpdir(), 'stltools-home-'));
  const port = 3300 + Math.floor(Math.random() * 500);
  const env = { ...process.env, STLTOOLS_HOME: home, PORT: String(port) };
  delete env.STLTOOLS_DATA;
  delete env.STLTOOLS_CUSTOM;
  const child = spawn(process.execPath, ['bin/stltools-app.js', '--no-browser'], { env, stdio: 'ignore' });
  try {
    let v = null;
    for (let i = 0; i < 50 && !v; i++) {
      await new Promise((r) => setTimeout(r, 200));
      v = await fetch(`http://127.0.0.1:${port}/api/version`).then((r) => r.json()).catch(() => null);
    }
    assert.equal(v?.name, 'stltools');
    assert.equal(v.dataDir, join(home, 'data'));
    const second = execFileSync(process.execPath, ['bin/stltools-app.js', '--no-browser'], { env }).toString();
    assert.match(second, /already running/);
  } finally {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
