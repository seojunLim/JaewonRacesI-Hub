/**
 * Collision shapes and narrow-phase tests.
 *
 * Shapes are described in world space as plain objects so the tests below are
 * pure functions of their inputs — no world, no entity, no hidden state. That
 * makes every one of them directly unit-testable, which matters because
 * collision code is where subtle sign errors hide.
 *
 * @typedef {{ kind: 'box', x: number, y: number, hw: number, hh: number }} BoxShape
 * @typedef {{ kind: 'circle', x: number, y: number, r: number }} CircleShape
 * @typedef {BoxShape | CircleShape} Shape
 *
 * @typedef {object} Manifold
 * @property {number} nx     collision normal x, unit length, pointing from A to B
 * @property {number} ny     collision normal y
 * @property {number} depth  penetration depth along the normal, always >= 0
 * @property {number} cx     a representative contact point x
 * @property {number} cy     a representative contact point y
 */

export function box(x, y, halfWidth, halfHeight) {
  return { kind: 'box', x, y, hw: halfWidth, hh: halfHeight };
}

export function circle(x, y, radius) {
  return { kind: 'circle', x, y, r: radius };
}

/** The world-space AABB of any shape — what the broadphase indexes. */
export function aabbOf(shape, out = { minX: 0, minY: 0, maxX: 0, maxY: 0 }) {
  if (shape.kind === 'circle') {
    out.minX = shape.x - shape.r;
    out.minY = shape.y - shape.r;
    out.maxX = shape.x + shape.r;
    out.maxY = shape.y + shape.r;
  } else {
    out.minX = shape.x - shape.hw;
    out.minY = shape.y - shape.hh;
    out.maxX = shape.x + shape.hw;
    out.maxY = shape.y + shape.hh;
  }
  return out;
}

export function aabbOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Narrow-phase dispatch.
 * @param {Shape} a @param {Shape} b
 * @returns {Manifold|null} `null` when the shapes do not overlap
 */
export function collide(a, b) {
  if (a.kind === 'box') {
    return b.kind === 'box' ? boxBox(a, b) : boxCircle(a, b);
  }
  if (b.kind === 'box') {
    const m = boxCircle(b, a);
    return m ? flip(m) : null;
  }
  return circleCircle(a, b);
}

function flip(m) {
  m.nx = -m.nx;
  m.ny = -m.ny;
  return m;
}

/**
 * AABB vs AABB.
 *
 * Resolution is along the axis of *least* penetration. Doing it any other way
 * is how you get a character walking along a tiled floor and catching on the
 * seam between two tiles: the correct push is up by 0.01, but the wrong axis
 * says sideways by 0.9, and the player stops dead.
 */
export function boxBox(a, b) {
  const dx = b.x - a.x;
  const px = a.hw + b.hw - Math.abs(dx);
  if (px <= 0) return null;

  const dy = b.y - a.y;
  const py = a.hh + b.hh - Math.abs(dy);
  if (py <= 0) return null;

  if (px < py) {
    const sign = dx < 0 ? -1 : 1;
    return {
      nx: sign,
      ny: 0,
      depth: px,
      cx: a.x + sign * a.hw,
      cy: clamp(b.y, a.y - a.hh, a.y + a.hh),
    };
  }
  const sign = dy < 0 ? -1 : 1;
  return {
    nx: 0,
    ny: sign,
    depth: py,
    cx: clamp(b.x, a.x - a.hw, a.x + a.hw),
    cy: a.y + sign * a.hh,
  };
}

export function circleCircle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rsum = a.r + b.r;
  const distSq = dx * dx + dy * dy;
  if (distSq >= rsum * rsum) return null;

  const dist = Math.sqrt(distSq);
  if (dist === 0) {
    // Concentric: any normal is as good as any other, so pick +x and let the
    // solver separate them. Returning null here would let them stay stuck.
    return { nx: 1, ny: 0, depth: rsum, cx: a.x, cy: a.y };
  }
  const nx = dx / dist;
  const ny = dy / dist;
  return {
    nx,
    ny,
    depth: rsum - dist,
    cx: a.x + nx * a.r,
    cy: a.y + ny * a.r,
  };
}

