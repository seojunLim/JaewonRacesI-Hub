/**
 * The schema system.
 *
 * Every component, behavior and asset in the engine declares its fields once,
 * as data. That single declaration then drives, with no further work:
 *
 *   - runtime defaults and construction        (`instantiate`)
 *   - loading from scene JSON, with coercion   (`coerce`)
 *   - saving back to scene JSON                (`serialize`)
 *   - validation with precise error paths      (`validateValue`)
 *   - JSON Schema for editor/LLM autocomplete  (`toJSONSchema`)
 *   - the inspector UI in the editor           (field `type` drives the widget)
 *   - the `sjl describe` API manifest
 *
 * The point is that there is exactly one source of truth for "what fields does
 * a Sprite have". A code generator, a human, and the editor cannot drift from
 * each other, because none of them own a second copy.
 *
 * @typedef {object} Field
 * @property {FieldType} type
 * @property {*} [default]
 * @property {string} [description]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string[]} [values]     for `enum`
 * @property {Field}    [items]      for `array`
 * @property {Record<string, Field>} [fields] for `object`
 * @property {string}   [assetType]  for `asset`
 * @property {boolean}  [required]
 */

/** @typedef {'number'|'int'|'boolean'|'string'|'vec2'|'vec3'|'quat'|'color'|'enum'|'array'|'object'|'entity'|'asset'|'any'} FieldType */

import * as Vec2 from '../math/vec2.js';
import * as Vec3 from '../math/vec3.js';
import * as Quat from '../math/quat.js';
import * as Color from '../math/color.js';

export const FIELD_TYPES = [
  'number', 'int', 'boolean', 'string', 'vec2', 'vec3', 'quat', 'color',
  'enum', 'array', 'object', 'entity', 'asset', 'any',
];

