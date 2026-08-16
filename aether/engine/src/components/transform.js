/**
 * Transform components — position in the scene graph.
 *
 * ## Units
 *
 * Rotation is in **degrees**, everywhere: in scene files, in the inspector, and
 * in `transform.rotation` at runtime. Radians appear only inside matrix math,
 * never in a field an author touches. Mixing the two is the classic source of
 * "why is my sprite at a weird angle", so the engine picks one and holds it.
 *
 * Positions are in **world units**, not pixels. How many pixels a unit occupies
 * is a property of the camera (`pixelsPerUnit`), so the same scene renders
 * correctly at any resolution.
 *
 * ## Axes
 *
 * +x is right, +y is **up**, angles increase counter-clockwise — standard maths
 * convention. The renderer flips to screen space internally.
 */

import { defineComponent } from '../core/component.js';
import * as Mat3 from '../math/mat3.js';
import { DEG2RAD } from '../math/scalar.js';

export const Transform = defineComponent({
  name: 'Transform',
  category: 'Core',
  description:
    'Local position, rotation and scale. Every entity that exists in space needs one. ' +
    'Values are relative to the parent entity when there is one.',
  schema: {
    position: { type: 'vec2', default: [0, 0], description: 'Local position in world units' },
    rotation: { type: 'number', default: 0, description: 'Local rotation in DEGREES, counter-clockwise' },
    scale: { type: 'vec2', default: [1, 1], description: 'Local scale multiplier' },
  },
});

export const WorldTransform = defineComponent({
  name: 'WorldTransform',
  category: 'Core',
  runtime: true,
  description:
    'World-space transform, recomputed every frame by TransformSystem from Transform ' +
    'and the parent chain. Read it; never write it — your changes are overwritten next frame.',
  schema: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    rotation: { type: 'number', default: 0, description: 'World rotation in degrees' },
    scaleX: { type: 'number', default: 1 },
    scaleY: { type: 'number', default: 1 },
    /** The composed local->world matrix. Held as `any` since it is a Float32Array. */
    matrix: { type: 'any' },
  },
  onAdd(data) {
    data.matrix = Mat3.create();
  },
});

/**
 * Build the local matrix for a Transform.
 * @param {{position: {x:number,y:number}, rotation: number, scale: {x:number,y:number}}} transform
 * @param {Float32Array} [out]
 */
export function localMatrix(transform, out = Mat3.create()) {
  return Mat3.fromTRS(
    out,
    transform.position.x,
    transform.position.y,
    transform.rotation * DEG2RAD,
    transform.scale.x,
    transform.scale.y,
  );
}

/** The entity's local "up" direction, in world space. */
export function up(worldTransform, out = { x: 0, y: 0 }) {
  const r = worldTransform.rotation * DEG2RAD;
  out.x = -Math.sin(r);
  out.y = Math.cos(r);
  return out;
}

/** The entity's local "right" direction, in world space. */
export function right(worldTransform, out = { x: 0, y: 0 }) {
  const r = worldTransform.rotation * DEG2RAD;
  out.x = Math.cos(r);
  out.y = Math.sin(r);
  return out;
}

/** World position as a vec2. Convenience for the very common read. */
export function worldPosition(entity, out = { x: 0, y: 0 }) {
  const w = entity.get('WorldTransform');
  if (w) {
    out.x = w.x;
    out.y = w.y;
    return out;
  }
  const t = entity.get('Transform');
  out.x = t?.position.x ?? 0;
  out.y = t?.position.y ?? 0;
  return out;
}

/**
 * Move an entity to a world-space position, compensating for its parent chain
 * so the result is correct even for a deeply nested child.
 */
export function setWorldPosition(entity, x, y) {
  const t = entity.require('Transform');
  const parent = entity.parent;
  const parentWorld = parent?.get('WorldTransform');
  if (!parentWorld) {
    t.position.x = x;
    t.position.y = y;
    return;
  }
  const inv = Mat3.invert(Mat3.create(), parentWorld.matrix);
  if (!inv) {
    // Parent has a zero scale on some axis; there is no unique local position,
    // so fall back to treating the coordinates as local rather than throwing.
    t.position.x = x;
    t.position.y = y;
    return;
  }
  const local = Mat3.transformPoint(inv, x, y);
  t.position.x = local.x;
  t.position.y = local.y;
}

/** Convert a world point into an entity's local space. */
export function worldToLocal(entity, x, y, out = { x: 0, y: 0 }) {
  const w = entity.get('WorldTransform');
  if (!w) return { x, y };
  const inv = Mat3.invert(Mat3.create(), w.matrix);
  if (!inv) return { x, y };
  return Mat3.transformPoint(inv, x, y, out);
}

/** Convert a point in an entity's local space into world space. */
export function localToWorld(entity, x, y, out = { x: 0, y: 0 }) {
  const w = entity.get('WorldTransform');
  if (!w) return { x, y };
  return Mat3.transformPoint(w.matrix, x, y, out);
}
