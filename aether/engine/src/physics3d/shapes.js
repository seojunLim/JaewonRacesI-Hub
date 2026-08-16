/**
 * 3D collision shapes and narrow-phase tests.
 *
 * The 3D counterpart of `src/physics/shapes.js`, with the same discipline:
 * shapes are plain world-space objects and every test is a pure function, so
 * each one is directly unit-testable without a world or an entity.
 *
 * @typedef {{ kind: 'box', x, y, z, hx, hy, hz }} Box3
 * @typedef {{ kind: 'sphere', x, y, z, r }} Sphere3
 * @typedef {Box3 | Sphere3} Shape3
 *
 * @typedef {object} Manifold3
 * @property {number} nx  collision normal, unit length, pointing from A to B
 * @property {number} ny
 * @property {number} nz
 * @property {number} depth  penetration along the normal, always >= 0
 * @property {number} cx  a representative contact point
 * @property {number} cy
 * @property {number} cz
 */

export function box3(x, y, z, hx, hy, hz) {
  return { kind: 'box', x, y, z, hx, hy, hz };
}

export function sphere3(x, y, z, radius) {
  return { kind: 'sphere', x, y, z, r: radius };
}

/** The world-space AABB of any shape — what the broadphase indexes. */
export function aabbOf(shape, out = {}) {
  if (shape.kind === 'sphere') {
    out.minX = shape.x - shape.r;
    out.minY = shape.y - shape.r;
    out.minZ = shape.z - shape.r;
    out.maxX = shape.x + shape.r;
    out.maxY = shape.y + shape.r;
    out.maxZ = shape.z + shape.r;
  } else {
    out.minX = shape.x - shape.hx;
    out.minY = shape.y - shape.hy;
    out.minZ = shape.z - shape.hz;
    out.maxX = shape.x + shape.hx;
    out.maxY = shape.y + shape.hy;
    out.maxZ = shape.z + shape.hz;
  }
  return out;
}

export function aabbOverlap(a, b) {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY &&
    a.minZ <= b.maxZ && a.maxZ >= b.minZ
  );
}

/**
 * Narrow-phase dispatch.
 * @returns {Manifold3|null} `null` when the shapes do not overlap
 */
export function collide(a, b) {
  if (a.kind === 'box') {
    return b.kind === 'box' ? boxBox(a, b) : boxSphere(a, b);
  }
  if (b.kind === 'box') {
    const m = boxSphere(b, a);
    return m ? flip(m) : null;
  }
  return sphereSphere(a, b);
}

function flip(m) {
  m.nx = -m.nx;
  m.ny = -m.ny;
  m.nz = -m.nz;
  return m;
}

/**
 * AABB vs AABB.
 *
 * Resolves along the axis of *least* penetration, for the same reason as in 2D:
 * a character walking across a tiled floor must be pushed up by the small
 * overlap, not sideways by the large one, or it catches on every seam.
 */
export function boxBox(a, b) {
  const dx = b.x - a.x;
  const px = a.hx + b.hx - Math.abs(dx);
  if (px <= 0) return null;

  const dy = b.y - a.y;
  const py = a.hy + b.hy - Math.abs(dy);
  if (py <= 0) return null;

  const dz = b.z - a.z;
  const pz = a.hz + b.hz - Math.abs(dz);
  if (pz <= 0) return null;

  if (px < py && px < pz) {
    const sign = dx < 0 ? -1 : 1;
    return {
      nx: sign, ny: 0, nz: 0,
      depth: px,
      cx: a.x + sign * a.hx,
      cy: clamp(b.y, a.y - a.hy, a.y + a.hy),
      cz: clamp(b.z, a.z - a.hz, a.z + a.hz),
    };
  }
  if (py < pz) {
    const sign = dy < 0 ? -1 : 1;
    return {
      nx: 0, ny: sign, nz: 0,
      depth: py,
      cx: clamp(b.x, a.x - a.hx, a.x + a.hx),
      cy: a.y + sign * a.hy,
      cz: clamp(b.z, a.z - a.hz, a.z + a.hz),
    };
  }
  const sign = dz < 0 ? -1 : 1;
  return {
    nx: 0, ny: 0, nz: sign,
    depth: pz,
    cx: clamp(b.x, a.x - a.hx, a.x + a.hx),
    cy: clamp(b.y, a.y - a.hy, a.y + a.hy),
    cz: a.z + sign * a.hz,
  };
}

export function sphereSphere(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const rsum = a.r + b.r;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq >= rsum * rsum) return null;

  const dist = Math.sqrt(distSq);
  if (dist === 0) {
    // Concentric: any normal separates them, and returning null would leave
    // them permanently stuck.
    return { nx: 0, ny: 1, nz: 0, depth: rsum, cx: a.x, cy: a.y, cz: a.z };
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  return {
    nx, ny, nz,
    depth: rsum - dist,
    cx: a.x + nx * a.r,
    cy: a.y + ny * a.r,
    cz: a.z + nz * a.r,
  };
}

