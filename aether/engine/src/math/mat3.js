/**
 * 3x3 column-major matrices for 2D affine transforms.
 *
 * Layout (column-major, matching WebGL's `uniformMatrix3fv` with transpose=false):
 *
 *   | m[0] m[3] m[6] |   | a c tx |
 *   | m[1] m[4] m[7] | = | b d ty |
 *   | m[2] m[5] m[8] |   | 0 0 1  |
 *
 * @typedef {Float32Array | number[]} Mat3
 */

/** @returns {Float32Array} */
export function create() {
  const m = new Float32Array(9);
  m[0] = 1;
  m[4] = 1;
  m[8] = 1;
  return m;
}

export function identity(out) {
  out[0] = 1; out[1] = 0; out[2] = 0;
  out[3] = 0; out[4] = 1; out[5] = 0;
  out[6] = 0; out[7] = 0; out[8] = 1;
  return out;
}

export function copy(out, a) {
  for (let i = 0; i < 9; i++) out[i] = a[i];
  return out;
}

/**
 * Compose translation * rotation * scale into `out` in one pass.
 * This is the only matrix construction the transform system needs, so it is
 * written out rather than built from three multiplies.
 */
export function fromTRS(out, tx, ty, radians, sx, sy) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  out[0] = c * sx;  out[1] = s * sx;  out[2] = 0;
  out[3] = -s * sy; out[4] = c * sy;  out[5] = 0;
  out[6] = tx;      out[7] = ty;      out[8] = 1;
  return out;
}

/** `out = a * b` — applies `b` first, then `a`, to a column vector. */
export function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a10 = a[3], a11 = a[4], a12 = a[5];
  const a20 = a[6], a21 = a[7], a22 = a[8];

  const b00 = b[0], b01 = b[1], b02 = b[2];
  const b10 = b[3], b11 = b[4], b12 = b[5];
  const b20 = b[6], b21 = b[7], b22 = b[8];

  out[0] = b00 * a00 + b01 * a10 + b02 * a20;
  out[1] = b00 * a01 + b01 * a11 + b02 * a21;
  out[2] = b00 * a02 + b01 * a12 + b02 * a22;

  out[3] = b10 * a00 + b11 * a10 + b12 * a20;
  out[4] = b10 * a01 + b11 * a11 + b12 * a21;
  out[5] = b10 * a02 + b11 * a12 + b12 * a22;

  out[6] = b20 * a00 + b21 * a10 + b22 * a20;
  out[7] = b20 * a01 + b21 * a11 + b22 * a21;
  out[8] = b20 * a02 + b21 * a12 + b22 * a22;
  return out;
}

export function translate(out, a, tx, ty) {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a10 = a[3], a11 = a[4], a12 = a[5];
  const a20 = a[6], a21 = a[7], a22 = a[8];
  out[0] = a00; out[1] = a01; out[2] = a02;
  out[3] = a10; out[4] = a11; out[5] = a12;
  out[6] = tx * a00 + ty * a10 + a20;
  out[7] = tx * a01 + ty * a11 + a21;
  out[8] = tx * a02 + ty * a12 + a22;
  return out;
}

export function rotate(out, a, radians) {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a10 = a[3], a11 = a[4], a12 = a[5];
  const s = Math.sin(radians);
  const c = Math.cos(radians);
  out[0] = c * a00 + s * a10;
  out[1] = c * a01 + s * a11;
  out[2] = c * a02 + s * a12;
  out[3] = c * a10 - s * a00;
  out[4] = c * a11 - s * a01;
  out[5] = c * a12 - s * a02;
  out[6] = a[6]; out[7] = a[7]; out[8] = a[8];
  return out;
}

export function scale(out, a, sx, sy) {
  out[0] = sx * a[0]; out[1] = sx * a[1]; out[2] = sx * a[2];
  out[3] = sy * a[3]; out[4] = sy * a[4]; out[5] = sy * a[5];
  out[6] = a[6];      out[7] = a[7];      out[8] = a[8];
  return out;
}

/** @returns {typeof out | null} `null` when the matrix is singular. */
export function invert(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a10 = a[3], a11 = a[4], a12 = a[5];
  const a20 = a[6], a21 = a[7], a22 = a[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  const det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) return null;
  const id = 1 / det;

  out[0] = b01 * id;
  out[1] = (-a22 * a01 + a02 * a21) * id;
  out[2] = (a12 * a01 - a02 * a11) * id;
  out[3] = b11 * id;
  out[4] = (a22 * a00 - a02 * a20) * id;
  out[5] = (-a12 * a00 + a02 * a10) * id;
  out[6] = b21 * id;
  out[7] = (-a21 * a00 + a01 * a20) * id;
  out[8] = (a11 * a00 - a01 * a10) * id;
  return out;
}

/** Transform a point (translation applies). */
export function transformPoint(m, x, y, out = { x: 0, y: 0 }) {
  out.x = m[0] * x + m[3] * y + m[6];
  out.y = m[1] * x + m[4] * y + m[7];
  return out;
}

/** Transform a direction (translation ignored). */
export function transformDirection(m, x, y, out = { x: 0, y: 0 }) {
  out.x = m[0] * x + m[3] * y;
  out.y = m[1] * x + m[4] * y;
  return out;
}

/** Pull world-space position, rotation and scale back out of a matrix. */
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[3], m[4]);
  // A negative determinant means one axis is mirrored; attribute it to y.
  const det = m[0] * m[4] - m[1] * m[3];
  return {
    x: m[6],
    y: m[7],
    rotation: Math.atan2(m[1], m[0]),
    scaleX: sx,
    scaleY: det < 0 ? -sy : sy,
  };
}

/**
 * Orthographic projection mapping a world-space rectangle to clip space.
 * y is up, matching the rest of the engine.
 */
export function ortho(out, left, right, bottom, top) {
  const w = right - left;
  const h = top - bottom;
  out[0] = 2 / w;  out[1] = 0;      out[2] = 0;
  out[3] = 0;      out[4] = 2 / h;  out[5] = 0;
  out[6] = -(right + left) / w;
  out[7] = -(top + bottom) / h;
  out[8] = 1;
  return out;
}
