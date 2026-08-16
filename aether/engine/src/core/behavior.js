/**
 * Behaviors — per-entity game logic.
 *
 * This is the engine's answer to Unity's MonoBehaviour or Unreal's ActorComponent,
 * with two deliberate differences:
 *
 *   1. Props are schema-declared, exactly like component fields. A behavior is
 *      therefore configurable from scene JSON, validated before it runs, shown
 *      in the inspector, and listed by `sjl describe` — without the author
 *      writing any glue.
 *   2. Hooks receive one explicit `ctx` object rather than relying on inherited
 *      `this`. Everything a hook can touch is visible in its parameter list,
 *      which is what makes behavior code readable in isolation — for a person
 *      reviewing a diff, or for a model that only has the one function in view.
 *
 * @example
 * defineBehavior({
 *   name: 'Patrol',
 *   description: 'Walks back and forth between two x positions.',
 *   props: {
 *     left:  { type: 'number', default: -5 },
 *     right: { type: 'number', default:  5 },
 *     speed: { type: 'number', default:  2, min: 0 },
 *   },
 *   onFixedUpdate({ entity, props, state, dt }) {
 *     const t = entity.require('Transform');
 *     state.dir ??= 1;
 *     t.position.x += props.speed * state.dir * dt;
 *     if (t.position.x > props.right) state.dir = -1;
 *     if (t.position.x < props.left)  state.dir =  1;
 *   },
 * });
 */

import { instantiate, serializeObject, validateObject, describeField, closestMatch } from './schema.js';

/** Hook names, in the order they fire over an instance's lifetime. */
export const BEHAVIOR_HOOKS = [
  'onAwake',
  'onStart',
  'onEnable',
  'onUpdate',
  'onFixedUpdate',
  'onLateUpdate',
  'onCollisionEnter',
  'onCollisionStay',
  'onCollisionExit',
  'onTriggerEnter',
  'onTriggerStay',
  'onTriggerExit',
  'onDisable',
  'onDestroy',
];

/**
 * @typedef {object} BehaviorDefinition
 * @property {string} name
 * @property {string} [description]
 * @property {Record<string, import('./schema.js').Field>} [props]
 * @property {string[]} [requires]  components the entity must have; auto-added
 * @property {(ctx: BehaviorContext) => void} [onAwake]   after attach, before first start
 * @property {(ctx: BehaviorContext) => void} [onStart]   once, before the first update
 * @property {(ctx: BehaviorContext) => void} [onEnable]
 * @property {(ctx: BehaviorContext) => void} [onUpdate]      variable dt
 * @property {(ctx: BehaviorContext) => void} [onFixedUpdate] fixed dt — put gameplay here
 * @property {(ctx: BehaviorContext) => void} [onLateUpdate]
 * @property {(ctx: CollisionContext) => void} [onCollisionEnter]
 * @property {(ctx: CollisionContext) => void} [onCollisionStay]
 * @property {(ctx: CollisionContext) => void} [onCollisionExit]
 * @property {(ctx: CollisionContext) => void} [onTriggerEnter]
 * @property {(ctx: CollisionContext) => void} [onTriggerStay]
 * @property {(ctx: CollisionContext) => void} [onTriggerExit]
 * @property {(ctx: BehaviorContext) => void} [onDisable]
 * @property {(ctx: BehaviorContext) => void} [onDestroy]
 */

/**
 * @typedef {object} BehaviorContext
 * @property {import('./world.js').Entity} entity
 * @property {import('./world.js').World} world
 * @property {object} props   schema-validated, from the scene file
 * @property {object} state   free-form scratch space, persists across frames
 * @property {import('./time.js').Time} time
 * @property {number} dt
 * @property {*} app
 * @property {BehaviorInstance} self
 */

/**
 * @typedef {BehaviorContext & { other: import('./world.js').Entity, normal?: object, depth?: number }} CollisionContext
 */

export class Behavior {
  /** @param {BehaviorDefinition} def */
  constructor(def) {
    if (!def.name) throw new Error('defineBehavior: `name` is required');
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(def.name)) {
      throw new Error(`defineBehavior: "${def.name}" must be a valid identifier`);
    }
    this.name = def.name;
    this.description = def.description ?? '';
    this.props = def.props ?? {};
    this.requires = def.requires ?? [];

