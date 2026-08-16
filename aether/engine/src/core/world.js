/**
 * The World — the ECS container that holds all game state.
 *
 * Storage is a map of component name -> (entity id -> data). That is not the
 * fastest possible layout (an archetype/SoA engine beats it on raw iteration),
 * but it is the one where `JSON.stringify(world.debugDump())` is readable, a
 * breakpoint shows you real objects, and a query is three lines you can check
 * by eye. For the entity counts this engine targets (thousands, not millions)
 * the difference does not show up in a frame budget, and legibility is the
 * feature we are actually optimizing for.
 *
 * Structural changes (create/destroy/add/remove) made while systems are
 * running are deferred to the end of the current step, so a system can never
 * have an entity vanish out from under its iterator.
 */

import { components as globalComponents } from './component.js';
import { EventBus, EngineEvents } from './events.js';
import { Random } from '../math/random.js';

let nextWorldId = 1;

/**
 * A handle to an entity. Cheap wrapper over an integer id, cached per world so
 * `world.entity(id) === world.entity(id)`, which makes handles safe to use as
 * Map keys and to compare with `===`.
 */
export class Entity {
  /** @param {World} world @param {number} id */
  constructor(world, id) {
    this.world = world;
    this.id = id;
  }

  get record() {
    return this.world.records.get(this.id);
  }

  /** False once destroyed — always check this on a handle you stored. */
  get alive() {
    return this.world.records.has(this.id);
  }

  get name() {
    return this.record?.name ?? '<destroyed>';
  }

  set name(value) {
    const r = this.record;
    if (r) r.name = String(value);
  }

  /** The stable string id from the scene file, if this entity came from one. */
  get sceneId() {
    return this.record?.sceneId ?? null;
  }

  /**
   * Local enabled flag. A disabled entity is skipped by systems, as are all
   * of its descendants — see `activeInHierarchy`.
   */
  get enabled() {
    return this.record?.enabled ?? false;
  }

  set enabled(value) {
    this.world.setEnabled(this.id, value);
  }

  /** True only if this entity and every ancestor is enabled. */
  get activeInHierarchy() {
    let r = this.record;
    while (r) {
      if (!r.enabled) return false;
      if (r.parent == null) return true;
      r = this.world.records.get(r.parent);
    }
    return false;
  }

  get parent() {
    const p = this.record?.parent;
    return p == null ? null : this.world.entity(p);
  }

  /** @returns {Entity[]} */
  get children() {
    const r = this.record;
    if (!r) return [];
    return r.children.map((id) => this.world.entity(id));
  }

  get tags() {
    return this.record?.tags ?? new Set();
  }

  /** @param {string} name @returns {*} the component data, or undefined */
  get(name) {
    return this.world.getComponent(this.id, name);
  }

  /** Like `get`, but throws a helpful error instead of returning undefined. */
  require(name) {
    const data = this.world.getComponent(this.id, name);
    if (data === undefined) {
      throw new Error(
        `Entity "${this.name}" (#${this.id}) has no ${name} component. ` +
          `It has: ${this.componentNames().join(', ') || '(none)'}`,
      );
    }
    return data;
  }

  has(...names) {
    return names.every((n) => this.world.hasComponent(this.id, n));
  }

  hasAny(...names) {
    return names.some((n) => this.world.hasComponent(this.id, n));
  }

  /** @param {string} name @param {object} [values] */
  add(name, values) {
    this.world.addComponent(this.id, name, values);
    return this;
  }

  remove(name) {
    this.world.removeComponent(this.id, name);
    return this;
  }

  /** Shallow-merge `patch` into an existing component's data. */
  set(name, patch) {
    const data = this.require(name);
    Object.assign(data, patch);
    return this;
  }

  componentNames() {
    return this.world.componentNamesOf(this.id);
  }

  addTag(tag) {
    this.world.addTag(this.id, tag);
    return this;
  }

  removeTag(tag) {
    this.record?.tags.delete(tag);
    this.world.tagIndex.get(tag)?.delete(this.id);
    return this;
  }

