// Parameter schema handling shared by the CLI, the web server, and tests.
//
// A generator declares its parameters as:
//   { key: { type, default, label, unit, min, max, step, group, help, options } }
// type is one of: number, integer, boolean, string, select.

export class ParamError extends Error {
  constructor(errors) {
    super(`Invalid parameters:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ParamError';
    this.errors = errors;
  }
}

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on', 'y']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off', 'n']);

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return undefined;
}

/**
 * Merge user input with defaults, coerce types, and enforce limits.
 * Throws ParamError listing every problem found.
 */
export function resolveParams(schema, input = {}) {
  const out = {};
  const errors = [];

  for (const key of Object.keys(input)) {
    if (!(key in schema)) errors.push(`unknown parameter "${key}"`);
  }

  for (const [key, def] of Object.entries(schema)) {
    let value = input[key];
    if (value === undefined || value === null || value === '') value = def.default;

    switch (def.type) {
      case 'number':
      case 'integer': {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          errors.push(`${key}: "${value}" is not a number`);
          continue;
        }
        if (def.type === 'integer' && !Number.isInteger(n)) {
          errors.push(`${key}: must be a whole number (got ${n})`);
          continue;
        }
        if (def.min !== undefined && n < def.min) errors.push(`${key}: ${n} is below minimum ${def.min}`);
        if (def.max !== undefined && n > def.max) errors.push(`${key}: ${n} is above maximum ${def.max}`);
        out[key] = n;
        break;
      }
      case 'boolean': {
        const b = coerceBoolean(value);
        if (b === undefined) {
          errors.push(`${key}: "${value}" is not true/false`);
          continue;
        }
        out[key] = b;
        break;
      }
      case 'string': {
        const s = String(value).trim();
        if (def.pattern && !new RegExp(def.pattern).test(s)) {
          errors.push(`${key}: "${s}" does not match required format${def.help ? ` (${def.help})` : ''}`);
          continue;
        }
        out[key] = s;
        break;
      }
      case 'select': {
        const s = String(value);
        const allowed = def.options.map((o) => (typeof o === 'object' ? o.value : o));
        if (!allowed.includes(s)) {
          errors.push(`${key}: "${s}" is not one of ${allowed.join(', ')}`);
          continue;
        }
        out[key] = s;
        break;
      }
      default:
        errors.push(`${key}: schema has unsupported type "${def.type}"`);
    }
  }

  if (errors.length) throw new ParamError(errors);
  return out;
}

/** Defaults only, for docs and UI. */
export function defaultParams(schema) {
  return Object.fromEntries(Object.entries(schema).map(([k, d]) => [k, d.default]));
}
