/**
 * Scenes.
 *
 * A scene is a JSON document that fully describes a level: its settings, its
 * assets, its prefabs and its entity tree. Nothing about a scene lives in code,
 * which is the single most important property of this engine for AI-assisted
 * work — an agent can author, read back, diff and validate an entire level as
 * text, and `sjl validate` will tell it precisely what is wrong before the game
 * ever runs.
 *
 * ```json
 * {
 *   "name": "level-1",
 *   "settings": { "gravity": [0, -20], "seed": "level-1" },
 *   "assets": [{ "id": "hero", "type": "texture", "src": "hero.png" }],
 *   "prefabs": {
 *     "Coin": {
 *       "components": {
 *         "Transform": {},
 *         "ShapeRenderer": { "shape": "circle", "size": [0.4, 0.4], "color": "#ffd166" },
 *         "CircleCollider": { "radius": 0.2, "isTrigger": true }
 *       }
 *     }
 *   },
 *   "entities": [
 *     {
 *       "id": "player",
 *       "name": "Player",
 *       "tags": ["player"],
 *       "components": {
 *         "Transform": { "position": [0, 2] },
 *         "Sprite": { "texture": "hero", "size": [1, 1] },
 *         "Rigidbody": { "type": "dynamic", "freezeRotation": true },
 *         "BoxCollider": { "size": [0.8, 1] }
 *       },
 *       "behaviors": [{ "type": "PlatformerController", "speed": 6 }]
 *     },
 *     { "prefab": "Coin", "components": { "Transform": { "position": [3, 1] } } }
 *   ]
 * }
 * ```
 */

import { components as globalComponents } from '../core/component.js';
import { behaviors as globalBehaviors, BehaviorInstance } from '../core/behavior.js';
import { EngineEvents } from '../core/events.js';
import { Random } from '../math/random.js';
import { validateScene } from './validate.js';

/** Keys allowed on an entity node. Anything else is a typo and is reported. */
export const ENTITY_KEYS = [
  'id', 'name', 'tags', 'enabled', 'prefab', 'components', 'behaviors', 'children',
];

/** Keys allowed at the top level of a scene document. */
export const SCENE_KEYS = ['$schema', 'name', 'settings', 'assets', 'prefabs', 'entities'];

export class Scene {
  /** @param {object} document the parsed JSON */
  constructor(document = {}) {
    this.name = document.name ?? 'untitled';
    this.settings = document.settings ?? {};
    this.assets = document.assets ?? [];
    this.prefabs = document.prefabs ?? {};
    this.entities = document.entities ?? [];
    this.source = document;
  }

  /**
   * Parse and validate in one step.
   * @param {object|string} input JSON text or an already-parsed object
   * @param {object} [options]
   * @param {boolean} [options.strict=true] throw on validation errors
   */
  static parse(input, options = {}) {
    let document;
    if (typeof input === 'string') {
      try {
        document = JSON.parse(input);
      } catch (error) {
        throw new Error(`Scene is not valid JSON: ${error.message}`);
      }
    } else {
      document = input;
    }

    const issues = validateScene(document, options);
    const errors = issues.filter((i) => i.severity !== 'warning');
    if (errors.length && options.strict !== false) {
      throw new SceneValidationError(document.name ?? 'scene', issues);
    }
    const scene = new Scene(document);
    scene.issues = issues;
    return scene;
  }

  /** Prefab definition by name, or undefined. */
  prefab(name) {
    return this.prefabs[name];
  }

  /** Asset descriptor by id, or undefined. */
  asset(id) {
    return this.assets.find((a) => a.id === id);
  }

  toJSON() {
    return {
      name: this.name,
      settings: this.settings,
      assets: this.assets,
      prefabs: this.prefabs,
      entities: this.entities,
    };
  }
}