  hasTag(tag) {
    return this.record?.tags.has(tag) ?? false;
  }

  setParent(parent) {
    this.world.setParent(this.id, parent instanceof Entity ? parent.id : parent);
    return this;
  }

  /** Depth-first search through descendants. */
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }

  findByName(name) {
    return this.find((e) => e.name === name);
  }

  /** All descendants, depth-first, excluding this entity. */
  descendants(out = []) {
    for (const child of this.children) {
      out.push(child);
      child.descendants(out);
    }
    return out;
  }

  destroy() {
    this.world.destroy(this.id);
  }

  toString() {
    return `Entity(#${this.id} "${this.name}")`;
  }

  /** Readable in `console.log` and in test failure output. */
  toJSON() {
    return { id: this.id, name: this.name, components: this.componentNames() };
  }
}

/**
 * @typedef {object} EntityRecord
 * @property {number} id
 * @property {string} name
 * @property {string|null} sceneId
 * @property {Set<string>} tags
 * @property {number|null} parent
 * @property {number[]} children
 * @property {boolean} enabled
 * @property {string|null} prefab   the prefab this was instanced from, if any
 */

export class World {
  /**
   * @param {object} [options]
   * @param {import('./component.js').ComponentRegistry} [options.components]
   * @param {number|string} [options.seed] seed for `world.random`
   * @param {string} [options.name]
   */
  constructor(options = {}) {
    this.worldId = nextWorldId++;
    this.name = options.name ?? `world-${this.worldId}`;
    this.componentRegistry = options.components ?? globalComponents;

    /** @type {Map<number, EntityRecord>} insertion-ordered: iteration is stable */
    this.records = new Map();
    /** @type {Map<string, Map<number, *>>} component name -> entity id -> data */
    this.stores = new Map();
    /** @type {Map<number, Entity>} */
    this.handles = new Map();
    /** @type {Map<string, Set<number>>} */
    this.tagIndex = new Map();
    /** @type {Map<string, number>} scene-file id -> entity id */
    this.sceneIdIndex = new Map();

    this.nextEntityId = 1;
    /** Bumped on every structural change; queries use it to invalidate caches. */
    this.version = 0;

    this.events = new EventBus();
    this.random = new Random(options.seed ?? 'sjl');

    /** Arbitrary shared state — input, assets, renderer, game-specific singletons. */
    this.resources = new Map();

    /** Deferred structural commands, applied by `flush()`. */
    this.deferred = [];
    this.isIterating = 0;
    /**
     * Entities created during the current iteration.
     *
     * Components added to these are applied immediately rather than deferred:
     * a brand-new entity cannot appear in any query snapshot already in flight,
     * so populating it changes nothing for the systems currently running. This
     * is what lets a behavior spawn a fully-formed bullet and set its velocity
     * in the same frame, instead of getting back a detached data object.
     */
    this.freshEntities = new Set();

    /** Simple query result cache, keyed by the component-name signature. */
    this.queryCache = new Map();
  }

  // -------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------

  /**
   * @param {object} [options]
   * @param {string} [options.name]
   * @param {string} [options.sceneId] stable id used by scene files and `findById`
   * @param {string[]} [options.tags]
   * @param {number|Entity|null} [options.parent]
   * @param {boolean} [options.enabled]
   * @param {Record<string, object>} [options.components]
   * @returns {Entity}
   */
  create(options = {}) {
    const id = this.nextEntityId++;
    /** @type {EntityRecord} */
    const record = {
      id,
      name: options.name ?? `Entity${id}`,
      sceneId: options.sceneId ?? null,
      tags: new Set(options.tags ?? []),
      parent: null,
      children: [],
      enabled: options.enabled ?? true,
      prefab: options.prefab ?? null,
    };
    this.records.set(id, record);
    this.version++;
    this.queryCache.clear();
    if (this.isIterating > 0) this.freshEntities.add(id);

    for (const tag of record.tags) {
      this.indexTag(tag, id);
    }
    if (record.sceneId) this.sceneIdIndex.set(record.sceneId, id);

    const entity = this.entity(id);

    if (options.components) {
      for (const [name, values] of Object.entries(options.components)) {
        this.addComponent(id, name, values);
      }
    }
    if (options.parent != null) {
      this.setParent(id, options.parent instanceof Entity ? options.parent.id : options.parent);
    }

    this.events.emit(EngineEvents.ENTITY_CREATED, { entity });
    return entity;
  }

