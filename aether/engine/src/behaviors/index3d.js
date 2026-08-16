/**
 * Ready-made 3D behaviors.
 *
 * The same bar as the 2D set: these are the ones every 3D project writes on day
 * one, and shipping them means a scene file can be a complete, playable 3D game
 * with no game code at all.
 */

import { defineBehavior } from '../core/behavior.js';
import { getInput } from '../systems/input.js';
import { groundCheck3D } from '../systems/physics3d.js';
import { forwardFlat, rightDir, lookAt3D } from '../components/transform3d.js';
import { instantiate } from '../scene/scene.js';
import { clamp, moveTowards, DEG2RAD } from '../math/scalar.js';
import * as Vec3 from '../math/vec3.js';
import * as Quat from '../math/quat.js';

const tempForward = Vec3.vec3();
const tempRight = Vec3.vec3();

defineBehavior({
  name: 'FirstPersonController',
  description:
    'Mouse-look plus WASD movement on a capsule-ish body. Put it on the entity that ' +
    'carries the Camera3D, or on a body with the camera as a child.',
  requires: ['Transform3D', 'Rigidbody3D'],
  props: {
    speed: { type: 'number', default: 6, min: 0 },
    sprintMultiplier: { type: 'number', default: 1.6, min: 1 },
    acceleration: { type: 'number', default: 60, min: 0, description: 'Ground acceleration' },
    airAcceleration: { type: 'number', default: 12, min: 0 },
    jumpHeight: { type: 'number', default: 1.4, min: 0, description: 'Peak height in world units' },
    coyoteTime: { type: 'number', default: 0.1, min: 0 },
    jumpBuffer: { type: 'number', default: 0.12, min: 0 },
    lookSensitivity: { type: 'number', default: 0.15, min: 0, description: 'Degrees per pixel' },
    /** Mouse-look only applies while a button is held, unless pointer lock is on. */
    requireMouseDown: { type: 'boolean', default: true },
    maxPitch: { type: 'number', default: 85, min: 0, max: 89 },
    moveXAction: { type: 'string', default: 'moveX' },
    moveYAction: { type: 'string', default: 'moveY' },
    jumpAction: { type: 'string', default: 'jump' },
  },
  onStart({ entity, state }) {
    const t = entity.require('Transform3D');
    state.yaw = t.rotation.y;
    state.pitch = t.rotation.x;
    state.coyote = 0;
    state.buffer = 0;
  },
  onUpdate({ entity, props, state, world }) {
    const input = getInput(world);
    // Look runs on the variable update: it should feel as smooth as the display
    // allows, and it does not affect the simulation.
    const looking = !props.requireMouseDown || input.mouseButton(0) || isPointerLocked();
    if (looking) {
      state.yaw -= input.mouse.deltaX * props.lookSensitivity;
      state.pitch = clamp(
        state.pitch - input.mouse.deltaY * props.lookSensitivity,
        -props.maxPitch,
        props.maxPitch,
      );
    }
    const t = entity.require('Transform3D');
    t.rotation.y = state.yaw;
    t.rotation.x = state.pitch;
    t.rotation.z = 0;
  },
  onFixedUpdate({ entity, props, state, world, dt }) {
    const input = getInput(world);
    const body = entity.require('Rigidbody3D');
    const wt = entity.get('WorldTransform3D');
    if (!wt) return;

    const ground = groundCheck3D(entity);
    const grounded = ground?.grounded || body.grounded;
    if (grounded) state.coyote = props.coyoteTime;
    else state.coyote = Math.max(0, state.coyote - dt);

    if (input.pressed(props.jumpAction)) state.buffer = props.jumpBuffer;
    else state.buffer = Math.max(0, state.buffer - dt);

    // Movement is relative to where the body is facing, flattened so looking up
    // does not slow you down or launch you.
    forwardFlat(wt, tempForward);
    rightDir(wt, tempRight);
    tempRight.y = 0;
    Vec3.normalize(tempRight, tempRight);

    const forwardInput = input.axis(props.moveYAction);
    const strafeInput = input.axis(props.moveXAction);

    let desiredX = tempForward.x * forwardInput + tempRight.x * strafeInput;
    let desiredZ = tempForward.z * forwardInput + tempRight.z * strafeInput;
    const length = Math.hypot(desiredX, desiredZ);
    if (length > 1) {
      desiredX /= length;
      desiredZ /= length;
    }

    const speed = props.speed * (input.key('ShiftLeft') ? props.sprintMultiplier : 1);
    const accel = grounded ? props.acceleration : props.airAcceleration;
    body.velocity.x = accel > 0 ? moveTowards(body.velocity.x, desiredX * speed, accel * dt) : desiredX * speed;
    body.velocity.z = accel > 0 ? moveTowards(body.velocity.z, desiredZ * speed, accel * dt) : desiredZ * speed;
    if (length > 0) body.sleeping = false;

    const gravity = world.singleton('Physics3DSettings')?.gravity ?? { x: 0, y: -20, z: 0 };
    if (state.buffer > 0 && state.coyote > 0) {
      // v = sqrt(2 * g * h), so `jumpHeight` stays correct if gravity changes.
      body.velocity.y = Math.sqrt(2 * Math.abs(gravity.y) * props.jumpHeight);
      state.buffer = 0;
      state.coyote = 0;
      body.sleeping = false;
      body.grounded = false;
    }
  },
});