/** Carries structured issues so a CLI or an agent can act on them. */
export class SceneValidationError extends Error {
  constructor(sceneName, issues) {
    const errors = issues.filter((i) => i.severity !== 'warning');
    super(
      `Scene "${sceneName}" has ${errors.length} error${errors.length === 1 ? '' : 's'}:\n` +
        errors.map((i) => `  ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'SceneValidationError';
    this.sceneName = sceneName;
    this.issues = issues;
  }
}

/**
 * Instantiate a scene into a world.
 *
 * The world is cleared first: loading a scene means *this scene is now the
 * game*, not "add these entities to whatever was there". Use `instantiate` for
 * additive spawning.
 *
 * @param {import('../core/world.js').World} world
 * @param {Scene|object} scene
 * @param {object} [options]
 * @param {import('../core/component.js').ComponentRegistry} [options.components]
 * @param {import('../core/behavior.js').BehaviorRegistry} [options.behaviors]
 * @param {boolean} [options.additive=false] keep existing entities
 * @returns {import('../core/world.js').Entity[]} the root entities created
 */
export function loadScene(world, scene, options = {}) {
  const parsed = scene instanceof Scene ? scene : Scene.parse(scene, options);

  if (!options.additive) {
    world.clear();
    world.getResource('physics')?.reset();
  }

  // A scene-declared seed makes the whole run reproducible: same file, same
  // randomness, same outcome, every time.
  if (parsed.settings.seed !== undefined) {
    world.random = new Random(parsed.settings.seed);
  }

  applySettings(world, parsed.settings);

  const context = {
    world,
    scene: parsed,
    components: options.components ?? world.componentRegistry ?? globalComponents,
    behaviors: options.behaviors ?? globalBehaviors,
    prefabDepth: 0,
  };

  const roots = [];
  for (const node of parsed.entities) {
    roots.push(instantiateNode(context, node, null));
  }

  world.setResource('scene', parsed);
  world.events.emit(EngineEvents.SCENE_LOADED, { scene: parsed, name: parsed.name });
  return roots;
}

/**
 * Spawn a single entity (or prefab instance) into a live world.
 *
 * @example
 * // Fire a bullet from a behavior:
 * instantiate(world, { prefab: 'Bullet', components: { Transform: { position: [x, y] } } });
 *
 * @param {import('../core/world.js').World} world
 * @param {object} node an entity node, same shape as in a scene file
 * @param {object} [options]
 * @param {*} [options.parent] parent entity or id
 * @returns {import('../core/world.js').Entity}
 */
export function instantiate(world, node, options = {}) {
  const scene = options.scene ?? world.getResource('scene') ?? new Scene({});
  const context = {
    world,
    scene,
    components: options.components ?? world.componentRegistry ?? globalComponents,
    behaviors: options.behaviors ?? globalBehaviors,
    prefabDepth: 0,
  };
  const parentId = options.parent?.id ?? options.parent ?? null;
  return instantiateNode(context, node, parentId);
}

/**
 * Physics and camera defaults declared in `settings`.
 *
 * `gravity` is a vec2 and feeds the 2D solver; `gravity3d` is a vec3 and feeds
 * the 3D one. Keeping them separate means a scene that mixes a 3D world with a
 * 2D HUD cannot accidentally apply one world's gravity to the other.
 */
function applySettings(world, settings) {
  const physics = { ...(settings.physics ?? {}) };
  if (settings.gravity !== undefined) physics.gravity = settings.gravity;

  if (Object.keys(physics).length > 0) {
    const holder = world.create({ name: '__PhysicsSettings' });
    world.addComponent(holder.id, 'PhysicsSettings', physics);
  }

  const physics3d = { ...(settings.physics3d ?? {}) };
  if (settings.gravity3d !== undefined) physics3d.gravity = settings.gravity3d;

  if (Object.keys(physics3d).length > 0) {
    const holder = world.create({ name: '__Physics3DSettings' });
    world.addComponent(holder.id, 'Physics3DSettings', physics3d);
  }

  if (settings.skybox) {
    const holder = world.create({ name: '__Skybox' });
    world.addComponent(holder.id, 'Skybox', settings.skybox);
  }

  if (settings.timeScale !== undefined) {
    world.setResource('timeScale', settings.timeScale);
  }
}

const MAX_PREFAB_DEPTH = 16;

/**
 * Create one entity node and its children.
 * @returns {import('../core/world.js').Entity}
 */
function instantiateNode(context, node, parentId) {
  const { world } = context;

  if (typeof node !== 'object' || node === null) {
    throw new Error(`Scene entity must be an object, got ${typeof node}`);
  }

  // Merge the prefab underneath the node's own values, so a node overrides only
  // what it mentions and inherits everything else.
  let resolved = node;
  if (node.prefab) {
    if (context.prefabDepth >= MAX_PREFAB_DEPTH) {
      throw new Error(
        `Prefab nesting exceeded ${MAX_PREFAB_DEPTH} levels at "${node.prefab}". ` +
          'This usually means a prefab references itself.',
      );
    }
    const prefab = context.scene.prefabs?.[node.prefab];
    if (!prefab) {
      const available = Object.keys(context.scene.prefabs ?? {});
      throw new Error(
        `Unknown prefab "${node.prefab}". Defined prefabs: ${available.join(', ') || '(none)'}`,
      );
    }
    context.prefabDepth++;
    resolved = mergePrefab(prefab, node);
  }

  const entity = world.create({
    name: resolved.name ?? node.prefab ?? 'Entity',
    sceneId: resolved.id ?? null,
    tags: resolved.tags ?? [],
    enabled: resolved.enabled ?? true,
    prefab: node.prefab ?? null,
  });

  if (parentId != null) world.setParent(entity.id, parentId);

  for (const [name, values] of Object.entries(resolved.components ?? {})) {
    world.addComponent(entity.id, name, values);
  }

  if (resolved.behaviors?.length) {
    attachBehaviors(context, entity, resolved.behaviors);
  }

  for (const child of resolved.children ?? []) {
    instantiateNode(context, child, entity.id);
  }

  if (node.prefab) context.prefabDepth--;
  return entity;
}

/**
 * Layer an instance node over a prefab definition.
 *
 * Components merge per-component and per-field, so `{"Transform": {"position": [3, 1]}}`
 * on the instance keeps the prefab's rotation and scale. That is what makes a
 * prefab worth having: the instance says only what differs.
 */
export function mergePrefab(prefab, node) {
  const merged = {
    name: node.name ?? prefab.name,
    id: node.id ?? prefab.id,
    tags: [...new Set([...(prefab.tags ?? []), ...(node.tags ?? [])])],
    enabled: node.enabled ?? prefab.enabled ?? true,
    components: {},
    behaviors: [],
    children: node.children ?? prefab.children ?? [],
  };

  for (const [name, values] of Object.entries(prefab.components ?? {})) {
    merged.components[name] = { ...values };
  }
  for (const [name, values] of Object.entries(node.components ?? {})) {
    merged.components[name] = { ...(merged.components[name] ?? {}), ...values };
  }

  // Behaviors merge by type: an instance re-declaring a behavior overrides its
  // props rather than attaching a second copy.
  const byType = new Map();
  for (const behavior of prefab.behaviors ?? []) {
    byType.set(behavior.type, { ...behavior });
  }
  for (const behavior of node.behaviors ?? []) {
    const existing = byType.get(behavior.type);
    byType.set(behavior.type, existing ? { ...existing, ...behavior } : { ...behavior });
  }
  merged.behaviors = [...byType.values()];

  return merged;
}

/**
 * Attach behavior instances to an entity.
 *
 * Entries accept both shapes:
 *   `{ "type": "Patrol", "props": { "speed": 3 } }`
 *   `{ "type": "Patrol", "speed": 3 }`
 * The flat form is what people write; the nested form is what a generator
 * emits. Supporting both costs three lines and removes a whole class of
 * "why are my props all defaults" confusion.
 */
export function attachBehaviors(context, entity, list) {
  const { world } = context;
  // `ensureComponent` rather than `addComponent`: this must return the live
  // component even when a behavior is spawning entities mid-iteration.
  const data = world.ensureComponent(entity.id, 'Behaviors');
  if (!Array.isArray(data.items)) data.items = [];

  for (const entry of list) {
    if (!entry?.type) {
      throw new Error(
        `Entity "${entity.name}" has a behavior entry with no "type". ` +
          `Got: ${JSON.stringify(entry)}`,
      );
    }
    const definition = context.behaviors.require(entry.type);

    const rawProps = entry.props ?? extractFlatProps(entry);
    const props = definition.createProps(rawProps);

    for (const required of definition.requires) {
      if (!world.hasComponent(entity.id, required)) {
        world.addComponent(entity.id, required, undefined);
      }
    }

    const instance = new BehaviorInstance(definition, entity, props);
    if (entry.enabled === false) instance.enabled = false;
    data.items.push(instance);
  }
  return data.items;
}

function extractFlatProps(entry) {
  const props = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'type' || key === 'enabled' || key === 'props') continue;
    props[key] = value;
  }
  return props;
}

/**
 * Attach a behavior to an existing entity at runtime.
 * @example addBehavior(entity, 'Patrol', { speed: 3 });
 */
export function addBehavior(entity, type, props = {}) {
  const world = entity.world;
  const definition = globalBehaviors.require(type);
  const data = world.ensureComponent(entity.id, 'Behaviors');
  if (!Array.isArray(data.items)) data.items = [];

  for (const required of definition.requires) {
    if (!world.hasComponent(entity.id, required)) world.addComponent(entity.id, required, undefined);
  }
  const instance = new BehaviorInstance(definition, entity, definition.createProps(props));
  data.items.push(instance);
  return instance;
}

/** Find an attached behavior instance by type. */
export function getBehavior(entity, type) {
  return entity.get('Behaviors')?.items?.find((i) => i.type === type) ?? null;
}

/** Detach a behavior, firing its `onDestroy` hook. */
export function removeBehavior(entity, type) {
  const data = entity.get('Behaviors');
  if (!data?.items) return false;
  const index = data.items.findIndex((i) => i.type === type);
  if (index < 0) return false;
  const [instance] = data.items.splice(index, 1);
  instance.destroyed = true;
  instance.invoke('onDestroy', {});
  return true;
}