  /** Get (or lazily create) the cached handle for an id. */
  entity(id) {
    let handle = this.handles.get(id);
    if (!handle) {
      handle = new Entity(this, id);
      this.handles.set(id, handle);
    }
    return handle;
  }

  /** @returns {Entity|null} */
  findById(sceneId) {
    const id = this.sceneIdIndex.get(sceneId);
    return id != null && this.records.has(id) ? this.entity(id) : null;
  }

  /** First entity with this name, in creation order. @returns {Entity|null} */
  findByName(name) {
    for (const record of this.records.values()) {
      if (record.name === name) return this.entity(record.id);
    }
    return null;
  }

  /** @returns {Entity[]} */
  findAllByName(name) {
    const out = [];
    for (const record of this.records.values()) {
      if (record.name === name) out.push(this.entity(record.id));
    }
    return out;
  }

  /** @returns {Entity[]} */
  findByTag(tag) {
    const ids = this.tagIndex.get(tag);
    if (!ids) return [];
    const out = [];
    for (const id of ids) {
      if (this.records.has(id)) out.push(this.entity(id));
    }
    return out;
  }

  /** @returns {Entity|null} */
  findFirstByTag(tag) {
    const ids = this.tagIndex.get(tag);
    if (!ids) return null;
    for (const id of ids) {
      if (this.records.has(id)) return this.entity(id);
    }
    return null;
  }

  addTag(id, tag) {
    const record = this.records.get(id);
    if (!record) return;
    record.tags.add(tag);
    this.indexTag(tag, id);
  }

  indexTag(tag, id) {
    let set = this.tagIndex.get(tag);
    if (!set) {
      set = new Set();
      this.tagIndex.set(tag, set);
    }
    set.add(id);
  }

  /**
   * Destroy an entity and all of its descendants.
   *
   * If systems are currently running the destruction is queued and applied by
   * `flush()`, so iteration stays valid. `entity.alive` stays true until then;
   * check it if you hold a handle across a queued destroy.
   */
  destroy(id) {
    const entityId = id instanceof Entity ? id.id : id;
    if (!this.records.has(entityId)) return;
    if (this.isIterating > 0) {
      this.deferred.push({ op: 'destroy', id: entityId });
      return;
    }
    this.destroyImmediate(entityId);
  }

  destroyImmediate(id) {
    const record = this.records.get(id);
    if (!record) return;

    // Depth-first: children go before the parent so their handlers can still
    // read the parent's components.
    for (const childId of record.children.slice()) {
      this.destroyImmediate(childId);
    }

    const entity = this.entity(id);
    for (const [name, store] of this.stores) {
      if (!store.has(id)) continue;
      const data = store.get(id);
      const def = this.componentRegistry.get(name);
      def?.onRemove?.(data, entity, this);
      store.delete(id);
      this.events.emit(EngineEvents.COMPONENT_REMOVED, { entity, component: name, data });
    }

    if (record.parent != null) {
      const parent = this.records.get(record.parent);
      if (parent) {
        const i = parent.children.indexOf(id);
        if (i >= 0) parent.children.splice(i, 1);
      }
    }
    for (const tag of record.tags) {
      this.tagIndex.get(tag)?.delete(id);
    }
    if (record.sceneId && this.sceneIdIndex.get(record.sceneId) === id) {
      this.sceneIdIndex.delete(record.sceneId);
    }

    this.records.delete(id);
    this.version++;
    this.queryCache.clear();
    this.events.emit(EngineEvents.ENTITY_DESTROYED, { entity, id });
    this.handles.delete(id);
  }

