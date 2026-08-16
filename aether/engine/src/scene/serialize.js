/**
 * Serializing a live world back to a scene document.
 *
 * The round trip matters more than it looks. It is what lets the editor save,
 * what lets `sjl` snapshot a running game into a reproducible test fixture, and
 * what lets an agent make a change through the API and then *read the diff* to
 * confirm the change was what it intended.
 *
 * Fields still at their default are omitted, so a saved scene stays close to
 * what a person would have written by hand.
 */

import { components as globalComponents } from '../core/component.js';

/**
 * @param {import('../core/world.js').World} world
 * @param {object} [options]
 * @param {string} [options.name]
 * @param {object} [options.settings]  carried over from the loaded scene if omitted
 * @param {boolean} [options.includeDefaults=false]
 * @param {boolean} [options.includeRuntime=false] include runtime-computed components
 * @returns {object} a scene document
 */
export function serializeWorld(world, options = {}) {
  const registry = world.componentRegistry ?? globalComponents;
  const source = world.getResource('scene');

  const document = {
    name: options.name ?? source?.name ?? world.name,
    settings: options.settings ?? source?.settings ?? {},
    assets: options.assets ?? source?.assets ?? [],
    prefabs: options.prefabs ?? source?.prefabs ?? {},
    entities: [],
  };

  for (const root of world.roots()) {
    const node = serializeEntity(world, root, registry, options);
    if (node) document.entities.push(node);
  }

  if (Object.keys(document.prefabs).length === 0) delete document.prefabs;
  if (document.assets.length === 0) delete document.assets;
  if (Object.keys(document.settings).length === 0) delete document.settings;

  return document;
}

/**
 * Serialize one entity and its subtree.
 * @returns {object|null} null for entities the engine created internally
 */
export function serializeEntity(world, entity, registry = globalComponents, options = {}) {
  const record = entity.record;
  if (!record) return null;
  // Engine-created holders (the PhysicsSettings carrier, for example) are
  // reconstructed from `settings` on load and would otherwise duplicate.
  if (record.name.startsWith('__')) return null;

  const node = {};
  if (record.sceneId) node.id = record.sceneId;
  node.name = record.name;
  if (record.tags.size) node.tags = [...record.tags];
  if (!record.enabled) node.enabled = false;
  if (record.prefab) node.prefab = record.prefab;

  const componentsOut = {};
  for (const name of world.componentNamesOf(entity.id)) {
    const definition = registry.get(name);
    if (!definition) continue;
    if (definition.runtime && !options.includeRuntime) continue;
    if (name === 'Behaviors') continue;
    componentsOut[name] = definition.serialize(entity.get(name), {
      includeDefaults: options.includeDefaults,
    });
  }
  if (Object.keys(componentsOut).length) node.components = componentsOut;

  const behaviors = entity.get('Behaviors')?.items ?? [];
  if (behaviors.length) {
    node.behaviors = behaviors.map((instance) => {
      const props = instance.definition.serializeProps(instance.props);
      const entry = { type: instance.type, ...props };
      if (!instance.enabled) entry.enabled = false;
      return entry;
    });
  }

  const children = [];
  for (const child of entity.children) {
    const childNode = serializeEntity(world, child, registry, options);
    if (childNode) children.push(childNode);
  }
  if (children.length) node.children = children;

  return node;
}

/**
 * Serialize with stable key ordering and 2-space indent.
 *
 * Deterministic output is the point: two saves of an unchanged scene produce
 * byte-identical files, so a diff shows only real edits.
 */
export function stringifyScene(document, { indent = 2 } = {}) {
  return `${JSON.stringify(document, sceneKeyOrder, indent)}\n`;
}

const KEY_RANK = {
  $schema: 0,
  name: 1,
  settings: 2,
  assets: 3,
  prefabs: 4,
  entities: 5,
  id: 6,
  tags: 7,
  enabled: 8,
  prefab: 9,
  components: 10,
  behaviors: 11,
  children: 12,
};

/**
 * A `JSON.stringify` replacer that reorders object keys.
 *
 * Replacers cannot reorder directly, so this rebuilds each object with its keys
 * sorted by the rank table (known keys first, in document order), then
 * alphabetically for everything else.
 */
function sceneKeyOrder(key, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  keys.sort((a, b) => {
    const ra = KEY_RANK[a] ?? 100;
    const rb = KEY_RANK[b] ?? 100;
    return ra - rb || a.localeCompare(b);
  });
  const out = {};
  for (const k of keys) out[k] = value[k];
  return out;
}
