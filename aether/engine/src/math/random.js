/**
 * Seeded pseudo-random numbers.
 *
 * `Math.random()` is banned everywhere inside the engine. Every stochastic
 * decision goes through a seeded stream so that a headless run and a browser
 * run of the same scene produce byte-identical results — which is what lets an
 * agent assert on simulation output in a test instead of eyeballing a canvas.
 */

/**
 * mulberry32: 32 bits of state, good statistical quality for games, and short
 * enough to verify by reading. Period is 2^32.
 */
export class Random {
  /** @param {number|string} seed */
  constructor(seed = 0x9e3779b9) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.state = this.seed;
  }

  /** Restart the stream from its original seed. */
  reset() {
    this.state = this.seed;
    return this;
  }

  /** @returns {number} uniform in [0, 1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] — both ends inclusive. */
  int(min, max) {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /** @param {number} p probability of `true`, default 0.5 */
  bool(p = 0.5) {
    return this.next() < p;
  }

  /** `-1` or `1`. */
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** @template T @param {T[]} array @returns {T|undefined} */
  pick(array) {
    if (array.length === 0) return undefined;
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * Pick by relative weight. `weights[i]` corresponds to `array[i]`; weights
   * need not sum to 1.
   * @template T @param {T[]} array @param {number[]} weights
   */
  pickWeighted(array, weights) {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return undefined;
    let roll = this.next() * total;
    for (let i = 0; i < array.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) return array[i];
    }
    return array[array.length - 1];
  }

  /** Fisher-Yates, in place. Deterministic for a given seed and length. */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  /** A point on the unit circle. */
  onUnitCircle(out = { x: 0, y: 0 }) {
    const a = this.next() * Math.PI * 2;
    out.x = Math.cos(a);
    out.y = Math.sin(a);
    return out;
  }

  /** A point uniformly distributed inside the unit disc. */
  inUnitCircle(out = { x: 0, y: 0 }) {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next());
    out.x = Math.cos(a) * r;
    out.y = Math.sin(a) * r;
    return out;
  }

  /** Box-Muller normal deviate. */
  normal(mean = 0, stdDev = 1) {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * A child stream derived from this one. Give each subsystem its own child so
   * that adding a particle effect cannot shift the enemy AI's rolls.
   * @param {string} label
   */
  fork(label = '') {
    return new Random((this.state ^ hashString(label)) >>> 0);
  }

  /** Capture/restore for save games and rollback netcode. */
  saveState() {
    return { seed: this.seed, state: this.state };
  }

  loadState(snapshot) {
    this.seed = snapshot.seed >>> 0;
    this.state = snapshot.state >>> 0;
    return this;
  }
}

/** FNV-1a. Lets scenes use readable string seeds like `"level-1"`. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A default stream for throwaway work. Prefer `world.random` in game code. */
export const defaultRandom = new Random('sjl-engine');