  setEnabled(id, enabled) {
    const record = this.records.get(id);
    if (!record || record.enabled === enabled) return;
    record.enabled = enabled;
    this.version++;
    this.events.emit(
      enabled ? EngineEvents.ENTITY_ENABLED : EngineEvents.ENTITY_DISABLED,
      { entity: this.entity(id) },
    );
  }

  /** Re-parent, keeping the hierarchy acyclic. Pass `null` to detach. */
  setParent(id, parentId) {
    const record = this.records.get(id);
    if (!record) return;
    if (parentId === id) throw new Error(`Cannot parent entity #${id} to itself`);

    if (parentId != null && this.isDescendantOf(parentId, id)) {
      throw new Error(
        `Cannot parent #${id} ("${record.name}") to its own descendant #${parentId} — ` +
          'that would create a cycle in the scene graph',
      );
    }

    if (record.parent != null) {
      const old = this.records.get(record.parent);
      if (old) {
        const i = old.children.indexOf(id);
        if (i >= 0) old.children.splice(i, 1);
      }
    }
    record.parent = parentId ?? null;
    if (parentId != null) {
      const parent = this.records.get(parentId);
      if (!parent) throw new Error(`Cannot parent #${id} to #${parentId}: no such entity`);
      parent.children.push(id);
    }
    this.version++;
  }

  isDescendantOf(id, ancestorId) {
    let current = this.records.get(id);
    while (current && current.parent != null) {
      if (current.parent === ancestorId) return true;
      current = this.records.get(current.parent);
    }
    return false;
  }

  /** Entities with no parent, in creation order. @returns {Entity[]} */
  roots() {
    const out = [];
    for (const record of this.records.values()) {
      if (record.parent == null) out.push(this.entity(record.id));
    }
    return out;
  }

  get entityCount() {
    return this.records.size;
  }

  // -------------------------------------------------------------------------
  // Components
  // -------------------------------------------------------------------------

  store(name) {
    let s = this.stores.get(name);
    if (!s) {
      s = new Map();
      this.stores.set(name, s);
    }
    return s;
  }

  /**
   * @param {number} id
   * @param {string} name
   * @param {object} [values] authored values, layered over the schema defaults
   */
  addComponent(id, name, values) {
    if (this.isIterating > 0 && !this.freshEntities.has(id)) {
      this.deferred.push({ op: 'add', id, name, values });
      // The returned data is a detached copy — the real one is created at flush
      // time. Callers that need the live object should be adding to an entity
      // they just created, which takes the immediate path below.
      return this.componentRegistry.require(name).create(values);
    }
    const def = this.componentRegistry.require(name);
    const record = this.records.get(id);
    if (!record) throw new Error(`Cannot add ${name} to #${id}: no such entity`);

    if (def.singleton) {
      const store = this.store(name);
      if (store.size > 0 && !store.has(id)) {
        const holder = [...store.keys()][0];
        throw new Error(
          `${name} is a singleton component but entity #${holder} already has one. ` +
            'Remove it first, or use `world.singleton(name)` to read the existing one.',
        );
      }
    }

    for (const req of def.requires) {
      if (!this.hasComponent(id, req)) this.addComponent(id, req, undefined);
    }

    const data = def.create(values);
    this.store(name).set(id, data);
    this.version++;
    this.queryCache.clear();

    const entity = this.entity(id);
    def.onAdd?.(data, entity, this);
    this.events.emit(EngineEvents.COMPONENT_ADDED, { entity, component: name, data });
    return data;
  }

  removeComponent(id, name) {
    if (this.isIterating > 0) {
      this.deferred.push({ op: 'remove', id, name });
      return;
    }
    const store = this.stores.get(name);
    if (!store || !store.has(id)) return;
    const data = store.get(id);
    const entity = this.entity(id);
    this.componentRegistry.get(name)?.onRemove?.(data, entity, this);
    store.delete(id);
    this.version++;
    this.queryCache.clear();
    this.events.emit(EngineEvents.COMPONENT_REMOVED, { entity, component: name, data });
  }