/** Thrown by `validate` helpers; carries structured issues, not just a string. */
export class SchemaError extends Error {
  /** @param {string} message @param {Issue[]} issues */
  constructor(message, issues = []) {
    super(message);
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

/** @typedef {{ path: string, message: string, expected?: string, received?: string }} Issue */

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** The value a field takes when a scene file omits it. */
export function defaultValue(field) {
  if (field.default !== undefined) return coerce(field, field.default);
  switch (field.type) {
    case 'number':
    case 'int':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return '';
    case 'vec2':
      return Vec2.vec2(0, 0);
    case 'vec3':
      return Vec3.vec3(0, 0, 0);
    case 'quat':
      return Quat.quat();
    case 'color':
      return Color.color(1, 1, 1, 1);
    case 'enum':
      return field.values?.[0] ?? '';
    case 'array':
      return [];
    case 'object':
      return instantiate(field.fields ?? {});
    case 'entity':
    case 'asset':
      return null;
    case 'any':
    default:
      return null;
  }
}

/**
 * Build a fresh value object from a schema, applying `values` on top of the
 * declared defaults. Unknown keys in `values` are preserved verbatim so that
 * user data attached to a component survives a load/save round trip.
 *
 * @param {Record<string, Field>} schema
 * @param {Record<string, *>} [values]
 */
export function instantiate(schema, values = {}) {
  const out = {};
  for (const [key, field] of Object.entries(schema)) {
    out[key] = values[key] !== undefined ? coerce(field, values[key]) : defaultValue(field);
  }
  for (const key of Object.keys(values)) {
    if (!(key in schema)) out[key] = values[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coercion (JSON -> runtime)
// ---------------------------------------------------------------------------

/**
 * Convert an authored JSON value into its runtime representation.
 *
 * Coercion is deliberately forgiving — `[0, 1]` and `{ x: 0, y: 1 }` are both
 * accepted for a vec2, `"#f00"` and `[1,0,0]` are both accepted for a color.
 * Being strict here would mean rejecting scene files that are obviously
 * correct, which is the fastest way to make a format unpleasant to write.
 * Type *errors* are still caught — by `validateValue`, which runs separately
 * and reports every problem at once instead of throwing on the first.
 */
export function coerce(field, value) {
  switch (field.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return clampNumber(Number.isFinite(n) ? n : 0, field);
    }
    case 'int': {
      const n = typeof value === 'number' ? value : Number(value);
      return clampNumber(Number.isFinite(n) ? Math.round(n) : 0, field);
    }
    case 'boolean':
      return Boolean(value);
    case 'string':
      return value == null ? '' : String(value);
    case 'vec2':
      return Vec2.fromAny(value);
    case 'vec3':
      return Vec3.fromAny(value);
    case 'quat':
      return Quat.fromAny(value);
    case 'color':
      return Color.fromAny(value);
    case 'enum':
      return field.values?.includes(value) ? value : (field.default ?? field.values?.[0] ?? '');
    case 'array': {
      if (!Array.isArray(value)) return [];
      const item = field.items ?? { type: 'any' };
      return value.map((v) => coerce(item, v));
    }
    case 'object':
      return instantiate(field.fields ?? {}, value && typeof value === 'object' ? value : {});
    case 'entity':
    case 'asset':
      return value == null ? null : String(value);
    case 'any':
    default:
      return value;
  }
}

function clampNumber(n, field) {
  if (field.min !== undefined && n < field.min) return field.min;
  if (field.max !== undefined && n > field.max) return field.max;
  return n;
}

// ---------------------------------------------------------------------------
// Serialization (runtime -> JSON)
// ---------------------------------------------------------------------------

/** Inverse of `coerce`. Produces the canonical JSON form for scene files. */
export function serialize(field, value) {
  switch (field.type) {
    case 'vec2':
      return [value?.x ?? 0, value?.y ?? 0];
    case 'vec3':
      return [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0];
    case 'quat':
      return [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0, value?.w ?? 1];
    case 'color':
      return value?.a === 1 ? Color.toHex(value) : Color.toHex(value, true);
    case 'array': {
      const item = field.items ?? { type: 'any' };
      return Array.isArray(value) ? value.map((v) => serialize(item, v)) : [];
    }
    case 'object':
      return serializeObject(field.fields ?? {}, value ?? {});
    default:
      return value;
  }
}

/**
 * Serialize a whole schema'd object, omitting fields that still hold their
 * default value. Scene files stay small and diffs stay meaningful — an agent
 * reviewing a change sees only what actually differs from the default.
 *
 * @param {Record<string, Field>} schema
 * @param {Record<string, *>} value
 * @param {{ includeDefaults?: boolean }} [options]
 */
export function serializeObject(schema, value, options = {}) {
  const out = {};
  for (const [key, field] of Object.entries(schema)) {
    const v = value?.[key];
    if (v === undefined) continue;
    const serialized = serialize(field, v);
    if (!options.includeDefaults) {
      const def = serialize(field, defaultValue(field));
      if (jsonEquals(serialized, def)) continue;
    }
    out[key] = serialized;
  }
  for (const key of Object.keys(value ?? {})) {
    if (!(key in schema) && value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function jsonEquals(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Collect every problem with `value` against `field`.
 *
 * Errors accumulate rather than throw: one `sjl validate` run reports all 12
 * mistakes in a generated scene instead of making the agent fix them one
 * round-trip at a time.
 *
 * @param {Field} field
 * @param {*} value
 * @param {string} path
 * @param {Issue[]} issues
 */
export function validateValue(field, value, path = '', issues = []) {
  const fail = (message, expected, received) => {
    issues.push({ path, message, expected, received: received ?? describeType(value) });
  };

  if (value === undefined || value === null) {
    if (field.required) fail('Required field is missing', field.type, 'undefined');
    return issues;
  }

  switch (field.type) {
    case 'number':
    case 'int': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(`Expected a finite number`, field.type);
        break;
      }
      if (field.type === 'int' && !Number.isInteger(value)) {
        fail(`Expected an integer, got ${value}`, 'int');
      }
      if (field.min !== undefined && value < field.min) {
        fail(`Value ${value} is below the minimum of ${field.min}`, `>= ${field.min}`, String(value));
      }
      if (field.max !== undefined && value > field.max) {
        fail(`Value ${value} is above the maximum of ${field.max}`, `<= ${field.max}`, String(value));
      }
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail('Expected true or false', 'boolean');
      break;
    case 'string':
    case 'entity':
    case 'asset':
      if (typeof value !== 'string') fail(`Expected a string`, field.type);
      break;
    case 'vec2': {
      const ok =
        (Array.isArray(value) && value.length >= 2 && value.every((n) => typeof n === 'number')) ||
        (typeof value === 'object' && typeof value.x === 'number' && typeof value.y === 'number') ||
        typeof value === 'number';
      if (!ok) fail('Expected [x, y], { x, y } or a single number', 'vec2');
      break;
    }
    case 'vec3': {
      const ok =
        (Array.isArray(value) && value.length >= 3 && value.every((n) => typeof n === 'number')) ||
        (typeof value === 'object' &&
          typeof value.x === 'number' &&
          typeof value.y === 'number' &&
          typeof value.z === 'number') ||
        typeof value === 'number';
      if (!ok) {
        // A 2-element array here almost always means a 2D value pasted into a
        // 3D field, which would silently place the object at z = 0.
        const hint =
          Array.isArray(value) && value.length === 2
            ? 'Expected [x, y, z] — this looks like a 2D value; add the z component'
            : 'Expected [x, y, z], { x, y, z } or a single number';
        fail(hint, 'vec3');
      }
      break;
    }
    case 'quat': {
      const ok =
        (Array.isArray(value) && (value.length === 3 || value.length === 4) &&
          value.every((n) => typeof n === 'number')) ||
        (typeof value === 'object' && typeof value.x === 'number');
      if (!ok) fail('Expected [x, y, z, w], or [pitch, yaw, roll] in degrees', 'quat');
      break;
    }
    case 'color': {
      let ok = false;
      if (typeof value === 'string') {
        ok = value in Color.NAMED || /^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
        if (!ok) fail(`"${value}" is not a hex color or a known color name`, 'color');
      } else if (Array.isArray(value)) {
        ok = value.length >= 3 && value.every((n) => typeof n === 'number');
        if (!ok) fail('Expected [r, g, b] or [r, g, b, a] with numeric channels', 'color');
      } else if (typeof value === 'object') {
        ok = typeof value.r === 'number';
        if (!ok) fail('Expected { r, g, b, a }', 'color');
      } else {
        fail('Expected a color', 'color');
      }
      break;
    }
    case 'enum':
      if (!field.values?.includes(value)) {
        fail(
          `"${value}" is not one of: ${(field.values ?? []).join(', ')}`,
          `one of [${(field.values ?? []).join(' | ')}]`,
          JSON.stringify(value),
        );
      }
      break;
    case 'array': {
      if (!Array.isArray(value)) {
        fail('Expected an array', 'array');
        break;
      }
      const item = field.items ?? { type: 'any' };
      value.forEach((v, i) => validateValue(item, v, `${path}[${i}]`, issues));
      break;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        fail('Expected an object', 'object');
        break;
      }
      validateObject(field.fields ?? {}, value, path, issues);
      break;
    }
    case 'any':
    default:
      break;
  }
  return issues;
}

/**
 * Validate an object against a schema, including a check for unknown keys.
 *
 * Unknown keys are reported as errors with a "did you mean" suggestion. A
 * silently ignored `postion: [1, 2]` is the single most expensive failure mode
 * for generated scene files — the game loads, looks wrong, and nothing says why.
 *
 * @param {Record<string, Field>} schema
 * @param {Record<string, *>} value
 */
export function validateObject(schema, value, path = '', issues = []) {
  for (const [key, field] of Object.entries(schema)) {
    const childPath = path ? `${path}.${key}` : key;
    if (value[key] === undefined) {
      if (field.required) {
        issues.push({ path: childPath, message: 'Required field is missing', expected: field.type });
      }
      continue;
    }
    validateValue(field, value[key], childPath, issues);
  }
  const known = Object.keys(schema);
  for (const key of Object.keys(value)) {
    if (key in schema) continue;
    const childPath = path ? `${path}.${key}` : key;
    const suggestion = closestMatch(key, known);
    issues.push({
      path: childPath,
      message: suggestion
        ? `Unknown field "${key}". Did you mean "${suggestion}"?`
        : `Unknown field "${key}". Known fields: ${known.join(', ') || '(none)'}`,
      // When there is a plausible correction, `expected` carries just that —
      // it becomes the `hint:` line in CLI output, and a one-word fix is far
      // more useful there than the full field list repeated from the message.
      expected: suggestion ?? known.join(' | '),
      received: key,
    });
  }
  return issues;
}

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

/** Levenshtein distance, capped for typo suggestions. */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/** The nearest candidate within a sane typo threshold, or `null`. */
export function closestMatch(input, candidates) {
  let best = null;
  let bestScore = Infinity;
  const lower = input.toLowerCase();
  for (const c of candidates) {
    const d = editDistance(lower, c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return bestScore <= threshold ? best : null;
}

// ---------------------------------------------------------------------------
// JSON Schema emission
// ---------------------------------------------------------------------------

/** Convert one field to a JSON Schema fragment. */
export function fieldToJSONSchema(field) {
  const base = {};
  if (field.description) base.description = field.description;
  if (field.default !== undefined) base.default = field.default;

  switch (field.type) {
    case 'number':
    case 'int': {
      const s = { ...base, type: field.type === 'int' ? 'integer' : 'number' };
      if (field.min !== undefined) s.minimum = field.min;
      if (field.max !== undefined) s.maximum = field.max;
      return s;
    }
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'string':
      return { ...base, type: 'string' };
    case 'entity':
      return { ...base, type: 'string', description: `${field.description ?? ''} (entity id)`.trim() };
    case 'asset':
      return {
        ...base,
        type: 'string',
        description: `${field.description ?? ''} (${field.assetType ?? 'asset'} id)`.trim(),
      };
    case 'enum':
      return { ...base, type: 'string', enum: field.values ?? [] };
    case 'vec2':
      return {
        ...base,
        oneOf: [
          { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
            additionalProperties: false,
          },
          { type: 'number' },
        ],
      };
    case 'vec3':
      return {
        ...base,
        oneOf: [
          { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
          {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            required: ['x', 'y', 'z'],
            additionalProperties: false,
          },
          { type: 'number' },
        ],
      };
    case 'quat':
      return {
        ...base,
        description: `${field.description ?? ''} ([x,y,z,w], or [pitch,yaw,roll] degrees)`.trim(),
        type: 'array',
        items: { type: 'number' },
        minItems: 3,
        maxItems: 4,
      };
    case 'color':
      return {
        ...base,
        oneOf: [
          { type: 'string', pattern: '^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' },
          { type: 'string', enum: Object.keys(Color.NAMED) },
          { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 4 },
        ],
      };
    case 'array':
      return { ...base, type: 'array', items: fieldToJSONSchema(field.items ?? { type: 'any' }) };
    case 'object':
      return { ...base, ...schemaToJSONSchema(field.fields ?? {}) };
    case 'any':
    default:
      return base;
  }
}

/** Convert a whole field map into a JSON Schema object node. */
export function schemaToJSONSchema(schema) {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(schema)) {
    properties[key] = fieldToJSONSchema(field);
    if (field.required) required.push(key);
  }
  const out = { type: 'object', properties, additionalProperties: false };
  if (required.length) out.required = required;
  return out;
}

/** A compact, human/LLM-readable one-line summary, e.g. `speed: number = 5`. */
export function describeField(name, field) {
  let type = field.type;
  if (field.type === 'enum') type = (field.values ?? []).join('|');
  if (field.type === 'array') type = `${field.items?.type ?? 'any'}[]`;
  if (field.type === 'asset') type = `asset<${field.assetType ?? 'any'}>`;
  const def = field.default !== undefined ? ` = ${JSON.stringify(field.default)}` : '';
  const range =
    field.min !== undefined || field.max !== undefined
      ? ` (${field.min ?? '-inf'}..${field.max ?? 'inf'})`
      : '';
  const doc = field.description ? `  // ${field.description}` : '';
  return `${name}: ${type}${range}${def}${doc}`;
}
