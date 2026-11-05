import partsBox from '../generators/parts-box.js';
import rcWing from '../generators/rc-wing.js';
import stackBin from '../generators/stack-bin.js';
import labelCard from '../generators/label-card.js';
import hook from '../generators/hook.js';
import toolRack from '../generators/tool-rack.js';
import holderBlock from '../generators/holder-block.js';
import tubeClamp from '../generators/tube-clamp.js';
import tubeJoint from '../generators/tube-joint.js';
import tubeCap from '../generators/tube-cap.js';
import spacer from '../generators/spacer.js';
import gpsMast from '../generators/gps-mast.js';
import { antennaMount, zipTieMount, cameraMount, actionCamMount, connectorMount } from '../generators/small-mounts.js';
import { fcAdapter, softGrommet, damperPlate } from '../generators/fc-parts.js';
import { multirotorFrame, motorMount, propGuard, landingLeg } from '../generators/quad-parts.js';
import { controlHorn, servoMount, pinHinge, firewallMount, fuselageFormer, rcWheel } from '../generators/plane-parts.js';
import { gear, pulley, stepperMount, bearingBlock, shaftCoupler, linkBar, knob, enclosure } from '../generators/robotics.js';
import { resolveParams } from './params.js';
import { initKernel, createScope, toPlainMesh } from './kernel.js';

// To add a generator: create src/generators/<id>.js exporting
// { id, name, description, params, generate(params, k) } and add it here.
// k is a kernel scope from src/core/kernel.js. Return { parts: [{ name, manifold }], warnings, notes }.
const GENERATORS = [stackBin, partsBox, holderBlock, hook, toolRack, labelCard, rcWing, tubeClamp, tubeJoint, tubeCap, spacer, gpsMast, antennaMount, zipTieMount, cameraMount, actionCamMount, connectorMount, fcAdapter, softGrommet, damperPlate, multirotorFrame, motorMount, propGuard, landingLeg, controlHorn, servoMount, pinHinge, firewallMount, fuselageFormer, rcWheel, gear, pulley, stepperMount, bearingBlock, shaftCoupler, linkBar, knob, enclosure];

const byId = new Map(GENERATORS.map((g) => [g.id, g]));

export function listGenerators() {
  return GENERATORS.map(({ id, name, description, params, sections }) => ({ id, name, description, params, sections: sections ?? ['shop'] }));
}

export function getGenerator(id) {
  const g = byId.get(id);
  if (!g) throw new Error(`Unknown generator "${id}". Available: ${[...byId.keys()].join(', ')}`);
  return g;
}

/** Convert parameter names from older versions (saved files, presets, catalog). */
export function migrateInput(g, input = {}) {
  return typeof g.migrate === 'function' ? g.migrate(input) : input;
}

/**
 * Validate input and run a generator.
 * Each part comes back as a plain mesh { positions, indices }, ready for toStl().
 * @returns {Promise<{ id, params, parts: Array<{name, mesh}>, warnings: string[], notes: string[] }>}
 */
export async function generate(id, input = {}) {
  const g = getGenerator(id);
  const params = resolveParams(g.params, migrateInput(g, input));
  await initKernel();
  const k = createScope();
  try {
    const result = g.generate(params, k);
    const parts = result.parts.map(({ name, manifold }) => ({ name, mesh: toPlainMesh(manifold) }));
    return { id, params, parts, warnings: result.warnings ?? [], notes: result.notes ?? [], meta: result.meta ?? {} };
  } finally {
    k.free();
  }
}