/** Box (A) vs sphere (B). The normal points from the box toward the sphere. */
export function boxSphere(a, b) {
  const closestX = clamp(b.x, a.x - a.hx, a.x + a.hx);
  const closestY = clamp(b.y, a.y - a.hy, a.y + a.hy);
  const closestZ = clamp(b.z, a.z - a.hz, a.z + a.hz);

  const dx = b.x - closestX;
  const dy = b.y - closestY;
  const dz = b.z - closestZ;
  const distSq = dx * dx + dy * dy + dz * dz;

  if (distSq > b.r * b.r) return null;

  if (distSq > 1e-12) {
    const dist = Math.sqrt(distSq);
    return {
      nx: dx / dist, ny: dy / dist, nz: dz / dist,
      depth: b.r - dist,
      cx: closestX, cy: closestY, cz: closestZ,
    };
  }

  // The sphere's center is inside the box: push out through the nearest face.
  const ox = a.hx - Math.abs(b.x - a.x);
  const oy = a.hy - Math.abs(b.y - a.y);
  const oz = a.hz - Math.abs(b.z - a.z);

  if (ox < oy && ox < oz) {
    const sign = b.x < a.x ? -1 : 1;
    return { nx: sign, ny: 0, nz: 0, depth: ox + b.r, cx: a.x + sign * a.hx, cy: b.y, cz: b.z };
  }
  if (oy < oz) {
    const sign = b.y < a.y ? -1 : 1;
    return { nx: 0, ny: sign, nz: 0, depth: oy + b.r, cx: b.x, cy: a.y + sign * a.hy, cz: b.z };
  }
  const sign = b.z < a.z ? -1 : 1;
  return { nx: 0, ny: 0, nz: sign, depth: oz + b.r, cx: b.x, cy: b.y, cz: a.z + sign * a.hz };
}

// ---------------------------------------------------------------------------
// Point and ray queries
// ---------------------------------------------------------------------------

export function containsPoint(shape, x, y, z) {
  if (shape.kind === 'sphere') {
    const dx = x - shape.x;
    const dy = y - shape.y;
    const dz = z - shape.z;
    return dx * dx + dy * dy + dz * dz <= shape.r * shape.r;
  }
  return (
    x >= shape.x - shape.hx && x <= shape.x + shape.hx &&
    y >= shape.y - shape.hy && y <= shape.y + shape.hy &&
    z >= shape.z - shape.hz && z <= shape.z + shape.hz
  );
}

/**
 * Ray vs shape.
 * @param {Shape3} shape
 * @param {{x,y,z}} origin
 * @param {{x,y,z}} direction must be normalized
 * @returns {{ t, x, y, z, nx, ny, nz }|null}
 */
export function raycastShape(shape, origin, direction, maxDistance = Infinity) {
  return shape.kind === 'sphere'
    ? raycastSphere(shape, origin, direction, maxDistance)
    : raycastBox(shape, origin, direction, maxDistance);
}

/** Slab method, handling axis-aligned rays without dividing by zero. */
export function raycastBox(b, origin, direction, maxDistance = Infinity) {
  let tmin = 0;
  let tmax = maxDistance;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  const axes = [
    { o: origin.x, d: direction.x, min: b.x - b.hx, max: b.x + b.hx, axis: 0 },
    { o: origin.y, d: direction.y, min: b.y - b.hy, max: b.y + b.hy, axis: 1 },
    { o: origin.z, d: direction.z, min: b.z - b.hz, max: b.z + b.hz, axis: 2 },
  ];

  for (const { o, d, min, max, axis } of axes) {
    if (Math.abs(d) < 1e-12) {
      // Parallel to this slab: a miss here is a miss overall.
      if (o < min || o > max) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (min - o) * inv;
    let t2 = (max - o) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = axis === 0 ? sign : 0;
      ny = axis === 1 ? sign : 0;
      nz = axis === 2 ? sign : 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin > maxDistance) return null;
  return {
    t: tmin,
    x: origin.x + direction.x * tmin,
    y: origin.y + direction.y * tmin,
    z: origin.z + direction.z * tmin,
    nx, ny, nz,
  };
}

export function raycastSphere(s, origin, direction, maxDistance = Infinity) {
  const mx = origin.x - s.x;
  const my = origin.y - s.y;
  const mz = origin.z - s.z;

  const a = direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
  if (a < 1e-12) return null;
  const b = 2 * (mx * direction.x + my * direction.y + mz * direction.z);
  const c = mx * mx + my * my + mz * mz - s.r * s.r;

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  let t = (-b - sqrtDisc) / (2 * a);
  if (t < 0) t = (-b + sqrtDisc) / (2 * a);
  if (t < 0 || t > maxDistance) return null;

  const hx = origin.x + direction.x * t;
  const hy = origin.y + direction.y * t;
  const hz = origin.z + direction.z * t;
  const len = Math.hypot(hx - s.x, hy - s.y, hz - s.z) || 1;

  return { t, x: hx, y: hy, z: hz, nx: (hx - s.x) / len, ny: (hy - s.y) / len, nz: (hz - s.z) / len };
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