    // Reject typo'd hook names loudly. A silently-never-called `onUpate` is a
    // genuinely hard bug to spot, and it is trivial to catch here.
    for (const key of Object.keys(def)) {
      if (['name', 'description', 'props', 'requires'].includes(key)) continue;
      if (BEHAVIOR_HOOKS.includes(key)) continue;
      const suggestion = closestMatch(key, BEHAVIOR_HOOKS);
      throw new Error(
        `Behavior "${def.name}": unknown key "${key}".` +
          (suggestion ? ` Did you mean "${suggestion}"?` : '') +
          `\nValid hooks: ${BEHAVIOR_HOOKS.join(', ')}`,
      );
    }

    for (const hook of BEHAVIOR_HOOKS) {
      this[hook] = typeof def[hook] === 'function' ? def[hook] : null;
    }
    /** Precomputed so the script system can skip behaviors with no such hook. */
    this.hooks = BEHAVIOR_HOOKS.filter((h) => this[h] !== null);
  }

  createProps(values) {
    return instantiate(this.props, values ?? {});
  }

  validateProps(values, path = this.name) {
    return validateObject(this.props, values ?? {}, path, []);
  }

  serializeProps(values) {
    return serializeObject(this.props, values ?? {});
  }

  describe() {
    return {
      name: this.name,
      description: this.description,
      requires: this.requires,
      hooks: this.hooks,
      props: Object.entries(this.props).map(([name, field]) => ({
        name,
        type: field.type,
        default: field.default,
        description: field.description ?? '',
        ...(field.values ? { values: field.values } : {}),
      })),
      signature: Object.entries(this.props).map(([n, f]) => describeField(n, f)),
    };
  }
}

/** One behavior attached to one entity. */
export class BehaviorInstance {
  /**
   * @param {Behavior} definition
   * @param {import('./world.js').Entity} entity
   * @param {object} props
   */
  constructor(definition, entity, props) {
    this.definition = definition;
    this.type = definition.name;
    this.entity = entity;
    this.world = entity.world;
    this.props = props;
    /** Free-form per-instance state. Not serialized unless the game does it. */
    this.state = {};
    this.enabled = true;
    this.started = false;
    this.awoken = false;
    this.destroyed = false;
  }

  /** Build the ctx passed to hooks. */
  context(extra) {
    return {
      entity: this.entity,
      world: this.world,
      props: this.props,
      state: this.state,
      self: this,
      ...extra,
    };
  }

  /**
   * Invoke a hook. Errors are caught and rethrown with the behavior, entity and
   * hook attached, because a bare "Cannot read properties of undefined" from
   * eight frames deep in a scheduler is close to useless.
   */
  invoke(hook, extra) {
    const fn = this.definition[hook];
    if (!fn) return;
    try {
      fn.call(this, this.context(extra));
    } catch (error) {
      const wrapped = new Error(
        `${this.type}.${hook} threw on entity "${this.entity.name}" (#${this.entity.id}): ${error.message}`,
        { cause: error },
      );
      wrapped.behavior = this.type;
      wrapped.hook = hook;
      wrapped.entityId = this.entity.id;
      wrapped.stack = error.stack;
      throw wrapped;
    }
  }

  setEnabled(value, extra) {
    if (this.enabled === value) return;
    this.enabled = value;
    this.invoke(value ? 'onEnable' : 'onDisable', extra);
  }

  toJSON() {
    return { type: this.type, props: this.definition.serializeProps(this.props), enabled: this.enabled };
  }
}

export class BehaviorRegistry {
  constructor() {
    /** @type {Map<string, Behavior>} */
    this.definitions = new Map();
  }

  define(def) {
    const behavior = new Behavior(def);
    if (this.definitions.has(behavior.name)) {
      throw new Error(`Behavior "${behavior.name}" is already defined.`);
    }
    this.definitions.set(behavior.name, behavior);
    return behavior;
  }

  /** Replace an existing definition — used by dev-server hot reload. */
  redefine(def) {
    const behavior = new Behavior(def);
    this.definitions.set(behavior.name, behavior);
    return behavior;
  }

  get(name) {
    return this.definitions.get(name);
  }

  require(name) {
    const found = this.definitions.get(name);
    if (found) return found;
    const suggestion = closestMatch(name, [...this.definitions.keys()]);
    throw new Error(
      `Unknown behavior "${name}".` +
        (suggestion ? ` Did you mean "${suggestion}"?` : '') +
        `\nRegistered behaviors: ${[...this.definitions.keys()].sort().join(', ') || '(none)'}` +
        '\nBehaviors must be registered with defineBehavior() before the scene that uses them is loaded.',
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
      .map((b) => b.describe());
  }
}

/** The registry shared by the engine and all games. */
export const behaviors = new BehaviorRegistry();

/** @param {BehaviorDefinition} def */
export function defineBehavior(def) {
  return behaviors.define(def);
}
