/**
 * Component definitions and the global component registry.
 *
 * A component is pure data plus a schema. It never contains behavior — that
 * lives in systems (engine-owned, operating over queries) and behaviors
 * (game-owned, attached per entity). Keeping data and logic apart is what makes
 * a scene file a complete description of the game state.
 */

import {
  instantiate,
  serializeObject,
  validateObject,
  schemaToJSONSchema,
  describeField,
  closestMatch,
} from './schema.js';

/**
 * @typedef {object} ComponentDefinition
 * @property {string} name                     Unique, PascalCase, used as the key in scene JSON.
 * @property {Record<string, import('./schema.js').Field>} schema
 * @property {string} [description]
 * @property {string} [category]               Groups the component in the editor's add menu.
 * @property {string[]} [requires]             Components auto-added alongside this one.
 * @property {boolean} [singleton]             At most one per world (e.g. `Physics2DSettings`).
 * @property {boolean} [runtime]               Computed by a system; never written to scene files.
 * @property {(data: *, entity: *, world: *) => void} [onAdd]
 * @property {(data: *, entity: *, world: *) => void} [onRemove]
 */

export class Component {
  /** @param {ComponentDefinition} def */
  constructor(def) {
    if (!def.name || typeof def.name !== 'string') {
      throw new Error('defineComponent: `name` is required and must be a string');
    }
    if (!/^[A-Z][A-Za-z0-9]*$/.test(def.name)) {
      throw new Error(
        `defineComponent: "${def.name}" must be PascalCase (letters and digits only) ` +
          'so that it can be used verbatim as a scene-file key',
      );
    }
    this.name = def.name;
    this.schema = def.schema ?? {};
    this.description = def.description ?? '';
    this.category = def.category ?? 'General';
    this.requires = def.requires ?? [];
    this.singleton = def.singleton ?? false;
    this.runtime = def.runtime ?? false;
    this.onAdd = def.onAdd ?? null;
    this.onRemove = def.onRemove ?? null;
  }

  /** Fresh data for this component, with `values` layered over the defaults. */
  create(values) {
    return instantiate(this.schema, values ?? {});
  }

  /** Back to scene JSON, omitting anything still at its default. */
  serialize(data, options) {
    return serializeObject(this.schema, data, options);
  }

  /** @returns {import('./schema.js').Issue[]} */
  validate(data, path = this.name) {
    return validateObject(this.schema, data, path, []);
  }

  toJSONSchema() {
    const s = schemaToJSONSchema(this.schema);
    if (this.description) s.description = this.description;
    return s;
  }

  /** The form used by `sjl describe` and the docs generator. */
  describe() {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      requires: this.requires,
      singleton: this.singleton,
      runtime: this.runtime,
      fields: Object.entries(this.schema).map(([name, field]) => ({
        name,
        type: field.type,
        default: field.default,
        description: field.description ?? '',
        ...(field.values ? { values: field.values } : {}),
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        ...(field.assetType ? { assetType: field.assetType } : {}),
      })),
      signature: Object.entries(this.schema).map(([n, f]) => describeField(n, f)),
    };
  }
}

/**
 * A registry of component definitions.
 *
 * There is one global instance (`components`), but the class is exported so
 * that tests can build an isolated registry and not leak definitions between
 * cases.
 */
export class ComponentRegistry {
  constructor() {
    /** @type {Map<string, Component>} */
    this.definitions = new Map();
  }

  /** @param {ComponentDefinition} def @returns {Component} */
  define(def) {
    const component = new Component(def);
    const existing = this.definitions.get(component.name);
    if (existing) {
      throw new Error(
        `Component "${component.name}" is already defined. ` +
          'Component names are global; pick a distinct name or call `redefine` if this is a hot reload.',
      );
    }
    this.definitions.set(component.name, component);
    return component;
  }

  /** Replace a definition. Only for hot reload — existing instances keep their data. */
  redefine(def) {
    const component = new Component(def);
    this.definitions.set(component.name, component);
    return component;
  }

  /** @returns {Component|undefined} */
  get(name) {
    return this.definitions.get(name);
  }

  /**
   * Like `get`, but throws with a typo suggestion. Used on every scene-load
   * path so a misspelled component name fails loudly and helpfully.
   */
  require(name) {
    const found = this.definitions.get(name);
    if (found) return found;
    const suggestion = closestMatch(name, [...this.definitions.keys()]);
    throw new Error(
      `Unknown component "${name}".` +
        (suggestion ? ` Did you mean "${suggestion}"?` : '') +
        `\nRegistered components: ${[...this.definitions.keys()].sort().join(', ')}`,
    );
  }

  has(name) {
    return this.definitions.has(name);
  }

  names() {
    return [...this.definitions.keys()].sort();
  }

  all() {
    return [...this.definitions.values()];
  }

  clear() {
    this.definitions.clear();
  }

  describe() {
    return this.all()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.describe());
  }
}

/** The registry the engine and all games share. */
export const components = new ComponentRegistry();

/**
 * Define a component on the global registry.
 *
 * @example
 * defineComponent({
 *   name: 'Health',
 *   description: 'Hit points, with a max for UI bars.',
 *   schema: {
 *     current: { type: 'number', default: 100, min: 0 },
 *     max:     { type: 'number', default: 100, min: 1 },
 *   },
 * });
 *
 * @param {ComponentDefinition} def
 */
export function defineComponent(def) {
  return components.define(def);
}