  /**
   * Get a component, creating it immediately if absent — even mid-iteration.
   *
   * This bypasses the deferral queue on purpose, and is only for `runtime`
   * components that a system computes for itself (WorldTransform, and the like).
   * Those are invisible to scene files and to gameplay code, so materializing
   * one during iteration cannot surprise another system: nothing was querying
   * for a component that did not exist a moment ago.
   *
   * For anything a game touches, use `addComponent`.
   */
  ensureComponent(id, name, values) {
    const store = this.store(name);
    let data = store.get(id);
    if (data !== undefined) return data;
    const def = this.componentRegistry.require(name);
    data = def.create(values);
    store.set(id, data);
    this.version++;
    this.queryCache.clear();
    def.onAdd?.(data, this.entity(id), this);
    return data;
  }

  getComponent(id, name) {
    return this.stores.get(name)?.get(id);
  }

  hasComponent(id, name) {
    return this.stores.get(name)?.has(id) ?? false;
  }

  componentNamesOf(id) {
    const out = [];
    for (const [name, store] of this.stores) {
      if (store.has(id)) out.push(name);
    }
    return out;
  }

  /** The single instance of a singleton component, or undefined. */
  singleton(name) {
    const store = this.stores.get(name);
    if (!store || store.size === 0) return undefined;
    return store.values().next().value;
  }