/** Box (A) vs circle (B). The normal points from the box toward the circle. */
export function boxCircle(a, b) {
  const closestX = clamp(b.x, a.x - a.hw, a.x + a.hw);
  const closestY = clamp(b.y, a.y - a.hh, a.y + a.hh);

  let dx = b.x - closestX;
  let dy = b.y - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq > b.r * b.r) return null;

  if (distSq > 1e-12) {
    // Circle center is outside the box: the normal is the direction from the
    // closest surface point to the center.
    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    return { nx, ny, depth: b.r - dist, cx: closestX, cy: closestY };
  }

  // Circle center is inside the box: push out along the nearest face.
  dx = b.x - a.x;
  dy = b.y - a.y;
  const overlapX = a.hw - Math.abs(dx);
  const overlapY = a.hh - Math.abs(dy);
  if (overlapX < overlapY) {
    const sign = dx < 0 ? -1 : 1;
    return { nx: sign, ny: 0, depth: overlapX + b.r, cx: a.x + sign * a.hw, cy: b.y };
  }
  const sign = dy < 0 ? -1 : 1;
  return { nx: 0, ny: sign, depth: overlapY + b.r, cx: b.x, cy: a.y + sign * a.hh };
}

// ---------------------------------------------------------------------------
// Point and ray queries
// ---------------------------------------------------------------------------

export function containsPoint(shape, x, y) {
  if (shape.kind === 'circle') {
    const dx = x - shape.x;
    const dy = y - shape.y;
    return dx * dx + dy * dy <= shape.r * shape.r;
  }
  return (
    x >= shape.x - shape.hw &&
    x <= shape.x + shape.hw &&
    y >= shape.y - shape.hh &&
    y <= shape.y + shape.hh
  );
}

/**
 * Ray vs shape.
 *
 * @param {Shape} shape
 * @param {number} ox @param {number} oy ray origin
 * @param {number} dx @param {number} dy ray direction (need not be normalized)
 * @param {number} maxDistance in units of the direction vector's length
 * @returns {{ t: number, x: number, y: number, nx: number, ny: number }|null}
 */
export function raycastShape(shape, ox, oy, dx, dy, maxDistance = Infinity) {
  return shape.kind === 'circle'
    ? raycastCircle(shape, ox, oy, dx, dy, maxDistance)
    : raycastBox(shape, ox, oy, dx, dy, maxDistance);
}

/** Slab method. Handles axis-aligned rays without dividing by zero. */
export function raycastBox(b, ox, oy, dx, dy, maxDistance = Infinity) {
  const minX = b.x - b.hw;
  const maxX = b.x + b.hw;
  const minY = b.y - b.hh;
  const maxY = b.y + b.hh;

  let tmin = 0;
  let tmax = maxDistance;
  let hitNx = 0;
  let hitNy = 0;

  // X slab
  if (Math.abs(dx) < 1e-12) {
    if (ox < minX || ox > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitNx = n;
      hitNy = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y slab
  if (Math.abs(dy) < 1e-12) {
    if (oy < minY || oy > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitNx = 0;
      hitNy = n;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin > maxDistance) return null;
  return { t: tmin, x: ox + dx * tmin, y: oy + dy * tmin, nx: hitNx, ny: hitNy };
}

export function raycastCircle(c, ox, oy, dx, dy, maxDistance = Infinity) {
  const mx = ox - c.x;
  const my = oy - c.y;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return null;
  const b = 2 * (mx * dx + my * dy);
  const cc = mx * mx + my * my - c.r * c.r;

  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  let t = (-b - sqrtDisc) / (2 * a);
  if (t < 0) t = (-b + sqrtDisc) / (2 * a);
  if (t < 0 || t > maxDistance) return null;

  const hx = ox + dx * t;
  const hy = oy + dy * t;
  const len = Math.hypot(hx - c.x, hy - c.y) || 1;
  return { t, x: hx, y: hy, nx: (hx - c.x) / len, ny: (hy - c.y) / len };
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
