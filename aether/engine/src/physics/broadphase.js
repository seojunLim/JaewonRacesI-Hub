/**
 * Broadphase — a uniform spatial hash.
 *
 * Testing every collider against every other is O(n^2); at 400 colliders that
 * is 80,000 narrow-phase calls per step, which is where a 2D engine's frame
 * budget usually goes. The hash buckets colliders by grid cell so only genuine
 * neighbours are ever compared.
 *
 * Pairs come out in a **deterministic order** (ascending by the proxies' insertion
 * index, deduplicated), not in whatever order the hash happens to produce. This
 * matters: the impulse solver is order-dependent, so a nondeterministic pair
 * order would make two runs of the same scene diverge.
 */

import { aabbOverlap } from './shapes.js';

/**
 * @typedef {object} Proxy
 * @property {number} id        entity id
 * @property {number} index     insertion index, used for stable ordering
 * @property {object} aabb      `{ minX, minY, maxX, maxY }`
 * @property {number} layer     layer bit
 * @property {number} mask      layers this proxy collides with
 * @property {*} data           user payload (the collider record)
 */

export class SpatialHash {
  /** @param {number} cellSize roughly the size of a typical collider */
  constructor(cellSize = 2) {
    this.cellSize = cellSize;
    /** @type {Map<number, Proxy[]>} */
    this.cells = new Map();
    /** @type {Proxy[]} */
    this.proxies = [];
  }

  clear() {
    this.cells.clear();
    this.proxies.length = 0;
  }

  /**
   * Pack a pair of cell coordinates into one integer key.
   * Coordinates are offset into the positive range and interleaved, which keeps
   * the key a small int (fast Map lookups) for any world within ±32k cells.
   */
  static key(cx, cy) {
    return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
  }

  /** @param {Proxy} proxy */
  insert(proxy) {
    proxy.index = this.proxies.length;
    this.proxies.push(proxy);

    const inv = 1 / this.cellSize;
    const minCx = Math.floor(proxy.aabb.minX * inv);
    const minCy = Math.floor(proxy.aabb.minY * inv);
    const maxCx = Math.floor(proxy.aabb.maxX * inv);
    const maxCy = Math.floor(proxy.aabb.maxY * inv);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = SpatialHash.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(proxy);
      }
    }
    return proxy;
  }

  /**
   * Every candidate pair, deduplicated and in stable order.
   *
   * A pair is emitted only if:
   *   - the two AABBs actually overlap (cheap reject before narrow phase)
   *   - their layer masks agree in both directions
   *   - `filter(a, b)` returns true, if a filter was supplied
   *
   * @param {(a: Proxy, b: Proxy) => boolean} [filter]
   * @returns {Array<[Proxy, Proxy]>}
   */
  pairs(filter) {
    /** @type {Set<number>} */
    const seen = new Set();
    /** @type {Array<[Proxy, Proxy]>} */
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
    // Bucket iteration order depends on insertion history, so sort to make the
    // solver's input identical across runs.
    out.sort((p, q) => p[0].index - q[0].index || p[1].index - q[1].index);
    return out;
  }

  /**
   * Every proxy whose AABB overlaps the given box.
   * @returns {Proxy[]} in stable insertion order
   */
  queryAABB(minX, minY, maxX, maxY, mask = -1) {
    const inv = 1 / this.cellSize;
    const minCx = Math.floor(minX * inv);
    const minCy = Math.floor(minY * inv);
    const maxCx = Math.floor(maxX * inv);
    const maxCy = Math.floor(maxY * inv);
    const box = { minX, minY, maxX, maxY };

    const found = new Set();
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(SpatialHash.key(cx, cy));
        if (!bucket) continue;
        for (const proxy of bucket) {
          if ((proxy.layer & mask) === 0) continue;
          if (!aabbOverlap(proxy.aabb, box)) continue;
          found.add(proxy);
        }
      }
    }
    return [...found].sort((a, b) => a.index - b.index);
  }

  /** Every proxy overlapping a point. */
  queryPoint(x, y, mask = -1) {
    return this.queryAABB(x, y, x, y, mask);
  }

  /**
   * Proxies along a ray, in stable order. This walks the ray's bounding box
   * rather than performing a proper DDA traversal — simpler, and the exact
   * ordering is the raycast caller's job anyway since it sorts by hit distance.
   */
  queryRay(ox, oy, dx, dy, maxDistance, mask = -1) {
    const ex = ox + dx * maxDistance;
    const ey = oy + dy * maxDistance;
    return this.queryAABB(
      Math.min(ox, ex),
      Math.min(oy, ey),
      Math.max(ox, ex),
      Math.max(oy, ey),
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
