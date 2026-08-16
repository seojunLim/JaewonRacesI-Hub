/**
 * SJL Engine — public API.
 *
 * ```js
 * import { App, defineBehavior, Vec2 } from 'sjl-engine';
 * ```
 *
 * Importing this module registers every built-in component and behavior, so a
 * scene file can be loaded immediately afterwards.
 */

// Side-effect imports: these populate the global component and behavior
// registries. Order matters — components before behaviors, since some
// behaviors declare `requires` on components.
import './components/index.js';
import './behaviors/index.js';
import './behaviors/index3d.js';

// ---- Core -----------------------------------------------------------------
export { World, Entity } from './core/world.js';
export { Component, ComponentRegistry, components, defineComponent } from './core/component.js';
export {
  Behavior,
  BehaviorInstance,
  BehaviorRegistry,
  behaviors,
  defineBehavior,
  BEHAVIOR_HOOKS,
} from './core/behavior.js';
export { System, Scheduler, defineSystem, Phase, PHASE_ORDER, FIXED_PHASES, Order } from './core/system.js';
export { EventBus, EngineEvents, EngineEventPayloads } from './core/events.js';
export { Time, Timer } from './core/time.js';
export {
  FIELD_TYPES,
  SchemaError,
  instantiate as instantiateSchema,
  coerce,
  serialize as serializeField,
  serializeObject,
  validateValue,
  validateObject,
  schemaToJSONSchema,
  fieldToJSONSchema,
  describeField,
  closestMatch,
} from './core/schema.js';

// ---- Math -----------------------------------------------------------------
export * as Vec2 from './math/vec2.js';
export * as Vec3 from './math/vec3.js';
export * as Quat from './math/quat.js';
export * as Mat3 from './math/mat3.js';
export * as Mat4 from './math/mat4.js';
export * as Rect from './math/rect.js';
export * as Color from './math/color.js';
export { Random, hashString } from './math/random.js';
export * from './math/scalar.js';

// ---- Components -----------------------------------------------------------
export {
  Transform,
  WorldTransform,
  localMatrix,
  worldPosition,
  setWorldPosition,
  worldToLocal,
  localToWorld,
  up,
  right,
} from './components/transform.js';
export {
  Sprite,
  ShapeRenderer,
  Text,
  Camera,
  CameraFollow,
  TilemapRenderer,
  ParticleEmitter,
} from './components/rendering.js';
export {
  Rigidbody,
  BoxCollider,
  CircleCollider,
  PhysicsSettings,
  Layers,
  maskOf,
  maskExcept,
} from './components/physics.js';
export {
  SpriteAnimator,
  Tween,
  AudioSource,
  Lifetime,
  Health,
  Behaviors,
  Follow,
} from './components/gameplay.js';

// ---- 3D components --------------------------------------------------------
export {
  Transform3D,
  WorldTransform3D,
  localMatrix3D,
  forward,
  rightDir,
  upDir,
  forwardFlat,
  worldPosition3D,
  setWorldPosition3D,
  worldToLocal3D,
  localToWorld3D,
  lookAt3D,
} from './components/transform3d.js';
export {
  MeshRenderer,
  Camera3D,
  Light,
  Skybox,
  CameraOrbit,
} from './components/rendering3d.js';
export {
  Rigidbody3D,
  BoxCollider3D,
  SphereCollider,
  Physics3DSettings,
  CharacterController3D,
} from './components/physics3d.js';
export { COMPONENTS_2D, COMPONENTS_3D } from './components/index.js';

// ---- Systems --------------------------------------------------------------
export {
  builtinSystems,
  TransformSystem,
  TransformFixedSystem,
  syncTransforms,
  PhysicsSystem,
  getPhysics,
  refreshPhysicsQueries,
  RenderSystem,
  DebugDrawSystem,
  buildDrawList,
  activeCamera,
  InputSystem,
  getInput,
  AudioSystem,
  getAudio,
  playSound,
  stopSource,
  SpriteAnimationSystem,
  TweenSystem,
  playClip,
  tweenTo,
  LifetimeSystem,
  HealthSystem,
  FollowSystem,
  CameraFollowSystem,
  ParticleSystem,
  RENDERER_RESOURCE,
  INPUT_RESOURCE,
  AUDIO_RESOURCE,
  PHYSICS_RESOURCE,
  // 3D
  Transform3DSystem,
  Transform3DFixedSystem,
  syncTransforms3D,
  Physics3DSystem,
  getPhysics3D,
  refreshPhysics3DQueries,
  groundCheck3D,
  Render3DSystem,
  buildMeshDrawList,
  activeCamera3D,
  computeView3D,
  gatherLights,
  projectToNDC,
  screenToRay,
  CameraOrbitSystem,
  FrameEndSystem,
  PHYSICS3D_RESOURCE,
} from './systems/index.js';

// ---- Physics 3D -----------------------------------------------------------
export { Physics3DWorld } from './physics3d/world.js';
export { SpatialHash3D } from './physics3d/broadphase.js';
export {
  box3,
  sphere3,
  collide as collide3D,
  boxBox as boxBox3D,
  sphereSphere,
  boxSphere,
  raycastShape as raycastShape3D,
} from './physics3d/shapes.js';

// ---- Physics --------------------------------------------------------------
export { PhysicsWorld } from './physics/world.js';
export { SpatialHash } from './physics/broadphase.js';
export {
  box,
  circle,
  collide,
  aabbOf,
  aabbOverlap,
  boxBox,
  circleCircle,
  boxCircle,
  raycastShape,
  raycastBox,
  raycastCircle,
  containsPoint,
} from './physics/shapes.js';

// ---- Rendering ------------------------------------------------------------
export {
  Renderer,
  computeView,
  viewBounds,
  worldToScreen,
  screenToWorld,
  sortDrawList,
  isVisible,
} from './render/renderer.js';
export { HeadlessRenderer, Frame } from './render/headless.js';
export { Canvas2DRenderer } from './render/canvas2d.js';
export { WebGL2Renderer, isWebGL2Available } from './render/webgl2.js';
export { WebGL3DRenderer, isWebGL3DAvailable, MAX_LIGHTS } from './render/webgl3d.js';
export { getPrimitive, createMesh, PRIMITIVE_NAMES, subdividedPlane } from './render/mesh.js';

// ---- Input & audio --------------------------------------------------------
export { Input, DEFAULT_ACTIONS } from './input/input.js';
export { AudioBackend, SilentAudio, WebAudio } from './audio/audio.js';

// ---- Assets ---------------------------------------------------------------
export { Assets, ASSET_TYPES, gridFrames, gridFrameNames } from './assets/assets.js';

// ---- Scenes ---------------------------------------------------------------
export {
  Scene,
  SceneValidationError,
  loadScene,
  instantiate,
  mergePrefab,
  addBehavior,
  getBehavior,
  removeBehavior,
  ENTITY_KEYS,
  SCENE_KEYS,
} from './scene/scene.js';
export { validateScene, formatIssues } from './scene/validate.js';
export { serializeWorld, serializeEntity, stringifyScene } from './scene/serialize.js';

// ---- Runtime --------------------------------------------------------------
export { App } from './runtime/app.js';

// ---- Introspection --------------------------------------------------------
export { describeEngine, describeMarkdown, describeCompact } from './tools/describe.js';
export { sceneJSONSchema, projectJSONSchema } from './tools/jsonschema.js';

export { VERSION } from './version.js';
