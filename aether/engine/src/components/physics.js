/**
 * Physics components.
 *
 * The 2D solver is impulse-based with positional correction — the same family
 * as Box2D, at a fraction of the size. It is deterministic given the same
 * inputs, because collision pairs are generated in a stable order and nothing
 * in the pipeline touches `Math.random` or wall-clock time.
 */

import { defineComponent } from '../core/component.js';

export const Rigidbody = defineComponent({
  name: 'Rigidbody',
  category: 'Physics',
  requires: ['Transform'],
  description:
    'Makes an entity move under the physics solver.\n' +
    '  dynamic   — moved by forces and collisions (a player, a crate)\n' +
    '  kinematic — moved by your code, pushes dynamics, is never pushed back (a moving platform)\n' +
    '  static    — never moves (the ground). Cheapest; static/static pairs are skipped entirely.',
  schema: {
    type: { type: 'enum', values: ['dynamic', 'kinematic', 'static'], default: 'dynamic' },
    velocity: { type: 'vec2', default: [0, 0], description: 'World units per second' },
    angularVelocity: { type: 'number', default: 0, description: 'Degrees per second' },
    mass: { type: 'number', default: 1, min: 0.0001 },
    gravityScale: { type: 'number', default: 1, description: '0 disables gravity for this body' },
    linearDamping: { type: 'number', default: 0, min: 0, description: 'Velocity lost per second, 0..1-ish' },
    angularDamping: { type: 'number', default: 0.05, min: 0 },
    /** Locks are how you build a platformer character that never topples over. */
    freezeRotation: { type: 'boolean', default: false },
    freezeX: { type: 'boolean', default: false },
    freezeY: { type: 'boolean', default: false },
    /**
     * Continuous collision. Off by default because it costs a sweep per body;
     * turn it on for bullets and anything else that can cross a wall in one step.
     */
    continuous: { type: 'boolean', default: false },
    /** Accumulated force, applied and cleared each fixed step. */
    force: { type: 'vec2', default: [0, 0] },
    torque: { type: 'number', default: 0 },
    /** Set by the solver: is the body resting on something below it? */
    grounded: { type: 'boolean', default: false },
    /** Bodies below this speed for `sleepTime` stop being simulated. */
    canSleep: { type: 'boolean', default: true },
    sleeping: { type: 'boolean', default: false },
    sleepTimer: { type: 'number', default: 0 },
  },
});

export const BoxCollider = defineComponent({
  name: 'BoxCollider',
  category: 'Physics',
  requires: ['Transform'],
  description:
    'An axis-aligned box collider. Rotation of the entity is ignored for collision — ' +
    'AABBs are what make the broadphase cheap and the solver stable. Use several boxes ' +
    'or a CircleCollider if you need rotated shapes.',
  schema: {
    size: { type: 'vec2', default: [1, 1], description: 'Full width and height in world units' },
    offset: { type: 'vec2', default: [0, 0], description: 'Local offset from the entity origin' },
    isTrigger: {
      type: 'boolean',
      default: false,
      description: 'Detect overlaps and fire trigger events, but never push anything',
    },
    restitution: { type: 'number', default: 0, min: 0, max: 1, description: 'Bounciness' },
    friction: { type: 'number', default: 0.2, min: 0, max: 1 },
    density: { type: 'number', default: 1, min: 0.0001 },
    /** Bitmask: which layer this collider is on. */
    layer: { type: 'int', default: 1, min: 0, description: 'Collision layer bit (1, 2, 4, 8, ...)' },
    /** Bitmask: which layers this collider collides with. -1 means everything. */
    mask: { type: 'int', default: -1, description: 'Bitmask of layers to collide with; -1 = all' },
    enabled: { type: 'boolean', default: true },
  },
});

export const CircleCollider = defineComponent({
  name: 'CircleCollider',
  category: 'Physics',
  requires: ['Transform'],
  description: 'A circular collider. Cheapest shape, and the only one that rotates for free.',
  schema: {
    radius: { type: 'number', default: 0.5, min: 0.0001 },
    offset: { type: 'vec2', default: [0, 0] },
    isTrigger: { type: 'boolean', default: false },
    restitution: { type: 'number', default: 0, min: 0, max: 1 },
    friction: { type: 'number', default: 0.2, min: 0, max: 1 },
    density: { type: 'number', default: 1, min: 0.0001 },
    layer: { type: 'int', default: 1, min: 0 },
    mask: { type: 'int', default: -1 },
    enabled: { type: 'boolean', default: true },
  },
});

export const PhysicsSettings = defineComponent({
  name: 'PhysicsSettings',
  category: 'Physics',
  singleton: true,
  description:
    'World-level physics configuration. Created automatically from the scene\'s ' +
    '`settings.physics` block; you rarely add it by hand.',
  schema: {
    gravity: { type: 'vec2', default: [0, -20], description: 'World units per second squared' },
    /**
     * Higher means stiffer, more correct stacks and more CPU. 8 is a good
     * default for platformers; raise it if boxes sink into each other.
     */
    iterations: { type: 'int', default: 8, min: 1, max: 64, description: 'Solver iterations per step' },
    /** How aggressively overlap is pushed out. Too high causes jitter. */
    correctionPercent: { type: 'number', default: 0.8, min: 0, max: 1 },
    /** Overlap below this is left alone, which stops resting bodies vibrating. */
    slop: { type: 'number', default: 0.01, min: 0 },
    sleepVelocity: { type: 'number', default: 0.05, min: 0 },
    sleepTime: { type: 'number', default: 0.5, min: 0, description: 'Seconds below sleepVelocity before sleeping' },
    /** Broadphase grid cell size. Roughly the size of a typical collider. */
    cellSize: { type: 'number', default: 2, min: 0.1 },
    enabled: { type: 'boolean', default: true },
  },
});

/**
 * Layer bit helpers. Collision masks are bitmasks, and hand-computing
 * `1 | 4 | 16` in a JSON file is a good way to get it subtly wrong.
 */
export const Layers = {
  DEFAULT: 1 << 0,
  PLAYER: 1 << 1,
  ENEMY: 1 << 2,
  PROJECTILE: 1 << 3,
  PICKUP: 1 << 4,
  GROUND: 1 << 5,
  WALL: 1 << 6,
  TRIGGER: 1 << 7,
  UI: 1 << 8,
  ALL: -1,
  NONE: 0,
};

/** Combine layers into a mask: `maskOf('PLAYER', 'ENEMY')`. */
export function maskOf(...names) {
  let mask = 0;
  for (const name of names) {
    const bit = Layers[name];
    if (bit === undefined) {
      throw new Error(`Unknown collision layer "${name}". Known: ${Object.keys(Layers).join(', ')}`);
    }
    mask |= bit;
  }
  return mask;
}

/** Everything except the named layers. */
export function maskExcept(...names) {
  return ~maskOf(...names);
}
