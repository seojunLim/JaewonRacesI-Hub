/**
 * 2D vector math.
 *
 * Vectors are plain `{ x, y }` objects on purpose: they print readably in logs
 * and diffs, serialize to JSON without a codec, and an agent reading a crash
 * dump can see the numbers. Every function that can write into an output
 * vector takes `out` last so hot loops can stay allocation-free.
 *
 * @typedef {{ x: number, y: number }} Vec2Like
 */

/** @returns {Vec2Like} */
export function vec2(x = 0, y = 0) {
  return { x, y };
}

/** @param {Vec2Like} v @returns {Vec2Like} */
export function clone(v) {
  return { x: v.x, y: v.y };
}

/** @param {Vec2Like} out @param {number} x @param {number} y */
export function set(out, x, y) {
  out.x = x;
  out.y = y;
  return out;
}

/** @param {Vec2Like} out @param {Vec2Like} v */
export function copy(out, v) {
  out.x = v.x;
  out.y = v.y;
  return out;
}

export function add(a, b, out = vec2()) {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function sub(a, b, out = vec2()) {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function mul(a, b, out = vec2()) {
  out.x = a.x * b.x;
  out.y = a.y * b.y;
  return out;
}

export function div(a, b, out = vec2()) {
  out.x = a.x / b.x;
  out.y = a.y / b.y;
  return out;
}

export function scale(a, s, out = vec2()) {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

/** `out = a + b * s`. The workhorse of every integrator in the engine. */
export function scaleAndAdd(a, b, s, out = vec2()) {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  return out;
}

export function negate(a, out = vec2()) {
  out.x = -a.x;
  out.y = -a.y;
  return out;
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product — a scalar, the z of the 3D cross of two xy vectors. */
export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function length(a) {
  return Math.hypot(a.x, a.y);
}

export function lengthSq(a) {
  return a.x * a.x + a.y * a.y;
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distanceSq(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function normalize(a, out = vec2()) {
  const len = Math.hypot(a.x, a.y);
  if (len === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  out.x = a.x / len;
  out.y = a.y / len;
  return out;
}

/** Rotate counter-clockwise by `radians`. */
export function rotate(a, radians, out = vec2()) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const x = a.x;
  const y = a.y;
  out.x = x * c - y * s;
  out.y = x * s + y * c;
  return out;
}

/** Rotate 90° counter-clockwise. Useful for collision normals and tangents. */
export function perpendicular(a, out = vec2()) {
  const x = a.x;
  out.x = -a.y;
  out.y = x;
  return out;
}

export function angle(a) {
  return Math.atan2(a.y, a.x);
}

/** Signed angle from `a` to `b` in the range (-PI, PI]. */
export function angleBetween(a, b) {
  return Math.atan2(cross(a, b), dot(a, b));
}

export function fromAngle(radians, len = 1, out = vec2()) {
  out.x = Math.cos(radians) * len;
  out.y = Math.sin(radians) * len;
  return out;
}

export function lerp(a, b, t, out = vec2()) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/** Clamp the vector's magnitude to `max`, preserving direction. */
export function clampLength(a, max, out = vec2()) {
  const len = Math.hypot(a.x, a.y);
  if (len <= max || len === 0) return copy(out, a);
  return scale(a, max / len, out);
}

/** Reflect `a` across the surface with unit normal `n`. */
export function reflect(a, n, out = vec2()) {
  const d = 2 * dot(a, n);
  out.x = a.x - d * n.x;
  out.y = a.y - d * n.y;
  return out;
}

/**
 * Move `a` toward `b` by at most `maxDelta`. Frame-rate independent movement
 * that never overshoots, unlike a raw lerp.
 */
export function moveTowards(a, b, maxDelta, out = vec2()) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxDelta || dist === 0) return copy(out, b);
  const s = maxDelta / dist;
  out.x = a.x + dx * s;
  out.y = a.y + dy * s;
  return out;
}

export function equals(a, b, epsilon = 1e-6) {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

export function isFinite_(a) {
  return Number.isFinite(a.x) && Number.isFinite(a.y);
}

/** Serialize to the `[x, y]` form used by scene files. */
export function toArray(a) {
  return [a.x, a.y];
}

/** Accepts `[x, y]`, `{ x, y }`, or a scalar broadcast to both axes. */
export function fromAny(value, out = vec2()) {
  if (value == null) return out;
  if (Array.isArray(value)) return set(out, value[0] ?? 0, value[1] ?? 0);
  if (typeof value === 'number') return set(out, value, value);
  return set(out, value.x ?? 0, value.y ?? 0);
}

export const ZERO = Object.freeze({ x: 0, y: 0 });
export const ONE = Object.freeze({ x: 1, y: 1 });
export const UP = Object.freeze({ x: 0, y: 1 });
export const DOWN = Object.freeze({ x: 0, y: -1 });
export const LEFT = Object.freeze({ x: -1, y: 0 });
export const RIGHT = Object.freeze({ x: 1, y: 0 });
