/**
 * 3D transform components.
 *
 * ## Why a separate component instead of extending `Transform`
 *
 * `Transform3D` sits alongside the 2D `Transform` rather than replacing it.
 * Two reasons, and the second is the one that matters:
 *
 *  - Existing 2D scenes keep working, unchanged.
 *  - The 2D and 3D systems query different components, so they simply do not
 *    see each other's entities. A scene can hold a 3D world *and* a 2D HUD with
 *    no mode flag anywhere — which is what almost every 3D game actually wants.
 *
 * Mixing `Transform` and `Transform3D` on the same entity is the one thing that
 * makes no sense, and `sjl validate` reports it.
 *
 * ## Units and axes
 *
 * Right-handed, **y-up**: +x right, +y up, +z toward the viewer. An unrotated
 * camera looks down **-z**.
 *
 * Rotation is a **vec3 of Euler angles in degrees**, applied in **YXZ** order
 * (yaw, then pitch, then roll). Quaternions are used internally for composition
 * and interpolation, but never appear in a field a person authors — Euler
 * degrees are what you can read in a diff and type by hand.
 */

import { defineComponent } from '../core/component.js';
import * as Mat4 from '../math/mat4.js';
import * as Quat from '../math/quat.js';
import * as Vec3 from '../math/vec3.js';

export const Transform3D = defineComponent({
  name: 'Transform3D',
  category: 'Core 3D',
  description:
    'Local position, rotation and scale in 3D. Values are relative to the parent entity. ' +
    'Rotation is Euler degrees in YXZ (yaw, pitch, roll) order.',
  schema: {
    position: { type: 'vec3', default: [0, 0, 0], description: 'Local position in world units' },
    rotation: {
      type: 'vec3',
      default: [0, 0, 0],
      description: 'Euler angles in DEGREES: x = pitch, y = yaw, z = roll (applied YXZ)',
    },
    scale: { type: 'vec3', default: [1, 1, 1], description: 'Local scale multiplier' },
  },
});

export const WorldTransform3D = defineComponent({
  name: 'WorldTransform3D',
  category: 'Core 3D',
  runtime: true,
  description:
    'World-space 3D transform, recomputed every frame by Transform3DSystem. ' +
    'Read it; never write it — your changes are overwritten next frame.',
  schema: {
    position: { type: 'vec3', default: [0, 0, 0] },
    rotation: { type: 'vec3', default: [0, 0, 0], description: 'World Euler degrees' },
    scale: { type: 'vec3', default: [1, 1, 1] },
    /** The composed local->world matrix, a Float32Array(16). */
    matrix: { type: 'any' },
    /** World rotation as a quaternion — what direction maths should use. */
    quaternion: { type: 'any' },
  },
  onAdd(data) {
    data.matrix = Mat4.create();
    data.quaternion = Quat.quat();
  },
});

const tempQuat = Quat.quat();

/**
 * Build the local matrix for a Transform3D.
 * @param {Float32Array} [out]
 */
export function localMatrix3D(transform, out = Mat4.create()) {
  Quat.fromEuler(transform.rotation, tempQuat);
  return Mat4.fromTRS(out, transform.position, tempQuat, transform.scale);
}

/** The entity's forward direction (-z) in world space. */
export function forward(worldTransform, out = Vec3.vec3()) {
  return Quat.rotateVec3(worldTransform.quaternion, Vec3.FORWARD, out);
}

/** The entity's right direction (+x) in world space. */
export function rightDir(worldTransform, out = Vec3.vec3()) {
  return Quat.rotateVec3(worldTransform.quaternion, Vec3.RIGHT, out);
}

/** The entity's up direction (+y) in world space. */
export function upDir(worldTransform, out = Vec3.vec3()) {
  return Quat.rotateVec3(worldTransform.quaternion, Vec3.UP, out);
}

/**
 * The forward direction flattened onto the xz plane and renormalized.
 *
 * This is what a character controller wants: walking forward while looking up
 * should not launch you into the air.
 */
export function forwardFlat(worldTransform, out = Vec3.vec3()) {
  forward(worldTransform, out);
  out.y = 0;
  const len = Math.hypot(out.x, out.z);
  if (len < 1e-9) {
    // Looking straight up or down; use the yaw to pick a sensible heading.
    const yaw = worldTransform.rotation.y * (Math.PI / 180);
    out.x = -Math.sin(yaw);
    out.z = -Math.cos(yaw);
    return out;
  }
  out.x /= len;
  out.z /= len;
  return out;
}

/** World position, preferring the computed transform. */
export function worldPosition3D(entity, out = Vec3.vec3()) {
  const w = entity.get('WorldTransform3D');
  if (w) return Vec3.copy(out, w.position);
  const t = entity.get('Transform3D');
  return t ? Vec3.copy(out, t.position) : Vec3.set(out, 0, 0, 0);
}

/**
 * Move an entity to a world-space position, compensating for its parent chain
 * so the result is correct even for a deeply nested child.
 */
export function setWorldPosition3D(entity, x, y, z) {
  const t = entity.require('Transform3D');
  const parentWorld = entity.parent?.get('WorldTransform3D');
  if (!parentWorld) {
    t.position.x = x;
    t.position.y = y;
    t.position.z = z;
    return;
  }
  const inv = Mat4.invert(Mat4.create(), parentWorld.matrix);
  if (!inv) {
    // The parent has a zero scale on some axis; there is no unique local
    // position, so treat the coordinates as local rather than throwing.
    t.position.x = x;
    t.position.y = y;
    t.position.z = z;
    return;
  }
  const local = Mat4.transformPoint(inv, { x, y, z });
  t.position.x = local.x;
  t.position.y = local.y;
  t.position.z = local.z;
}

/** Convert a world point into an entity's local space. */
export function worldToLocal3D(entity, point, out = Vec3.vec3()) {
  const w = entity.get('WorldTransform3D');
  if (!w) return Vec3.copy(out, point);
  const inv = Mat4.invert(Mat4.create(), w.matrix);
  if (!inv) return Vec3.copy(out, point);
  return Mat4.transformPoint(inv, point, out);
}

/** Convert a point in an entity's local space into world space. */
export function localToWorld3D(entity, point, out = Vec3.vec3()) {
  const w = entity.get('WorldTransform3D');
  if (!w) return Vec3.copy(out, point);
  return Mat4.transformPoint(w.matrix, point, out);
}

/** Point an entity at a world position, writing back Euler degrees. */
export function lookAt3D(entity, target, up = Vec3.UP) {
  const t = entity.require('Transform3D');
  const world = entity.get('WorldTransform3D');
  const from = world ? world.position : t.position;

  const direction = Vec3.sub(target, from);
  if (Vec3.lengthSq(direction) < 1e-12) return;

  const rotation = Quat.lookRotation(direction, up);
  const euler = Quat.toEuler(rotation);
  t.rotation.x = euler.x;
  t.rotation.y = euler.y;
  t.rotation.z = euler.z;
}
