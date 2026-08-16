/**
 * 3D broadphase — a uniform spatial hash.
 *
 * The 2D version's reasoning applies with more force here: a 3D scene spreads
 * colliders over a volume, so all-pairs testing degrades faster. Cells are
 * cubes; a collider is inserted into every cell its AABB touches.
 *
 * Pairs come out in a **deterministic order** (ascending by insertion index,
 * deduplicated). The impulse solver is order-dependent, so a hash-order pair
 * list would make two runs of the same scene diverge.
 */

import { aabbOverlap } from './shapes.js';

export class SpatialHash3D {
  /** @param {number} cellSize roughly the size of a typical collider */
  constructor(cellSize = 2) {
    this.cellSize = cellSize;
    /** @type {Map<string, Array>} */
    this.cells = new Map();
    this.proxies = [];
  }

  clear() {
    this.cells.clear();
    this.proxies.length = 0;
  }

  /**
   * Cell key.
   *
   * Bit-packing three coordinates into one 32-bit int would overflow, so this
   * uses a string. It measures slower in a microbenchmark and is not the
   * bottleneck in any realistic scene — the narrow phase is.
   */
  static key(cx, cy, cz) {
    return `${cx},${cy},${cz}`;
  }

  insert(proxy) {
    proxy.index = this.proxies.length;
    this.proxies.push(proxy);

    const inv = 1 / this.cellSize;
    const minCx = Math.floor(proxy.aabb.minX * inv);
    const minCy = Math.floor(proxy.aabb.minY * inv);
    const minCz = Math.floor(proxy.aabb.minZ * inv);
    const maxCx = Math.floor(proxy.aabb.maxX * inv);
    const maxCy = Math.floor(proxy.aabb.maxY * inv);
    const maxCz = Math.floor(proxy.aabb.maxZ * inv);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = SpatialHash3D.key(cx, cy, cz);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(proxy);
        }
      }
    }
    return proxy;
  }

  /**
   * Every candidate pair, deduplicated and in stable order.
   * @param {(a, b) => boolean} [filter]
   */
  pairs(filter) {
    const seen = new Set();
    const out = [];
    const n = this.proxies.length;

    for (const bucket of this.cells.values()) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          let a = bucket[i];
          let b = bucket[j];
          if (a.index > b.index) {
            const tmp = a;
            a = b;
            b = tmp;
          }
          // A collider spanning several cells would otherwise report the same
          // pair once per shared cell.
          const pairKey = a.index * n + b.index;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);

          if ((a.layer & b.mask) === 0 || (b.layer & a.mask) === 0) continue;
          if (!aabbOverlap(a.aabb, b.aabb)) continue;
          if (filter && !filter(a, b)) continue;
          out.push([a, b]);
        }
      }
    }
    out.sort((p, q) => p[0].index - q[0].index || p[1].index - q[1].index);
    return out;
  }

  /** Every proxy whose AABB overlaps the given box, in stable order. */
  queryAABB(minX, minY, minZ, maxX, maxY, maxZ, mask = -1) {
    const inv = 1 / this.cellSize;
    const box = { minX, minY, minZ, maxX, maxY, maxZ };
    const found = new Set();

    for (let cx = Math.floor(minX * inv); cx <= Math.floor(maxX * inv); cx++) {
      for (let cy = Math.floor(minY * inv); cy <= Math.floor(maxY * inv); cy++) {
        for (let cz = Math.floor(minZ * inv); cz <= Math.floor(maxZ * inv); cz++) {
          const bucket = this.cells.get(SpatialHash3D.key(cx, cy, cz));
          if (!bucket) continue;
          for (const proxy of bucket) {
            if ((proxy.layer & mask) === 0) continue;
            if (!aabbOverlap(proxy.aabb, box)) continue;
            found.add(proxy);
          }
        }
      }
    }
    return [...found].sort((a, b) => a.index - b.index);
  }

  queryPoint(x, y, z, mask = -1) {
    return this.queryAABB(x, y, z, x, y, z, mask);
  }

  /**
   * Proxies along a ray. Walks the ray's bounding box rather than doing a true
   * 3D DDA — simpler, and the caller sorts by hit distance anyway.
   */
  queryRay(origin, direction, maxDistance, mask = -1) {
    const ex = origin.x + direction.x * maxDistance;
    const ey = origin.y + direction.y * maxDistance;
    const ez = origin.z + direction.z * maxDistance;
    return this.queryAABB(
      Math.min(origin.x, ex), Math.min(origin.y, ey), Math.min(origin.z, ez),
      Math.max(origin.x, ex), Math.max(origin.y, ey), Math.max(origin.z, ez),
      mask,
    );
  }

  get stats() {
    let maxBucket = 0;
    let total = 0;
    for (const bucket of this.cells.values()) {
      maxBucket = Math.max(maxBucket, bucket.length);
      total += bucket.length;
    }
    return {
      proxies: this.proxies.length,
      cells: this.cells.size,
      maxBucket,
      averageBucket: this.cells.size ? total / this.cells.size : 0,
    };
  }
}