  /** The entity holding a singleton component. @returns {Entity|null} */
  singletonEntity(name) {
    const store = this.stores.get(name);
    if (!store || store.size === 0) return null;
    return this.entity(store.keys().next().value);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Iterate every entity that has all of `names`.
   *
   * Disabled entities (and children of disabled entities) are skipped by
   * default, matching what game code almost always wants. Pass
   * `{ includeDisabled: true }` for editor and tooling passes.
   *
   * The returned array is a snapshot, so it is safe to create and destroy
   * entities while looping over it.
   *
   * @param {...string} names
   * @returns {Entity[]}
   */
  query(...names) {
    let options = {};
    if (names.length && typeof names[names.length - 1] === 'object') {
      options = names.pop();
    }
    const key = `${names.join('|')}#${options.includeDisabled ? 'all' : 'active'}`;
    const cached = this.queryCache.get(key);
    if (cached && cached.version === this.version) return cached.result;

    const result = [];
    if (names.length === 0) {
      for (const record of this.records.values()) {
        const entity = this.entity(record.id);
        if (options.includeDisabled || entity.activeInHierarchy) result.push(entity);
      }
    } else {
      // Drive the loop from the smallest store so the inner checks run as few
      // times as possible.
      let smallest = null;
      for (const name of names) {
        const store = this.stores.get(name);
        if (!store) return this.cacheQuery(key, []);
        if (!smallest || store.size < smallest.size) smallest = store;
      }
      outer: for (const id of smallest.keys()) {
        for (const name of names) {
          if (!this.stores.get(name).has(id)) continue outer;
        }
        const entity = this.entity(id);
        if (!options.includeDisabled && !entity.activeInHierarchy) continue;
        result.push(entity);
      }
    }
    return this.cacheQuery(key, result);
  }

  cacheQuery(key, result) {
    this.queryCache.set(key, { version: this.version, result });
    return result;
  }

  /**
   * Query, but yields `[entity, ...componentData]` tuples so a system body
   * does not repeat `entity.get('Transform')` for each component.
   *
   * @example
   * for (const [entity, transform, sprite] of world.each('Transform', 'Sprite')) { ... }
   */
  *each(...names) {
    const list = this.query(...names);
    const plain = names.filter((n) => typeof n === 'string');
    for (const entity of list) {
      const tuple = [entity];
      for (const name of plain) tuple.push(this.stores.get(name).get(entity.id));
      yield tuple;
    }
  }

  /** First match, or null. */
  first(...names) {
    return this.query(...names)[0] ?? null;
  }

  count(...names) {
    return this.query(...names).length;
  }

  // -------------------------------------------------------------------------
  // Deferred structural changes
  // -------------------------------------------------------------------------

  /** Mark the start of a region where structural changes must be deferred. */
  beginIteration() {
    this.isIterating++;
  }

  endIteration() {
    this.isIterating = Math.max(0, this.isIterating - 1);
    if (this.isIterating === 0) {
      this.flush();
      this.freshEntities.clear();
    }
  }

  /** Apply everything queued while systems were running. */
  flush() {
    if (this.deferred.length === 0) return 0;
    const batch = this.deferred;
    this.deferred = [];
    for (const cmd of batch) {
      switch (cmd.op) {
        case 'destroy':
          this.destroyImmediate(cmd.id);
          break;
        case 'add':
          if (this.records.has(cmd.id)) this.addComponent(cmd.id, cmd.name, cmd.values);
          break;
        case 'remove':
          if (this.records.has(cmd.id)) this.removeComponent(cmd.id, cmd.name);
          break;
      }
    }
    return batch.length;
  }

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  setResource(key, value) {
    this.resources.set(key, value);
    return value;
  }

  getResource(key) {
    return this.resources.get(key);
  }

  requireResource(key) {
    const r = this.resources.get(key);
    if (r === undefined) {
      throw new Error(
        `Missing resource "${key}". Available: ${[...this.resources.keys()].join(', ') || '(none)'}`,
      );
    }
    return r;
  }

  // -------------------------------------------------------------------------
  // Debug / inspection
  // -------------------------------------------------------------------------

  /**
   * A plain-object snapshot of the whole world.
   *
   * This exists specifically for agents and tests: `JSON.stringify` it, diff
   * two frames, or assert on a subtree. It is the fastest way to answer "what
   * is actually in the scene right now" without a renderer.
   */
  debugDump(options = {}) {
    const entities = [];
    for (const record of this.records.values()) {
      const entry = {
        id: record.id,
        name: record.name,
        enabled: record.enabled,
        components: {},
      };
      if (record.sceneId) entry.sceneId = record.sceneId;
      if (record.tags.size) entry.tags = [...record.tags];
      if (record.parent != null) entry.parent = record.parent;
      if (record.children.length) entry.children = record.children.slice();
      for (const [name, store] of this.stores) {
        if (!store.has(record.id)) continue;
        const def = this.componentRegistry.get(name);
        const data = store.get(record.id);
        entry.components[name] = def
          ? def.serialize(data, { includeDefaults: options.includeDefaults })
          : data;
      }
      entities.push(entry);
    }
    return {
      world: this.name,
      entityCount: this.records.size,
      version: this.version,
      entities,
    };
  }

  /** An indented tree of the scene graph. Cheap to eyeball in a terminal. */
  debugTree() {
    const lines = [];
    const walk = (entity, depth) => {
      const record = entity.record;
      const flags = [];
      if (!record.enabled) flags.push('disabled');
      if (record.tags.size) flags.push([...record.tags].map((t) => `#${t}`).join(' '));
      const comps = this.componentNamesOf(entity.id).join(', ');
      lines.push(
        `${'  '.repeat(depth)}${record.name} (#${record.id})` +
          (flags.length ? ` [${flags.join(' ')}]` : '') +
          (comps ? ` {${comps}}` : ''),
      );
      for (const child of entity.children) walk(child, depth + 1);
    };
    for (const root of this.roots()) walk(root, 0);
    return lines.join('\n');
  }

  /** Remove every entity, leaving resources and event handlers in place. */
  clear() {
    for (const id of [...this.records.keys()]) this.destroyImmediate(id);
    this.stores.clear();
    this.tagIndex.clear();
    this.sceneIdIndex.clear();
    this.handles.clear();
    this.queryCache.clear();
    this.deferred.length = 0;
    this.version++;
  }
}
