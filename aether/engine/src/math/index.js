/**
 * Math namespace.
 *
 * Modules are exported under namespaces (`Vec2.add`, `Mat3.multiply`) rather
 * than flattened, because `add` and `lerp` mean different things per type and
 * ambiguous imports are exactly the kind of thing that produces plausible but
 * wrong generated code.
 */

export * as Vec2 from './vec2.js';
export * as Vec3 from './vec3.js';
export * as Quat from './quat.js';
export * as Mat3 from './mat3.js';
export * as Mat4 from './mat4.js';
export * as Rect from './rect.js';
export * as Color from './color.js';

export { Random, hashString, defaultRandom } from './random.js';

export {
  DEG2RAD,
  RAD2DEG,
  TAU,
  EPSILON,
  clamp,
  clamp01,
  lerp,
  sign,
  inverseLerp,
  remap,
  approximately,
  moveTowards,
  mod,
  wrapAngle,
  deltaAngle,
  lerpAngle,
  moveTowardsAngle,
  damp,
  smoothStep,
  smootherStep,
  pingPong,
  nextPowerOfTwo,
  isPowerOfTwo,
  Easing,
  getEasing,
  EASING_NAMES,
} from './scalar.js';