defineBehavior({
  name: 'ThirdPersonController',
  description:
    'Moves a character relative to the active camera and turns it to face travel. ' +
    'Pair with a CameraOrbit camera targeting the same entity.',
  requires: ['Transform3D', 'Rigidbody3D'],
  props: {
    speed: { type: 'number', default: 6, min: 0 },
    acceleration: { type: 'number', default: 45, min: 0 },
    airAcceleration: { type: 'number', default: 10, min: 0 },
    jumpHeight: { type: 'number', default: 1.6, min: 0 },
    turnHalfLife: { type: 'number', default: 0.06, min: 0, description: 'Facing smoothing' },
    coyoteTime: { type: 'number', default: 0.1, min: 0 },
    moveXAction: { type: 'string', default: 'moveX' },
    moveYAction: { type: 'string', default: 'moveY' },
    jumpAction: { type: 'string', default: 'jump' },
  },
  onStart({ state }) {
    state.coyote = 0;
    state.facing = 0;
  },
  onFixedUpdate({ entity, props, state, world, dt }) {
    const input = getInput(world);
    const body = entity.require('Rigidbody3D');
    const transform = entity.require('Transform3D');

    const ground = groundCheck3D(entity);
    const grounded = ground?.grounded || body.grounded;
    state.coyote = grounded ? props.coyoteTime : Math.max(0, state.coyote - dt);

    // Input is interpreted in the camera's frame, which is what makes "push
    // forward" mean "away from the camera" rather than "along world -z".
    const camera = world.first('Camera3D');
    const cameraYaw = camera?.get('WorldTransform3D')?.rotation.y ?? 0;
    const yawRad = cameraYaw * DEG2RAD;

    const forwardX = -Math.sin(yawRad);
    const forwardZ = -Math.cos(yawRad);
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);

    const forwardInput = input.axis(props.moveYAction);
    const strafeInput = input.axis(props.moveXAction);

    let dirX = forwardX * forwardInput + rightX * strafeInput;
    let dirZ = forwardZ * forwardInput + rightZ * strafeInput;
    const length = Math.hypot(dirX, dirZ);
    if (length > 1) {
      dirX /= length;
      dirZ /= length;
    }

    const accel = grounded ? props.acceleration : props.airAcceleration;
    body.velocity.x = moveTowards(body.velocity.x, dirX * props.speed, accel * dt);
    body.velocity.z = moveTowards(body.velocity.z, dirZ * props.speed, accel * dt);

    if (length > 0.01) {
      body.sleeping = false;
      const targetFacing = Math.atan2(-dirX, -dirZ) / DEG2RAD;
      // Take the short way round, or turning past 180° spins the character.
      let delta = ((targetFacing - transform.rotation.y + 540) % 360) - 180;
      transform.rotation.y += delta * (1 - Math.pow(2, -dt / Math.max(props.turnHalfLife, 1e-4)));
    }

    if (input.pressed(props.jumpAction) && state.coyote > 0) {
      const gravity = world.singleton('Physics3DSettings')?.gravity ?? { x: 0, y: -20, z: 0 };
      body.velocity.y = Math.sqrt(2 * Math.abs(gravity.y) * props.jumpHeight);
      state.coyote = 0;
      body.sleeping = false;
      body.grounded = false;
    }
  },
});

