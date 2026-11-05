import partsBox from '../generators/parts-box.js';
import rcWing from '../generators/rc-wing.js';
import { resolveParams } from './params.js';
import { initKernel, createScope, toPlainMesh } from './kernel.js';

// To add a generator: create src/generators/<id>.js exporting
// { id, name, description, params, generate(params, k) } and add it here.
// k is a kernel scope from src/core/kernel.js. Return { parts: [{ name, manifold }], warnings, notes }.
const GENERATORS = [partsBox, rcWing];

const byId = new Map(GENERATORS.map((g) => [g.id, g]));

export function listGenerators() {
  return GENERATORS.map(({ id, name, description, params }) => ({ id, name, description, params }));
}

export function getGenerator(id) {
  const g = byId.get(id);
  if (!g) throw new Error(`Unknown generator "${id}". Available: ${[...byId.keys()].join(', ')}`);
  return g;
}

/**
 * Validate input and run a generator.
 * Each part comes back as a plain mesh { positions, indices }, ready for toStl().
 * @returns {Promise<{ id, params, parts: Array<{name, mesh}>, warnings: string[], notes: string[] }>}
 */
export async function generate(id, input = {}) {
  const g = getGenerator(id);
  const params = resolveParams(g.params, input);
  await initKernel();
  const k = createScope();
  try {
    const result = g.generate(params, k);
    const parts = result.parts.map(({ name, manifold }) => ({ name, mesh: toPlainMesh(manifold) }));
    return { id, params, parts, warnings: result.warnings ?? [], notes: result.notes ?? [] };
  } finally {
    k.free();
  }
}
