/**
 * The built-in system set, in the order the scheduler will run them.
 *
 * `sjl describe --systems` prints this list at runtime. Reading it is the fastest
 * way to answer "does my code run before or after physics", which is the
 * question behind most ordering bugs in any engine.
 *
 * The 2D and 3D systems all run every frame, but each queries components the
 * other never touches — so a 2D game pays a map lookup per frame for the 3D
 * systems existing, and nothing more. That is what lets a scene mix a 3D world
 * with a 2D HUD without any mode flag.
 */

import { TransformFixedSystem, TransformSystem } from './transform.js';
import { Transform3DFixedSystem, Transform3DSystem } from './transform3d.js';
import {
  BehaviorFixedUpdateSystem,
  BehaviorUpdateSystem,
  BehaviorLateUpdateSystem,
} from './behavior.js';
import { PhysicsSystem } from './physics.js';
import { Physics3DSystem } from './physics3d.js';
import { SpriteAnimationSystem, TweenSystem } from './animation.js';
import {
  LifetimeSystem,
  HealthSystem,
  FollowSystem,
  CameraFollowSystem,
  ParticleSystem,
} from './gameplay.js';
import { CameraOrbitSystem } from './camera3d.js';
import { InputSystem, InputEndFrameSystem } from './input.js';
import { AudioSystem } from './audio.js';
import { RenderSystem, DebugDrawSystem, FrameEndSystem } from './render.js';
import { Render3DSystem } from './render3d.js';

export * from './transform.js';
export * from './transform3d.js';
export * from './behavior.js';
export * from './physics.js';
export * from './physics3d.js';
export * from './animation.js';
export * from './gameplay.js';
export * from './camera3d.js';
export * from './input.js';
export * from './audio.js';
export * from './render.js';
export * from './render3d.js';

/**
 * Every built-in system. Passed to `scheduler.addAll()` by the App.
 * @returns {import('../core/system.js').System[]}
 */
export function builtinSystems() {
  return [
    // preUpdate
    InputSystem,
    // fixedPre
    TransformFixedSystem,
    Transform3DFixedSystem,
    BehaviorFixedUpdateSystem,
    // fixedUpdate
    PhysicsSystem,
    Physics3DSystem,
    // update
    BehaviorUpdateSystem,
    SpriteAnimationSystem,
    TweenSystem,
    HealthSystem,
    ParticleSystem,
    LifetimeSystem,
    // lateUpdate
    BehaviorLateUpdateSystem,
    FollowSystem,
    CameraFollowSystem,
    CameraOrbitSystem,
    AudioSystem,
    // preRender
    TransformSystem,
    Transform3DSystem,
    // render — 3D first, so a 2D HUD composes on top
    Render3DSystem,
    RenderSystem,
    // postRender
    DebugDrawSystem,
    FrameEndSystem,
    InputEndFrameSystem,
  ];
}
