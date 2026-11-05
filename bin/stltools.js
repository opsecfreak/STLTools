#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generate, listGenerators, getGenerator } from '../src/core/registry.js';
import { ParamError } from '../src/core/params.js';
import { toStl, meshStats } from '../src/core/export.js';
import { listPresets, getPreset } from '../src/core/presets.js';

const USAGE = `stltools - parametric STL generator (units: mm)

Usage:
  stltools list                         List generators
  stltools info <generator>             Show parameters and defaults
  stltools gen <generator> [options]    Generate STL files
  stltools presets [search]             List ready-made designs (filter by word)
  stltools preset <preset-id> [options] Generate a preset; flags override its values

Options for gen:
  --<param> <value>      Set a parameter, e.g. --width 100 --lid false
  --params <file.json>   Load parameters from a JSON file (flags override it)
  -o, --out <dir>        Output directory (default: ./out)
  --ascii                Write ASCII STL instead of binary
  --name <prefix>        File name prefix (default: generator id)

Examples:
  stltools gen parts-box --width 100 --depth 60 --height 30 --compartmentsX 4
  stltools gen rc-wing --airfoil 4412 --halfSpan 500 --rootChord 200 --tipChord 150
  stltools presets drone
  stltools preset drone-props-5in --labelText "PROPS 5IN" -o out
`;

function parseArgs(argv) {
  const opts = { params: {}, out: 'out', ascii: false, name: null, paramsFile: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '--ascii') opts.ascii = true;
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--params') opts.paramsFile = argv[++i];
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) opts.params[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) opts.params[a.slice(2)] = 'true';
        else opts.params[a.slice(2)] = argv[++i];
      }
    } else positional.push(a);
  }
  return { opts, positional };
}

function cmdList() {
  for (const g of listGenerators()) console.log(`${g.id.padEnd(14)} ${g.description}`);
}

function cmdPresets(filter) {
  const f = (filter ?? '').toLowerCase();
  let group = null;
  for (const p of listPresets()) {
    const hay = [p.id, p.name, p.group, p.generator, ...p.tags].join(' ').toLowerCase();
    if (f && !hay.includes(f)) continue;
    if (p.group !== group) {
      group = p.group;
      console.log(`\n[${group}]`);
    }
    console.log(`  ${p.id.padEnd(30)} ${p.name}`);
  }
}

function cmdInfo(id) {
  const g = getGenerator(id);
  console.log(`${g.name} (${g.id})\n${g.description}\n`);
  let group = null;
  for (const [key, d] of Object.entries(g.params)) {
    if (d.group !== group) {
      group = d.group;
      console.log(`[${group}]`);
    }
    const range = d.min !== undefined ? ` [${d.min}..${d.max}]` : '';
    const unit = d.unit ? ` ${d.unit}` : '';
    console.log(`  --${key.padEnd(20)} ${String(d.default).padEnd(8)}${unit}${range}  ${d.label}`);
    if (d.help) console.log(`  ${' '.repeat(22)} ${d.help}`);
  }
}

async function cmdGen(id, opts, base = {}) {
  let input = { ...base };
  if (opts.paramsFile) input = JSON.parse(readFileSync(opts.paramsFile, 'utf8'));
  // A saved .params.json from a previous run has { generator, params }
  if (input.params && input.generator) input = { ...base, ...input.params };
  Object.assign(input, opts.params);

  const t0 = Date.now();
  const result = await generate(id, input);
  const outDir = resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  const prefix = opts.name ?? id;

  for (const part of result.parts) {
    const file = join(outDir, `${prefix}-${part.name}.stl`);
    writeFileSync(file, toStl(part.mesh, { binary: !opts.ascii, name: `${prefix}-${part.name}` }));
    const s = meshStats(part.mesh);
    console.log(`wrote ${file}  ${s.size.join(' x ')} mm  ${(s.volumeMm3 / 1000).toFixed(1)} cm3  ${s.triangles} tris`);
  }
  const paramsFile = join(outDir, `${prefix}.params.json`);
  writeFileSync(paramsFile, JSON.stringify({ generator: id, params: result.params }, null, 2) + '\n');
  console.log(`wrote ${paramsFile}`);
  for (const n of result.notes) console.log(`note: ${n}`);
  for (const w of result.warnings) console.warn(`WARNING: ${w}`);
  console.log(`done in ${Date.now() - t0} ms`);
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const [cmd, id] = positional;
  if (opts.help || !cmd) return console.log(USAGE);
  if (cmd === 'list') return cmdList();
  if (cmd === 'presets') return cmdPresets(id);
  if (!id) throw new Error(`"${cmd}" needs a generator id. Run "stltools list".`);
  if (cmd === 'info') return cmdInfo(id);
  if (cmd === 'gen') return cmdGen(id, opts);
  if (cmd === 'preset') {
    const preset = getPreset(id);
    console.log(`${preset.name}: ${preset.description}`);
    return cmdGen(preset.generator, { ...opts, name: opts.name ?? preset.id }, preset.params);
  }
  throw new Error(`Unknown command "${cmd}".\n\n${USAGE}`);
}

main().catch((err) => {
  console.error(err instanceof ParamError ? err.message : `Error: ${err.message}`);
  process.exit(1);
});
