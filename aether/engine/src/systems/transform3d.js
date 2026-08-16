/**
 * Transform3DSystem — flattens the 3D scene graph into world-space transforms.
 *
 * The 3D counterpart of `transform.js`, and it runs at the same two points in
 * the frame for the same reason: once at the top of the fixed step so physics
 * sees current positions, once before rendering so the frame draws whatever
 * gameplay code did afterwards.
 *
 * The two transform systems are independent. An entity with `Transform` is
 * ignored here, and an entity with `Transform3D` is ignored by the 2D system,
 * so a scene can hold a 3D world and a 2D HUD with no mode switch anywhere.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import * as Mat4 from '../math/mat4.js';
import * as Quat from '../math/quat.js';
import { localMatrix3D } from '../components/transform3d.js';

const tempLocal = Mat4.create();
const tempQuat = Quat.quat();

/** @param {import('../core/system.js').SystemContext} ctx */
function updateTransforms3D({ world }) {
  const store = world.stores.get('Transform3D');
  if (!store || store.size === 0) return;

  for (const root of world.roots()) {
    updateSubtree(world, root, null);
  }
}

function updateSubtree(world, entity, parentWorld) {
  const transform = world.getComponent(entity.id, 'Transform3D');
  let worldTransform = null;

  if (transform) {
    worldTransform = world.ensureComponent(entity.id, 'WorldTransform3D');
    localMatrix3D(transform, tempLocal);

    if (parentWorld) {
      Mat4.multiply(worldTransform.matrix, parentWorld.matrix, tempLocal);
    } else {
      Mat4.copy(worldTransform.matrix, tempLocal);
    }

    const decomposed = Mat4.decompose(worldTransform.matrix);
    worldTransform.position.x = decomposed.position.x;
    worldTransform.position.y = decomposed.position.y;
    worldTransform.position.z = decomposed.position.z;
    worldTransform.scale.x = decomposed.scale.x;
    worldTransform.scale.y = decomposed.scale.y;
    worldTransform.scale.z = decomposed.scale.z;

    Quat.copy(worldTransform.quaternion, decomposed.rotation);
    const euler = Quat.toEuler(decomposed.rotation, tempQuat);
    worldTransform.rotation.x = euler.x;
    worldTransform.rotation.y = euler.y;
    worldTransform.rotation.z = euler.z;
  }

  const next = worldTransform ?? parentWorld;
  for (const child of entity.children) updateSubtree(world, child, next);
}

/** Runs at the top of every fixed step, before 3D physics reads positions. */
export const Transform3DFixedSystem = defineSystem({
  name: 'Transform3DFixedSystem',
  phase: Phase.FIXED_PRE,
  order: Order.FIRST + 1,
  description: 'Computes WorldTransform3D from the scene graph, before 3D physics.',
  reads: ['Transform3D'],
  writes: ['WorldTransform3D'],
  update: updateTransforms3D,
});

/** Runs before rendering, picking up anything moved during the variable update. */
export const Transform3DSystem = defineSystem({
  name: 'Transform3DSystem',
  phase: Phase.PRE_RENDER,
  order: Order.FIRST + 1,
  description: 'Computes WorldTransform3D from the scene graph, before rendering.',
  reads: ['Transform3D'],
  writes: ['WorldTransform3D'],
  update: updateTransforms3D,
});

/**
 * Force an immediate recompute. Useful right after spawning an entity when you
 * need its world position before the next frame.
 */
export function syncTransforms3D(world) {
  updateTransforms3D({ world });
}