defineBehavior({
  name: 'LookAt3D',
  description: 'Rotates the entity to face a target entity every frame.',
  requires: ['Transform3D'],
  props: {
    target: { type: 'entity', description: 'Scene id of the entity to face' },
    offset: { type: 'vec3', default: [0, 0, 0] },
    /** Ignore the height difference, so a turret does not tilt. */
    flat: { type: 'boolean', default: false },
  },
  onUpdate({ entity, props, world }) {
    if (!props.target) return;
    const target = world.findById(props.target) ?? world.findByName(props.target);
    if (!target?.alive) return;

    const targetTransform = target.get('WorldTransform3D') ?? target.get('Transform3D');
    if (!targetTransform) return;

    const point = {
      x: targetTransform.position.x + props.offset.x,
      y: targetTransform.position.y + props.offset.y,
      z: targetTransform.position.z + props.offset.z,
    };
    if (props.flat) {
      point.y = (entity.get('WorldTransform3D') ?? entity.get('Transform3D')).position.y;
    }
    lookAt3D(entity, point);
  },
});

defineBehavior({
  name: 'Spin3D',
  description: 'Rotates the entity at a constant rate around each axis.',
  requires: ['Transform3D'],
  props: {
    degreesPerSecond: { type: 'vec3', default: [0, 90, 0] },
  },
  onUpdate({ entity, props, dt }) {
    const t = entity.require('Transform3D');
    t.rotation.x += props.degreesPerSecond.x * dt;
    t.rotation.y += props.degreesPerSecond.y * dt;
    t.rotation.z += props.degreesPerSecond.z * dt;
  },
});

defineBehavior({
  name: 'Hover3D',
  description: 'Bobs the entity up and down around its starting height.',
  requires: ['Transform3D'],
  props: {
    amplitude: { type: 'number', default: 0.25 },
    frequency: { type: 'number', default: 1, description: 'Cycles per second' },
    phase: { type: 'number', default: 0, description: 'Offset in cycles, 0..1' },
  },
  onStart({ entity, state }) {
    state.originY = entity.require('Transform3D').position.y;
    state.elapsed = 0;
  },
  onUpdate({ entity, props, state, dt }) {
    state.elapsed += dt;
    const offset = Math.sin((state.elapsed * props.frequency + props.phase) * Math.PI * 2);
    entity.require('Transform3D').position.y = state.originY + offset * props.amplitude;
  },
});

defineBehavior({
  name: 'Patrol3D',
  description: 'Moves back and forth between two points along one axis.',
  requires: ['Transform3D'],
  props: {
    axis: { type: 'enum', values: ['x', 'y', 'z'], default: 'x' },
    distance: { type: 'number', default: 4, min: 0, description: 'Half-range from the start' },
    speed: { type: 'number', default: 2, min: 0 },
    startDirection: { type: 'int', default: 1 },
  },
  onStart({ entity, state, props }) {
    state.origin = entity.require('Transform3D').position[props.axis];
    state.dir = props.startDirection >= 0 ? 1 : -1;
  },
  onFixedUpdate({ entity, props, state, dt }) {
    const t = entity.require('Transform3D');
    const current = t.position[props.axis];
    const next = current + props.speed * state.dir * dt;

    if (next > state.origin + props.distance) state.dir = -1;
    else if (next < state.origin - props.distance) state.dir = 1;

    t.position[props.axis] = current + props.speed * state.dir * dt;

    // A moving platform must be kinematic and must report a velocity, or the
    // solver will not carry anything standing on it.
    const body = entity.get('Rigidbody3D');
    if (body?.type === 'kinematic') {
      body.velocity.x = props.axis === 'x' ? props.speed * state.dir : 0;
      body.velocity.y = props.axis === 'y' ? props.speed * state.dir : 0;
      body.velocity.z = props.axis === 'z' ? props.speed * state.dir : 0;
    }
  },
});

