/**
 * 3D vector math.
 *
 * Same conventions as `vec2.js`: plain `{ x, y, z }` objects so values print
 * readably and serialize without a codec, and an `out` parameter last so hot
 * loops stay allocation-free.
 *
 * The coordinate system is **right-handed, y-up**: +x right, +y up, +z toward
 * the viewer. A camera with no rotation therefore looks down **-z**, which is
 * the OpenGL/glTF convention and the one every reference you will look up
 * assumes.
 *
 * @typedef {{ x: number, y: number, z: number }} Vec3Like
 */

/** @returns {Vec3Like} */
export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function clone(v) {
  return { x: v.x, y: v.y, z: v.z };
}

export function set(out, x, y, z) {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out, v) {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

export function add(a, b, out = vec3()) {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(a, b, out = vec3()) {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function mul(a, b, out = vec3()) {
  out.x = a.x * b.x;
  out.y = a.y * b.y;
  out.z = a.z * b.z;
  return out;
}

export function scale(a, s, out = vec3()) {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** `out = a + b * s`. The workhorse of every integrator. */
export function scaleAndAdd(a, b, s, out = vec3()) {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function negate(a, out = vec3()) {
  out.x = -a.x;
  out.y = -a.y;
  out.z = -a.z;
  return out;
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Right-handed cross product. */
export function cross(a, b, out = vec3()) {
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const bx = b.x;
  const by = b.y;
  const bz = b.z;
  out.x = ay * bz - az * by;
  out.y = az * bx - ax * bz;
  out.z = ax * by - ay * bx;
  return out;
}

export function length(a) {
  return Math.hypot(a.x, a.y, a.z);
}

export function lengthSq(a) {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function distanceSq(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

export function normalize(a, out = vec3()) {
  const len = Math.hypot(a.x, a.y, a.z);
  if (len === 0) return set(out, 0, 0, 0);
  out.x = a.x / len;
  out.y = a.y / len;
  out.z = a.z / len;
  return out;
}

export function lerp(a, b, t, out = vec3()) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** Clamp the vector's magnitude, preserving direction. */
export function clampLength(a, max, out = vec3()) {
  const len = Math.hypot(a.x, a.y, a.z);
  if (len <= max || len === 0) return copy(out, a);
  return scale(a, max / len, out);
}

/** Reflect `a` across the plane with unit normal `n`. */
export function reflect(a, n, out = vec3()) {
  const d = 2 * dot(a, n);
  out.x = a.x - d * n.x;
  out.y = a.y - d * n.y;
  out.z = a.z - d * n.z;
  return out;
}

/** The component of `a` that lies along unit vector `n`. */
export function project(a, n, out = vec3()) {
  return scale(n, dot(a, n), out);
}

/** The component of `a` perpendicular to unit vector `n`. */
export function reject(a, n, out = vec3()) {
  const d = dot(a, n);
  out.x = a.x - n.x * d;
  out.y = a.y - n.y * d;
  out.z = a.z - n.z * d;
  return out;
}

export function moveTowards(a, b, maxDelta, out = vec3()) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= maxDelta || dist === 0) return copy(out, b);
  const s = maxDelta / dist;
  out.x = a.x + dx * s;
  out.y = a.y + dy * s;
  out.z = a.z + dz * s;
  return out;
}

/** Angle between two vectors, in radians. */
export function angleBetween(a, b) {
  const denominator = Math.sqrt(lengthSq(a) * lengthSq(b));
  if (denominator === 0) return 0;
  // Clamp guards against a dot product landing just outside [-1, 1] through
  // rounding, which would make acos return NaN.
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / denominator)));
}

export function equals(a, b, epsilon = 1e-6) {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  );
}

export function isFinite_(a) {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

export function toArray(a) {
  return [a.x, a.y, a.z];
}

/** Accepts `[x,y,z]`, `{x,y,z}`, `[x,y]` (z=0), or a scalar broadcast to all axes. */
export function fromAny(value, out = vec3()) {
  if (value == null) return out;
  if (Array.isArray(value)) return set(out, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  if (typeof value === 'number') return set(out, value, value, value);
  return set(out, value.x ?? 0, value.y ?? 0, value.z ?? 0);
}

export const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
export const ONE = Object.freeze({ x: 1, y: 1, z: 1 });
export const UP = Object.freeze({ x: 0, y: 1, z: 0 });
export const DOWN = Object.freeze({ x: 0, y: -1, z: 0 });
export const LEFT = Object.freeze({ x: -1, y: 0, z: 0 });
export const RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
/** -z, matching where an unrotated camera looks. */
export const FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });
export const BACK = Object.freeze({ x: 0, y: 0, z: 1 });
