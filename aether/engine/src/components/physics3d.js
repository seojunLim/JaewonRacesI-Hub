/**
 * 3D physics components.
 *
 * The 3D solver mirrors the 2D one: impulse-based with positional correction,
 * AABB and sphere colliders, a uniform spatial hash, and the same determinism
 * guarantees. Rotation is not simulated — see `Rigidbody3D` for why.
 */

import { defineComponent } from '../core/component.js';

export const Rigidbody3D = defineComponent({
  name: 'Rigidbody3D',
  category: 'Physics 3D',
  requires: ['Transform3D'],
  description:
    'Makes an entity move under the 3D solver.\n' +
    '  dynamic   — moved by forces and collisions\n' +
    '  kinematic — moved by your code, pushes dynamics, is never pushed back\n' +
    '  static    — never moves; cheapest, and static/static pairs are skipped\n\n' +
    'Angular dynamics are deliberately not simulated: with AABB and sphere colliders ' +
    'there is no inertia tensor worth the name, and a tumbling box whose collider stays ' +
    'axis-aligned looks worse than one that does not tumble. Set `angularVelocity` to ' +
    'spin something visually; it will not affect collision.',
  schema: {
    type: { type: 'enum', values: ['dynamic', 'kinematic', 'static'], default: 'dynamic' },
    velocity: { type: 'vec3', default: [0, 0, 0], description: 'World units per second' },
    angularVelocity: {
      type: 'vec3',
      default: [0, 0, 0],
      description: 'Euler degrees per second. Visual only — collision shapes stay axis-aligned.',
    },
    mass: { type: 'number', default: 1, min: 0.0001 },
    gravityScale: { type: 'number', default: 1, description: '0 disables gravity for this body' },
    linearDamping: { type: 'number', default: 0, min: 0, description: 'Velocity lost per second' },
    freezeX: { type: 'boolean', default: false },
    freezeY: { type: 'boolean', default: false },
    freezeZ: { type: 'boolean', default: false },
    /** Set by the solver when a contact normal points mostly upward. */
    grounded: { type: 'boolean', default: false },
    canSleep: { type: 'boolean', default: true },
    sleeping: { type: 'boolean', default: false },
    sleepTimer: { type: 'number', default: 0 },
  },
});

export const BoxCollider3D = defineComponent({
  name: 'BoxCollider3D',
  category: 'Physics 3D',
  requires: ['Transform3D'],
  description:
    'An axis-aligned box collider. Entity rotation is ignored for collision — AABBs are ' +
    'what keep the broadphase cheap and the solver stable. Compose several boxes, or use ' +
    'a SphereCollider, when you need a rotated shape.',
  schema: {
    size: { type: 'vec3', default: [1, 1, 1], description: 'Full extents in world units' },
    offset: { type: 'vec3', default: [0, 0, 0], description: 'Local offset from the entity origin' },
    isTrigger: { type: 'boolean', default: false, description: 'Detect overlaps but never push' },
    restitution: { type: 'number', default: 0, min: 0, max: 1, description: 'Bounciness' },
    friction: { type: 'number', default: 0.3, min: 0, max: 1 },
    layer: { type: 'int', default: 1, min: 0, description: 'Collision layer bit (1, 2, 4, 8, ...)' },
    mask: { type: 'int', default: -1, description: 'Bitmask of layers to collide with; -1 = all' },
    enabled: { type: 'boolean', default: true },
  },
});

export const SphereCollider = defineComponent({
  name: 'SphereCollider',
  category: 'Physics 3D',
  requires: ['Transform3D'],
  description: 'A spherical collider. Cheapest shape, and the only one that rotates for free.',
  schema: {
    radius: { type: 'number', default: 0.5, min: 0.0001 },
    offset: { type: 'vec3', default: [0, 0, 0] },
    isTrigger: { type: 'boolean', default: false },
    restitution: { type: 'number', default: 0, min: 0, max: 1 },
    friction: { type: 'number', default: 0.3, min: 0, max: 1 },
    layer: { type: 'int', default: 1, min: 0 },
    mask: { type: 'int', default: -1 },
    enabled: { type: 'boolean', default: true },
  },
});

export const Physics3DSettings = defineComponent({
  name: 'Physics3DSettings',
  category: 'Physics 3D',
  singleton: true,
  description:
    'World-level 3D physics configuration. Created automatically from the scene\'s ' +
    '`settings.physics3d` block; you rarely add it by hand.',
  schema: {
    gravity: { type: 'vec3', default: [0, -20, 0], description: 'World units per second squared' },
    iterations: { type: 'int', default: 8, min: 1, max: 64, description: 'Solver iterations per step' },
    correctionPercent: { type: 'number', default: 0.8, min: 0, max: 1 },
    slop: { type: 'number', default: 0.01, min: 0, description: 'Overlap left unresolved, to stop jitter' },
    sleepVelocity: { type: 'number', default: 0.05, min: 0 },
    sleepTime: { type: 'number', default: 0.5, min: 0 },
    cellSize: { type: 'number', default: 2, min: 0.1, description: 'Broadphase grid cell size' },
    enabled: { type: 'boolean', default: true },
  },
});

export const CharacterController3D = defineComponent({
  name: 'CharacterController3D',
  category: 'Physics 3D',
  requires: ['Transform3D', 'Rigidbody3D'],
  description:
    'Marks a body as a walking character and holds its movement state. The ' +
    'FirstPersonController and ThirdPersonController behaviors read and write this, ' +
    'so both share one definition of "is this thing on the ground".',
  schema: {
    /** Slopes steeper than this are treated as walls rather than ground. */
    maxSlopeAngle: { type: 'number', default: 50, min: 0, max: 89, description: 'Degrees' },
    /** How far below the feet to probe for ground. */
    groundProbe: { type: 'number', default: 0.12, min: 0 },
    grounded: { type: 'boolean', default: false },
    /** Seconds since the character was last grounded, for coyote time. */
    airTime: { type: 'number', default: 0, min: 0 },
    /** The surface normal underfoot, when grounded. */
    groundNormal: { type: 'vec3', default: [0, 1, 0] },
  },
});
