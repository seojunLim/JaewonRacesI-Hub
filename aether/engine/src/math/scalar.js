/** Scalar helpers and easing curves. */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;
export const EPSILON = 1e-6;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Inverse lerp: where does `v` sit between `a` and `b`, as 0..1? */
export const inverseLerp = (a, b, v) => (a === b ? 0 : clamp01((v - a) / (b - a)));

/** Map `v` from one range to another. */
export const remap = (v, inMin, inMax, outMin, outMax) =>
  lerp(outMin, outMax, inverseLerp(inMin, inMax, v));

export const approximately = (a, b, epsilon = EPSILON) => Math.abs(a - b) <= epsilon;

export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/** Positive modulo — `mod(-1, 4)` is `3`, unlike `-1 % 4`. */
export const mod = (a, n) => ((a % n) + n) % n;

/**
 * Wrap an angle into [-PI, PI).
 *
 * Note the half-open end: exactly -PI wraps to -PI, not +PI. The two are the
 * same direction, and special-casing the boundary would only trade one
 * arbitrary answer for another while adding a float-equality check.
 */
export const wrapAngle = (radians) => mod(radians + Math.PI, TAU) - Math.PI;

/** Shortest signed angular delta from `a` to `b`. */
export const deltaAngle = (a, b) => wrapAngle(b - a);

export function lerpAngle(a, b, t) {
  return a + deltaAngle(a, b) * t;
}

export function moveTowardsAngle(current, target, maxDelta) {
  const delta = deltaAngle(current, target);
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/**
 * Frame-rate independent exponential smoothing.
 *
 * `lerp(a, b, 0.1)` in an update loop is a bug waiting for a frame-rate change;
 * this converges at the same real-world rate regardless of `dt`. `halfLife` is
 * the time in seconds for the remaining distance to halve.
 */
export function damp(current, target, halfLife, dt) {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/** Hermite smoothstep between two edges. */
export function smoothStep(edge0, edge1, v) {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function smootherStep(edge0, edge1, v) {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Ping-pong `v` between 0 and `length`. */
export function pingPong(v, length) {
  const t = mod(v, length * 2);
  return length - Math.abs(t - length);
}

export const nextPowerOfTwo = (v) => {
  if (v <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(v));
};

export const isPowerOfTwo = (v) => v > 0 && (v & (v - 1)) === 0;

/**
 * Easing functions, keyed by name so scene JSON can say `"ease": "outBounce"`
 * without shipping code. All take and return 0..1.
 */
export const Easing = {
  linear: (t) => t,

  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  inCubic: (t) => t * t * t,
  outCubic: (t) => --t * t * t + 1,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - --t * t * t * t,
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t),

  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) =>
    t === 0 ? 0
    : t === 1 ? 1
    : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, -20 * t + 10)) / 2,

  inCirc: (t) => 1 - Math.sqrt(1 - t * t),
  outCirc: (t) => Math.sqrt(1 - --t * t),

  inBack: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  outBack: (t) => 1 + 2.70158 * --t * t * t + 1.70158 * t * t,

  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  inBounce: (t) => 1 - Easing.outBounce(1 - t),

  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * TAU) / 3) + 1;
  },
  inElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin(((t * 10 - 10.75) * TAU) / 3);
  },
};

/** Look up an easing by name, falling back to linear for unknown names. */
export function getEasing(name) {
  return Easing[name] ?? Easing.linear;
}

export const EASING_NAMES = Object.keys(Easing);
