/**
 * Axis-aligned rectangles, stored as `{ x, y, w, h }` with `(x, y)` at the
 * minimum corner (bottom-left, since y is up).
 *
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

export function rect(x = 0, y = 0, w = 0, h = 0) {
  return { x, y, w, h };
}

/** Build a rect from a center point and full extents. */
export function fromCenter(cx, cy, w, h, out = rect()) {
  out.x = cx - w / 2;
  out.y = cy - h / 2;
  out.w = w;
  out.h = h;
  return out;
}

export function fromMinMax(minX, minY, maxX, maxY, out = rect()) {
  out.x = minX;
  out.y = minY;
  out.w = maxX - minX;
  out.h = maxY - minY;
  return out;
}

export const minX = (r) => r.x;
export const minY = (r) => r.y;
export const maxX = (r) => r.x + r.w;
export const maxY = (r) => r.y + r.h;
export const centerX = (r) => r.x + r.w / 2;
export const centerY = (r) => r.y + r.h / 2;
export const area = (r) => r.w * r.h;

export function center(r, out = { x: 0, y: 0 }) {
  out.x = r.x + r.w / 2;
  out.y = r.y + r.h / 2;
  return out;
}

export function containsPoint(r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function containsRect(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Overlap test. Touching edges do not count as an intersection. */
export function intersects(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export function intersection(a, b, out = rect()) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  out.x = x0;
  out.y = y0;
  out.w = Math.max(0, x1 - x0);
  out.h = Math.max(0, y1 - y0);
  return out;
}

export function union(a, b, out = rect()) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  out.x = x0;
  out.y = y0;
  out.w = x1 - x0;
  out.h = y1 - y0;
  return out;
}

/** Grow (or shrink, with a negative amount) the rect on all sides. */
export function expand(r, amount, out = rect()) {
  out.x = r.x - amount;
  out.y = r.y - amount;
  out.w = r.w + amount * 2;
  out.h = r.h + amount * 2;
  return out;
}

/** The world-space AABB of `r` after being transformed by mat3 `m`. */
export function transform(r, m, out = rect()) {
  let minPx = Infinity;
  let minPy = Infinity;
  let maxPx = -Infinity;
  let maxPy = -Infinity;
  const xs = [r.x, r.x + r.w];
  const ys = [r.y, r.y + r.h];
  for (const x of xs) {
    for (const y of ys) {
      const px = m[0] * x + m[3] * y + m[6];
      const py = m[1] * x + m[4] * y + m[7];
      if (px < minPx) minPx = px;
      if (py < minPy) minPy = py;
      if (px > maxPx) maxPx = px;
      if (py > maxPy) maxPy = py;
    }
  }
  return fromMinMax(minPx, minPy, maxPx, maxPy, out);
}

export function equals(a, b, epsilon = 1e-6) {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.w - b.w) <= epsilon &&
    Math.abs(a.h - b.h) <= epsilon
  );
}
