/**
 * 4x4 column-major matrices.
 *
 * Layout matches WebGL's `uniformMatrix4fv` with `transpose = false`, so a
 * matrix can be handed to the GPU without a copy:
 *
 *   | m[0] m[4] m[8]  m[12] |
 *   | m[1] m[5] m[9]  m[13] |
 *   | m[2] m[6] m[10] m[14] |
 *   | m[3] m[7] m[11] m[15] |
 *
 * Translation lives in m[12..14].
 *
 * @typedef {Float32Array} Mat4
 */

/** @returns {Float32Array} the identity matrix */
export function create() {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function identity(out) {
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

export function copy(out, a) {
  for (let i = 0; i < 16; i++) out[i] = a[i];
  return out;
}

/**
 * Compose translation * rotation * scale in one pass.
 *
 * This is the only matrix construction the transform system needs, so it is
 * written out rather than built from three multiplies — it runs once per entity
 * per frame.
 *
 * @param {{x,y,z}} t translation
 * @param {{x,y,z,w}} q rotation quaternion
 * @param {{x,y,z}} s scale
 */
export function fromTRS(out, t, q, s) {
  const { x, y, z, w } = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;

  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  out[0] = (1 - (yy + zz)) * s.x;
  out[1] = (xy + wz) * s.x;
  out[2] = (xz - wy) * s.x;
  out[3] = 0;

  out[4] = (xy - wz) * s.y;
  out[5] = (1 - (xx + zz)) * s.y;
  out[6] = (yz + wx) * s.y;
  out[7] = 0;

  out[8] = (xz + wy) * s.z;
  out[9] = (yz - wx) * s.z;
  out[10] = (1 - (xx + yy)) * s.z;
  out[11] = 0;

  out[12] = t.x;
  out[13] = t.y;
  out[14] = t.z;
  out[15] = 1;
  return out;
}

/** `out = a * b` — applies `b` first, then `a`, to a column vector. */
export function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4];
    const b1 = b[i * 4 + 1];
    const b2 = b[i * 4 + 2];
    const b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/** @returns {Float32Array|null} `null` when the matrix is singular. */
export function invert(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/**
 * The inverse-transpose of the upper 3x3, written into a mat3.
 *
 * Normals must be transformed by this rather than the model matrix — under a
 * non-uniform scale the model matrix tilts them off the surface, and the
 * lighting goes visibly wrong.
 *
 * @param {Float32Array} out a 9-element mat3
 */
export function normalMatrix(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a10 = a[4], a11 = a[5], a12 = a[6];
  const a20 = a[8], a21 = a[9], a22 = a[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) {
    // Degenerate scale: fall back to the untransformed basis rather than NaN.
    out[0] = 1; out[1] = 0; out[2] = 0;
    out[3] = 0; out[4] = 1; out[5] = 0;
    out[6] = 0; out[7] = 0; out[8] = 1;
    return out;
  }
  det = 1 / det;

  out[0] = b01 * det;
  out[1] = (-a22 * a01 + a02 * a21) * det;
  out[2] = (a12 * a01 - a02 * a11) * det;
  out[3] = b11 * det;
  out[4] = (a22 * a00 - a02 * a20) * det;
  out[5] = (-a12 * a00 + a02 * a10) * det;
  out[6] = b21 * det;
  out[7] = (-a21 * a00 + a01 * a20) * det;
  out[8] = (a11 * a00 - a01 * a10) * det;
  return out;
}

/** Transform a point (translation applies, perspective divide applied). */
export function transformPoint(m, v, out = { x: 0, y: 0, z: 0 }) {
  const { x, y, z } = v;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  out.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}

/** Transform a direction (translation ignored, no divide). */
export function transformDirection(m, v, out = { x: 0, y: 0, z: 0 }) {
  const { x, y, z } = v;
  out.x = m[0] * x + m[4] * y + m[8] * z;
  out.y = m[1] * x + m[5] * y + m[9] * z;
  out.z = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

/** Pull translation, rotation and scale back out of a matrix. */
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  let sz = Math.hypot(m[8], m[9], m[10]);

  // A negative determinant means the basis is mirrored; attribute it to z.
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) sz = -sz;

  const isx = sx ? 1 / sx : 0;
  const isy = sy ? 1 / sy : 0;
  const isz = sz ? 1 / sz : 0;

  const rotation = quatFromBasis(
    m[0] * isx, m[1] * isx, m[2] * isx,
    m[4] * isy, m[5] * isy, m[6] * isy,
    m[8] * isz, m[9] * isz, m[10] * isz,
  );

  return {
    position: { x: m[12], y: m[13], z: m[14] },
    rotation,
    scale: { x: sx, y: sy, z: sz },
  };
}

function quatFromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz) {
  const out = { x: 0, y: 0, z: 0, w: 1 };
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
  const len = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  out.w /= len;
  return out;
}

/**
 * Right-handed perspective projection mapping to the [-1, 1] depth range.
 * @param {number} fovYRadians vertical field of view
 */
export function perspective(out, fovYRadians, aspect, near, far) {
  const f = 1 / Math.tan(fovYRadians / 2);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[11] = -1;
  out[12] = 0; out[13] = 0; out[15] = 0;

  if (far === Infinity) {
    out[10] = -1;
    out[14] = -2 * near;
  } else {
    const nf = 1 / (near - far);
    out[10] = (far + near) * nf;
    out[14] = 2 * far * near * nf;
  }
  return out;
}

/** Right-handed orthographic projection. */
export function ortho(out, left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;
  out[15] = 1;
  return out;
}

/** A view matrix looking from `eye` toward `center`. */
export function lookAt(out, eye, center, up) {
  let zx = eye.x - center.x;
  let zy = eye.y - center.y;
  let zz = eye.z - center.z;
  let len = Math.hypot(zx, zy, zz);
  if (len < 1e-9) return identity(out);
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-9) {
    xx = 1;
    xy = 0;
    xz = 0;
  } else {
    xx /= len;
    xy /= len;
    xz /= len;
  }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  out[15] = 1;
  return out;
}

/**
 * The inverse of a rigid transform (rotation + translation, no scale).
 *
 * Building a view matrix this way is both faster and more numerically stable
 * than a general `invert`, because it transposes the rotation instead of
 * running a full cofactor expansion.
 */
export function invertRigid(out, a) {
  const tx = a[12];
  const ty = a[13];
  const tz = a[14];

  out[0] = a[0]; out[1] = a[4]; out[2] = a[8]; out[3] = 0;
  out[4] = a[1]; out[5] = a[5]; out[6] = a[9]; out[7] = 0;
  out[8] = a[2]; out[9] = a[6]; out[10] = a[10]; out[11] = 0;

  out[12] = -(a[0] * tx + a[1] * ty + a[2] * tz);
  out[13] = -(a[4] * tx + a[5] * ty + a[6] * tz);
  out[14] = -(a[8] * tx + a[9] * ty + a[10] * tz);
  out[15] = 1;
  return out;
}
