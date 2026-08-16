/**
 * Quaternions.
 *
 * Rotations are *authored* as Euler angles in degrees, because that is what a
 * person can read and edit in a scene file. They are *composed* as quaternions,
 * because Euler angles gimbal-lock and interpolate badly. This module is the
 * bridge between the two.
 *
 * ## Euler order
 *
 * The engine uses **YXZ intrinsic** order: yaw around y, then pitch around x,
 * then roll around z. That is the order a camera or a character wants — yaw and
 * pitch stay independent, which is what makes mouse-look behave. Pick a
 * different order and looking up while turning starts to roll the view.
 *
 * @typedef {{ x: number, y: number, z: number, w: number }} QuatLike
 */

import { DEG2RAD, RAD2DEG } from './scalar.js';

/** The identity rotation. */
export function quat(x = 0, y = 0, z = 0, w = 1) {
  return { x, y, z, w };
}

export function identity(out) {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  out.w = 1;
  return out;
}

export function clone(q) {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function copy(out, q) {
  out.x = q.x;
  out.y = q.y;
  out.z = q.z;
  out.w = q.w;
  return out;
}

export function set(out, x, y, z, w) {
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

/**
 * `out = a * b` — applies `b` first, then `a`.
 * Matches matrix multiplication order, so the two compose the same way.
 */
export function multiply(a, b, out = quat()) {
  const ax = a.x, ay = a.y, az = a.z, aw = a.w;
  const bx = b.x, by = b.y, bz = b.z, bw = b.w;
  out.x = ax * bw + aw * bx + ay * bz - az * by;
  out.y = ay * bw + aw * by + az * bx - ax * bz;
  out.z = az * bw + aw * bz + ax * by - ay * bx;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Rotation of `radians` around a unit `axis`. */
export function fromAxisAngle(axis, radians, out = quat()) {
  const half = radians / 2;
  const s = Math.sin(half);
  out.x = axis.x * s;
  out.y = axis.y * s;
  out.z = axis.z * s;
  out.w = Math.cos(half);
  return out;
}

/**
 * Build a quaternion from Euler angles **in degrees**, YXZ order.
 * @param {{x:number,y:number,z:number}} euler pitch (x), yaw (y), roll (z)
 */
export function fromEuler(euler, out = quat()) {
  const pitch = (euler.x ?? 0) * DEG2RAD * 0.5;
  const yaw = (euler.y ?? 0) * DEG2RAD * 0.5;
  const roll = (euler.z ?? 0) * DEG2RAD * 0.5;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  // q = qYaw * qPitch * qRoll, expanded.
  out.x = cy * sp * cr + sy * cp * sr;
  out.y = sy * cp * cr - cy * sp * sr;
  out.z = cy * cp * sr - sy * sp * cr;
  out.w = cy * cp * cr + sy * sp * sr;
  return out;
}

/**
 * Recover Euler angles **in degrees**, YXZ order.
 *
 * At the poles (pitch ±90°) yaw and roll describe the same rotation, so roll is
 * pinned to zero and the whole turn is reported as yaw. That is the standard
 * resolution and it keeps the result continuous.
 */
export function toEuler(q, out = { x: 0, y: 0, z: 0 }) {
  const { x, y, z, w } = q;

  // sin(pitch) from the rotation matrix's m12 term.
  const sinPitch = 2 * (w * x - y * z);
  const clamped = Math.min(1, Math.max(-1, sinPitch));
  const pitch = Math.asin(clamped);

  let yaw;
  let roll;
  if (Math.abs(clamped) > 0.99999) {
    yaw = Math.atan2(-2 * (x * z - w * y), 1 - 2 * (x * x + y * y));
    roll = 0;
  } else {
    yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
    roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));
  }

  out.x = pitch * RAD2DEG;
  out.y = yaw * RAD2DEG;
  out.z = roll * RAD2DEG;
  return out;
}

export function length(q) {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

export function normalize(q, out = quat()) {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len === 0) return identity(out);
  out.x = q.x / len;
  out.y = q.y / len;
  out.z = q.z / len;
  out.w = q.w / len;
  return out;
}

/** The inverse rotation. Valid for unit quaternions, which is all the engine makes. */
export function conjugate(q, out = quat()) {
  out.x = -q.x;
  out.y = -q.y;
  out.z = -q.z;
  out.w = q.w;
  return out;
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/** Rotate a vector by a quaternion. */
export function rotateVec3(q, v, out = { x: 0, y: 0, z: 0 }) {
  // t = 2 * (q.xyz × v);  out = v + q.w * t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);

  out.x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  out.y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  out.z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}

/**
 * Spherical interpolation. Falls back to a normalized lerp for nearly-parallel
 * inputs, where the sine terms lose precision.
 */
export function slerp(a, b, t, out = quat()) {
  let cosom = dot(a, b);

  // Take the shorter arc: q and -q are the same rotation.
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  let scale0;
  let scale1;
  if (1 - cosom > 1e-6) {
    const omega = Math.acos(cosom);
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  } else {
    scale0 = 1 - t;
    scale1 = t;
  }

  out.x = scale0 * a.x + scale1 * bx;
  out.y = scale0 * a.y + scale1 * by;
  out.z = scale0 * a.z + scale1 * bz;
  out.w = scale0 * a.w + scale1 * bw;
  return normalize(out, out);
}

/**
 * A rotation that points -z along `forward`, with +y as close to `up` as possible.
 * The camera and `LookAt` behavior both build on this.
 */
export function lookRotation(forward, up = { x: 0, y: 1, z: 0 }, out = quat()) {
  // Normalize and build an orthonormal basis. `zAxis` is the *backward*
  // direction, since -z is forward.
  let fx = forward.x, fy = forward.y, fz = forward.z;
  const flen = Math.hypot(fx, fy, fz);
  if (flen === 0) return identity(out);
  fx /= flen;
  fy /= flen;
  fz /= flen;

  const zx = -fx;
  const zy = -fy;
  const zz = -fz;

  // xAxis = up × zAxis
  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  let xlen = Math.hypot(xx, xy, xz);

  if (xlen < 1e-6) {
    // `forward` is parallel to `up`; any roll is as good as any other, so pick
    // a basis rather than producing NaN.
    const fallback = Math.abs(zy) > 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    xx = fallback.y * zz - fallback.z * zy;
    xy = fallback.z * zx - fallback.x * zz;
    xz = fallback.x * zy - fallback.y * zx;
    xlen = Math.hypot(xx, xy, xz) || 1;
  }
  xx /= xlen;
  xy /= xlen;
  xz /= xlen;

  // yAxis = zAxis × xAxis
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return fromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz, out);
}

/** Build a quaternion from three orthonormal basis vectors (column-major axes). */
export function fromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz, out = quat()) {
  const trace = xx + yy + zz;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    out.w = 0.25 * s;
    out.x = (yz - zy) / s;
    out.y = (zx - xz) / s;
    out.z = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    out.w = (yz - zy) / s;
    out.x = 0.25 * s;
    out.y = (yx + xy) / s;
    out.z = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    out.w = (zx - xz) / s;
    out.x = (yx + xy) / s;
    out.y = 0.25 * s;
    out.z = (zy + yz) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    out.w = (xy - yx) / s;
    out.x = (zx + xz) / s;
    out.y = (zy + yz) / s;
    out.z = 0.25 * s;
  }
  return normalize(out, out);
}

/** Rotate `current` toward `target` by at most `maxRadians`. */
export function rotateTowards(current, target, maxRadians, out = quat()) {
  const angle = angleBetween(current, target);
  if (angle === 0) return copy(out, target);
  return slerp(current, target, Math.min(1, maxRadians / angle), out);
}

/** Angle between two rotations, in radians. */
export function angleBetween(a, b) {
  const d = Math.abs(dot(a, b));
  return 2 * Math.acos(Math.min(1, d));
}

export function equals(a, b, epsilon = 1e-6) {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon &&
    Math.abs(a.w - b.w) <= epsilon
  );
}

/** Accepts `[x,y,z,w]`, `{x,y,z,w}`, or `[pitch,yaw,roll]` degrees (length 3). */
export function fromAny(value, out = quat()) {
  if (value == null) return identity(out);
  if (Array.isArray(value)) {
    if (value.length === 4) return set(out, value[0], value[1], value[2], value[3]);
    return fromEuler({ x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 }, out);
  }
  if (value.w !== undefined) return set(out, value.x ?? 0, value.y ?? 0, value.z ?? 0, value.w);
  return fromEuler(value, out);
}

export const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
