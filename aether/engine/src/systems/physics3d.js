/**
 * Physics3DSystem — drives the Physics3DWorld from the fixed step.
 *
 * Thin, like its 2D counterpart: all the simulation lives in
 * `src/physics3d/world.js`, which knows nothing about systems and can be
 * stepped directly in a unit test.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { Physics3DWorld } from '../physics3d/world.js';

/** Resource key under which the Physics3DWorld is published. */
export const PHYSICS3D_RESOURCE = 'physics3d';

/**
 * Get (or lazily create) the 3D physics world.
 * Behaviors call this for raycasts: `getPhysics3D(world).raycast(...)`.
 * @returns {Physics3DWorld}
 */
export function getPhysics3D(world) {
  let physics = world.getResource(PHYSICS3D_RESOURCE);
  if (!physics) {
    physics = new Physics3DWorld(world, world.singleton('Physics3DSettings') ?? {});
    world.setResource(PHYSICS3D_RESOURCE, physics);
  }
  return physics;
}

export const Physics3DSystem = defineSystem({
  name: 'Physics3DSystem',
  phase: Phase.FIXED_UPDATE,
  order: Order.DEFAULT + 1,
  description:
    'Integrates 3D rigidbodies, resolves collisions and emits collision/trigger events. ' +
    'Runs at a fixed timestep, so results are frame-rate independent and reproducible.',
  reads: ['Rigidbody3D', 'BoxCollider3D', 'SphereCollider', 'WorldTransform3D', 'Physics3DSettings'],
  writes: ['Transform3D', 'Rigidbody3D'],
  update({ world, dt }) {
    // Skip entirely when a scene has no 3D bodies. A 2D game pays one map
    // lookup per fixed step for the 3D system existing, and nothing more.
    const store = world.stores.get('Rigidbody3D');
    if (!store || store.size === 0) return;

    const physics = getPhysics3D(world);
    const settings = world.singleton('Physics3DSettings');
    if (settings) physics.applySettings(settings);
    physics.step(dt);
  },
});

/**
 * Refresh the broadphase outside of a physics step.
 *
 * Queries read the structures built during the last step. After spawning or
 * moving something you want to query in the same frame, call this first.
 */
export function refreshPhysics3DQueries(world) {
  getPhysics3D(world).gather();
}

/**
 * The standard ground probe for a character.
 *
 * Casts down from just inside the collider's feet and reports what it finds,
 * including the surface normal — which is what a controller needs to decide
 * whether a slope is walkable.
 *
 * @param {import('../core/world.js').Entity} entity
 * @param {object} [options]
 * @returns {{grounded: boolean, normal: {x,y,z}, distance: number, entity: *}|null}
 */
export function groundCheck3D(entity, options = {}) {
  const world = entity.world;
  const wt = entity.get('WorldTransform3D');
  if (!wt) return null;

  const box = entity.get('BoxCollider3D');
  const sphere = entity.get('SphereCollider');
  const halfHeight = box
    ? (box.size.y * Math.abs(wt.scale.y)) / 2
    : (sphere?.radius ?? 0.5) * Math.abs(wt.scale.y);
  const offset = box?.offset ?? sphere?.offset ?? { x: 0, y: 0, z: 0 };

  const distance = options.distance ?? 0.12;
  const origin = {
    x: wt.position.x + offset.x,
    // Start slightly inside the collider so a body resting exactly on a surface
    // still registers; starting exactly at the boundary misses about half the
    // time to floating-point rounding.
    y: wt.position.y + offset.y - halfHeight + 0.02,
    z: wt.position.z + offset.z,
  };

  const hit = getPhysics3D(world).raycast(origin, { x: 0, y: -1, z: 0 }, {
    maxDistance: distance + 0.02,
    mask: options.mask ?? -1,
    ignore: [entity.id],
  });

  if (!hit) return { grounded: false, normal: { x: 0, y: 1, z: 0 }, distance: Infinity, entity: null };
  return { grounded: true, normal: hit.normal, distance: hit.distance, entity: hit.entity };
}
