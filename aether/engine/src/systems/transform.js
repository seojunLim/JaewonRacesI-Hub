/**
 * TransformSystem — flattens the scene graph into world-space transforms.
 *
 * Walks roots depth-first, composing each entity's local matrix with its
 * parent's world matrix. The result lands in the `WorldTransform` component,
 * which is what physics, rendering and every world-space query read.
 *
 * It runs twice per frame: once at the top of the fixed step so physics sees
 * current positions, and once before rendering so the frame draws whatever
 * gameplay code did after the last fixed step. Recomputing is cheap (one matrix
 * multiply per entity) and a stale world transform is an entire category of
 * "the hitbox is one frame behind the sprite" bug that simply never occurs.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import * as Mat3 from '../math/mat3.js';
import { localMatrix } from '../components/transform.js';

const tempLocal = Mat3.create();

/** @param {import('../core/system.js').SystemContext} ctx */
function updateTransforms({ world }) {
  const store = world.stores.get('Transform');
  if (!store || store.size === 0) return;

  for (const root of world.roots()) {
    if (!world.hasComponent(root.id, 'Transform')) {
      // A root without a Transform still needs its children walked — an empty
      // organizational entity is a normal thing to have in a scene.
      for (const child of root.children) updateSubtree(world, child, null);
      continue;
    }
    updateSubtree(world, root, null);
  }
}

function updateSubtree(world, entity, parentWorld) {
  const transform = world.getComponent(entity.id, 'Transform');
  let worldTransform = null;

  if (transform) {
    worldTransform = world.ensureComponent(entity.id, 'WorldTransform');
    localMatrix(transform, tempLocal);

    if (parentWorld) {
      Mat3.multiply(worldTransform.matrix, parentWorld.matrix, tempLocal);
    } else {
      Mat3.copy(worldTransform.matrix, tempLocal);
    }

    const d = Mat3.decompose(worldTransform.matrix);
    worldTransform.x = d.x;
    worldTransform.y = d.y;
    worldTransform.rotation = parentWorld ? parentWorld.rotation + transform.rotation : transform.rotation;
    worldTransform.scaleX = d.scaleX;
    worldTransform.scaleY = d.scaleY;
  }

  const next = worldTransform ?? parentWorld;
  for (const child of entity.children) updateSubtree(world, child, next);
}

/** Runs at the top of every fixed step, before physics reads collider positions. */
export const TransformFixedSystem = defineSystem({
  name: 'TransformFixedSystem',
  phase: Phase.FIXED_PRE,
  order: Order.FIRST,
  description: 'Computes WorldTransform from the scene graph, before physics.',
  reads: ['Transform'],
  writes: ['WorldTransform'],
  update: updateTransforms,
});

/** Runs before rendering, picking up anything moved during the variable update. */
export const TransformSystem = defineSystem({
  name: 'TransformSystem',
  phase: Phase.PRE_RENDER,
  order: Order.FIRST,
  description: 'Computes WorldTransform from the scene graph, before rendering.',
  reads: ['Transform'],
  writes: ['WorldTransform'],
  update: updateTransforms,
});

/**
 * Force an immediate recompute. Useful right after spawning an entity when you
 * need its world position before the next frame — a spawner that raycasts from
 * the thing it just created, for example.
 */
export function syncTransforms(world) {
  updateTransforms({ world });
}