defineBehavior({
  name: 'KillPlaneY',
  description: 'Fires an event, or destroys the entity, once it falls below a height.',
  requires: ['Transform3D'],
  props: {
    y: { type: 'number', default: -20 },
    event: { type: 'string', default: '', description: 'Event to queue instead of destroying' },
    /** Move the entity back to where it started instead of destroying it. */
    respawn: { type: 'boolean', default: false },
  },
  onStart({ entity, state }) {
    const t = entity.require('Transform3D');
    state.start = { x: t.position.x, y: t.position.y, z: t.position.z };
  },
  onFixedUpdate({ entity, props, state, world }) {
    const t = entity.require('Transform3D');
    if (t.position.y >= props.y) return;

    if (props.event) world.events.queue(props.event, { entity });

    if (props.respawn) {
      t.position.x = state.start.x;
      t.position.y = state.start.y;
      t.position.z = state.start.z;
      const body = entity.get('Rigidbody3D');
      if (body) {
        body.velocity.x = 0;
        body.velocity.y = 0;
        body.velocity.z = 0;
      }
      return;
    }
    if (!props.event) world.destroy(entity.id);
  },
});

defineBehavior({
  name: 'Collect3D',
  description:
    'Destroys this entity when a tagged entity enters its trigger, optionally firing ' +
    'an event. The 3D counterpart of DestroyOnTrigger.',
  props: {
    tag: { type: 'string', default: 'player', description: 'Required tag on the other entity' },
    event: { type: 'string', default: '', description: 'World event to queue on pickup' },
    sound: { type: 'asset', assetType: 'audio' },
  },
  onTriggerEnter({ entity, other, props, world }) {
    if (props.tag && !other.hasTag(props.tag)) return;
    if (props.sound) world.getResource('audio')?.play(props.sound, {});
    if (props.event) world.events.queue(props.event, { entity, other });
    world.destroy(entity.id);
  },
});

defineBehavior({
  name: 'Shooter3D',
  description: 'Spawns a projectile prefab along the entity\'s forward direction.',
  requires: ['Transform3D'],
  props: {
    prefab: { type: 'string', default: 'Projectile' },
    cooldown: { type: 'number', default: 0.25, min: 0.01 },
    speed: { type: 'number', default: 20, min: 0 },
    muzzleOffset: { type: 'vec3', default: [0, 0, -0.8], description: 'Local spawn offset' },
    action: { type: 'string', default: 'fire' },
  },
  onStart({ state }) {
    state.timer = 0;
  },
  onUpdate({ entity, props, state, world, dt }) {
    state.timer = Math.max(0, state.timer - dt);
    const input = getInput(world);
    if (!input.isDown(props.action) || state.timer > 0) return;
    state.timer = props.cooldown;

    const wt = entity.get('WorldTransform3D');
    if (!wt) return;

    forwardFull(wt, tempForward);
    const rightVec = rightDir(wt, tempRight);
    const upVec = { x: 0, y: 1, z: 0 };

    const origin = {
      x: wt.position.x + rightVec.x * props.muzzleOffset.x + upVec.x * props.muzzleOffset.y - tempForward.x * props.muzzleOffset.z,
      y: wt.position.y + rightVec.y * props.muzzleOffset.x + upVec.y * props.muzzleOffset.y - tempForward.y * props.muzzleOffset.z,
      z: wt.position.z + rightVec.z * props.muzzleOffset.x + upVec.z * props.muzzleOffset.y - tempForward.z * props.muzzleOffset.z,
    };

    const projectile = instantiate(world, {
      prefab: props.prefab,
      components: { Transform3D: { position: [origin.x, origin.y, origin.z] } },
    });
    const body = projectile.get('Rigidbody3D');
    if (body) {
      body.velocity.x = tempForward.x * props.speed;
      body.velocity.y = tempForward.y * props.speed;
      body.velocity.z = tempForward.z * props.speed;
    }
  },
});

/**
 * Full 3D forward, including pitch.
 *
 * Distinct from `forwardFlat`: a projectile should go where you are aiming,
 * including up and down, while a walking character should not.
 */
function forwardFull(worldTransform, out) {
  return Quat.rotateVec3(worldTransform.quaternion, Vec3.FORWARD, out);
}

function isPointerLocked() {
  return typeof document !== 'undefined' && document.pointerLockElement != null;
}

/** Names of the 3D behaviors registered by this module. */
export const BUILTIN_BEHAVIORS_3D = [
  'FirstPersonController',
  'ThirdPersonController',
  'LookAt3D',
  'Spin3D',
  'Hover3D',
  'Patrol3D',
  'KillPlaneY',
  'Collect3D',
  'Shooter3D',
];
