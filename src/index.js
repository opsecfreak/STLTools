// Public API for use as a library:
//   import { generate, toStl } from 'stltools';
export { generate, listGenerators, getGenerator } from './core/registry.js';
export { resolveParams, defaultParams, ParamError } from './core/params.js';
export { toStl, meshStats, openEdgeCount } from './core/export.js';
export { initKernel, createScope, toPlainMesh } from './core/kernel.js';
export { naca4Outline, parseNaca4, sectionAt } from './core/airfoil.js';
