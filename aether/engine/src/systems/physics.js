/**
 * PhysicsSystem — drives the PhysicsWorld from the fixed step.
 *
 * The system is intentionally thin. All the simulation lives in
 * `src/physics/world.js`, which knows nothing about systems or scheduling, so
 * it can be stepped directly in a unit test with no App around it.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { PhysicsWorld } from '../physics/world.js';

/** Resource key under which the PhysicsWorld is published on the world. */
export const PHYSICS_RESOURCE = 'physics';

/**
 * Get (or lazily create) the PhysicsWorld for a world.
 * Behaviors call this for raycasts: `getPhysics(world).raycast(...)`.
 * @param {import('../core/world.js').World} world
 * @returns {PhysicsWorld}
 */
export function getPhysics(world) {
  let physics = world.getResource(PHYSICS_RESOURCE);
  if (!physics) {
    physics = new PhysicsWorld(world, world.singleton('PhysicsSettings') ?? {});
    world.setResource(PHYSICS_RESOURCE, physics);
  }
  return physics;
}

export const PhysicsSystem = defineSystem({
  name: 'PhysicsSystem',
  phase: Phase.FIXED_UPDATE,
  order: Order.DEFAULT,
  description:
    'Integrates rigidbodies, resolves collisions and emits collision/trigger events. ' +
    'Runs at a fixed timestep so results are frame-rate independent and reproducible.',
  reads: ['Rigidbody', 'BoxCollider', 'CircleCollider', 'WorldTransform', 'PhysicsSettings'],
  writes: ['Transform', 'Rigidbody'],
  update({ world, dt }) {
    const physics = getPhysics(world);
    const settings = world.singleton('PhysicsSettings');
    if (settings) physics.applySettings(settings);
    physics.step(dt);
  },
});

/**
 * Refresh the broadphase outside of a physics step.
 *
 * Queries read the structures built during the last step. After spawning or
 * moving something you want to query in the same frame, call this first — the
 * alternative is a raycast that misses a wall you just created.
 */
export function refreshPhysicsQueries(world) {
  getPhysics(world).gather();
}
