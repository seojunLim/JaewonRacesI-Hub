/**
 * A small library of ready-made behaviors.
 *
 * These are the ones every 2D project writes on day one. Shipping them means a
 * scene file can be a complete, playable game with no game code at all — which
 * is what makes it possible to describe a game to an agent and get something
 * runnable back in a single step, rather than a scene plus four script files
 * that all have to agree with each other.
 *
 * Import this module for its side effect to register them:
 * `import 'sjl-engine/src/behaviors/index.js'`
 */

import { defineBehavior } from '../core/behavior.js';
import { getInput } from '../systems/input.js';
import { getPhysics } from '../systems/physics.js';
import { instantiate } from '../scene/scene.js';
import { clamp, damp, moveTowards } from '../math/scalar.js';

defineBehavior({
  name: 'TopDownController',
  description: 'Eight-way movement driven by the moveX/moveY input actions. No gravity.',
  requires: ['Transform'],
  props: {
    speed: { type: 'number', default: 5, min: 0, description: 'World units per second' },
    acceleration: { type: 'number', default: 0, min: 0, description: '0 means instant' },
    moveXAction: { type: 'string', default: 'moveX' },
    moveYAction: { type: 'string', default: 'moveY' },
    faceMovement: { type: 'boolean', default: false, description: 'Rotate to face travel direction' },
  },
  onFixedUpdate({ entity, props, world, dt }) {
    const input = getInput(world);
    const dir = input.vector(props.moveXAction, props.moveYAction);
    const targetX = dir.x * props.speed;
    const targetY = dir.y * props.speed;

    const body = entity.get('Rigidbody');
    const velocity = body ? body.velocity : null;

    if (velocity) {
      if (props.acceleration > 0) {
        velocity.x = moveTowards(velocity.x, targetX, props.acceleration * dt);
        velocity.y = moveTowards(velocity.y, targetY, props.acceleration * dt);
      } else {
        velocity.x = targetX;
        velocity.y = targetY;
      }
      if (body.sleeping && (targetX || targetY)) body.sleeping = false;
    } else {
      // No rigidbody: move the transform directly. Fine for a UI cursor or a
      // game with no physics at all.
      const t = entity.require('Transform');
      t.position.x += targetX * dt;
      t.position.y += targetY * dt;
    }

    if (props.faceMovement && (dir.x !== 0 || dir.y !== 0)) {
      entity.require('Transform').rotation = Math.atan2(dir.y, dir.x) * (180 / Math.PI);
    }
  },
});

defineBehavior({
  name: 'PlatformerController',
  description:
    'Side-scrolling movement with jumping, coyote time and jump buffering. ' +
    'Requires a Rigidbody and a collider; reads the moveX and jump actions.',
  requires: ['Transform', 'Rigidbody'],
  props: {
    speed: { type: 'number', default: 6, min: 0 },
    acceleration: { type: 'number', default: 60, min: 0, description: 'Ground acceleration' },
    airAcceleration: { type: 'number', default: 25, min: 0 },
    jumpHeight: { type: 'number', default: 3, min: 0, description: 'Peak height in world units' },
    /** Extra downward force after the apex, so the arc feels less floaty. */
    fallMultiplier: { type: 'number', default: 1.8, min: 1 },
    /** Releasing jump early cuts the rise short — the standard variable jump. */
    lowJumpMultiplier: { type: 'number', default: 2.5, min: 1 },
    coyoteTime: { type: 'number', default: 0.1, min: 0, description: 'Grace period after leaving a ledge' },
    jumpBuffer: { type: 'number', default: 0.12, min: 0, description: 'Grace period for an early jump press' },
    maxJumps: { type: 'int', default: 1, min: 1, description: '2 gives a double jump' },
    moveAction: { type: 'string', default: 'moveX' },
    jumpAction: { type: 'string', default: 'jump' },
    flipSprite: { type: 'boolean', default: true },
  },
  onStart({ state }) {
    state.coyote = 0;
    state.buffer = 0;
    state.jumpsUsed = 0;
    state.wasGrounded = false;
  },
  onFixedUpdate({ entity, props, state, world, dt }) {
    const input = getInput(world);
    const body = entity.require('Rigidbody');
    const gravity = world.singleton('PhysicsSettings')?.gravity ?? { x: 0, y: -20 };

    const grounded = body.grounded;
    if (grounded) {
      state.coyote = props.coyoteTime;
      state.jumpsUsed = 0;
    } else {
      state.coyote = Math.max(0, state.coyote - dt);
    }

    if (input.pressed(props.jumpAction)) state.buffer = props.jumpBuffer;
    else state.buffer = Math.max(0, state.buffer - dt);

    // Horizontal
    const move = input.axis(props.moveAction);
    const target = move * props.speed;
    const accel = grounded ? props.acceleration : props.airAcceleration;
    body.velocity.x = accel > 0 ? moveTowards(body.velocity.x, target, accel * dt) : target;
    if (move !== 0) body.sleeping = false;

    // Jump. Solving `v = sqrt(2 * g * h)` means `jumpHeight` is in world units
    // and stays correct if gravity changes.
    const canJump = state.coyote > 0 || state.jumpsUsed < props.maxJumps - 1;
    if (state.buffer > 0 && canJump) {
      body.velocity.y = Math.sqrt(2 * Math.abs(gravity.y) * props.jumpHeight);
      state.buffer = 0;
      state.coyote = 0;
      state.jumpsUsed++;
      body.sleeping = false;
      body.grounded = false;
    }

    // Better-feeling gravity: heavier on the way down, and heavier still on the
    // way up once the player lets go of the button.
    if (body.velocity.y < 0) {
      body.velocity.y += gravity.y * (props.fallMultiplier - 1) * dt;
    } else if (body.velocity.y > 0 && !input.isDown(props.jumpAction)) {
      body.velocity.y += gravity.y * (props.lowJumpMultiplier - 1) * dt;
    }

    if (props.flipSprite && move !== 0) {
      const sprite = entity.get('Sprite');
      if (sprite) sprite.flipX = move < 0;
    }
    state.wasGrounded = grounded;
  },
});

defineBehavior({
  name: 'Patrol',
  description: 'Moves back and forth between two points, turning at each end.',
  requires: ['Transform'],
  props: {
    axis: { type: 'enum', values: ['x', 'y'], default: 'x' },
    distance: { type: 'number', default: 3, min: 0, description: 'Half-range from the start position' },
    speed: { type: 'number', default: 2, min: 0 },
    startDirection: { type: 'int', default: 1 },
    flipSprite: { type: 'boolean', default: true },
  },
  onStart({ entity, state, props }) {
    const t = entity.require('Transform');
    state.origin = props.axis === 'x' ? t.position.x : t.position.y;
    state.dir = props.startDirection >= 0 ? 1 : -1;
  },
  onFixedUpdate({ entity, props, state, dt }) {
    const t = entity.require('Transform');
    const axis = props.axis;
    const current = axis === 'x' ? t.position.x : t.position.y;
    const next = current + props.speed * state.dir * dt;

    if (next > state.origin + props.distance) {
      state.dir = -1;
    } else if (next < state.origin - props.distance) {
      state.dir = 1;
    }

    const moved = current + props.speed * state.dir * dt;
    if (axis === 'x') t.position.x = moved;
    else t.position.y = moved;

    // A patrolling platform must be kinematic, or the solver will push it off
    // its route the first time something lands on it.
    const body = entity.get('Rigidbody');
    if (body && body.type === 'kinematic') {
      body.velocity.x = axis === 'x' ? props.speed * state.dir : 0;
      body.velocity.y = axis === 'y' ? props.speed * state.dir : 0;
    }

    if (props.flipSprite && axis === 'x') {
      const sprite = entity.get('Sprite');
      if (sprite) sprite.flipX = state.dir < 0;
    }
  },
});

defineBehavior({
  name: 'Spin',
  description: 'Rotates the entity at a constant rate. Mostly for pickups and effects.',
  requires: ['Transform'],
  props: {
    degreesPerSecond: { type: 'number', default: 90 },
  },
  onUpdate({ entity, props, dt }) {
    entity.require('Transform').rotation += props.degreesPerSecond * dt;
  },
});

defineBehavior({
  name: 'Oscillate',
  description: 'Moves the entity along a sine wave around its starting position.',
  requires: ['Transform'],
  props: {
    axis: { type: 'enum', values: ['x', 'y'], default: 'y' },
    amplitude: { type: 'number', default: 0.5 },
    frequency: { type: 'number', default: 1, description: 'Cycles per second' },
    phase: { type: 'number', default: 0, description: 'Offset in cycles, 0..1' },
  },
  onStart({ entity, state }) {
    const t = entity.require('Transform');
    state.originX = t.position.x;
    state.originY = t.position.y;
    state.elapsed = 0;
  },
  onUpdate({ entity, props, state, dt }) {
    state.elapsed += dt;
    const offset =
      Math.sin((state.elapsed * props.frequency + props.phase) * Math.PI * 2) * props.amplitude;
    const t = entity.require('Transform');
    if (props.axis === 'x') t.position.x = state.originX + offset;
    else t.position.y = state.originY + offset;
  },
});

defineBehavior({
  name: 'DestroyOnTrigger',
  description:
    'Destroys an entity when something with a matching tag enters its trigger. ' +
    'The usual way to build coins, spikes and kill zones without writing code.',
  props: {
    tag: { type: 'string', default: '', description: 'Required tag on the other entity; empty means any' },
    destroy: {
      type: 'enum',
      values: ['self', 'other', 'both'],
      default: 'self',
      description: 'Which entity to destroy',
    },
    sound: { type: 'asset', assetType: 'audio' },
    event: { type: 'string', default: '', description: 'Optional world event to queue on trigger' },
  },
  onTriggerEnter({ entity, other, props, world }) {
    if (props.tag && !other.hasTag(props.tag)) return;

    if (props.sound) {
      world.getResource('audio')?.play(props.sound, {});
    }
    if (props.event) {
      world.events.queue(props.event, { entity, other });
    }
    if (props.destroy === 'self' || props.destroy === 'both') world.destroy(entity.id);
    if (props.destroy === 'other' || props.destroy === 'both') world.destroy(other.id);
  },
});

defineBehavior({
  name: 'Spawner',
  description: 'Spawns a prefab on an interval. Spawned entities inherit the spawner position.',
  requires: ['Transform'],
  props: {
    prefab: { type: 'string', required: true, description: 'Prefab name from the scene file' },
    interval: { type: 'number', default: 1, min: 0.01, description: 'Seconds between spawns' },
    maxAlive: { type: 'int', default: 0, min: 0, description: '0 means unlimited' },
    limit: { type: 'int', default: 0, min: 0, description: 'Total spawns before stopping; 0 = unlimited' },
    spread: { type: 'vec2', default: [0, 0], description: 'Random position offset range' },
    velocity: { type: 'vec2', default: [0, 0], description: 'Initial velocity, if the prefab has a Rigidbody' },
    tag: { type: 'string', default: '', description: 'Tag applied to each spawned entity' },
    autoStart: { type: 'boolean', default: true },
  },
  onStart({ state }) {
    state.timer = 0;
    state.spawned = 0;
    state.alive = new Set();
  },
  onUpdate({ entity, props, state, world, dt }) {
    if (!props.autoStart) return;
    if (props.limit > 0 && state.spawned >= props.limit) return;

    for (const id of [...state.alive]) {
      if (!world.records.has(id)) state.alive.delete(id);
    }
    if (props.maxAlive > 0 && state.alive.size >= props.maxAlive) return;

    state.timer += dt;
    if (state.timer < props.interval) return;
    state.timer -= props.interval;

    const wt = entity.get('WorldTransform');
    const t = entity.get('Transform');
    const x = (wt ? wt.x : t.position.x) + world.random.range(-props.spread.x, props.spread.x);
    const y = (wt ? wt.y : t.position.y) + world.random.range(-props.spread.y, props.spread.y);

    const spawned = instantiate(world, {
      prefab: props.prefab,
      components: { Transform: { position: [x, y] } },
      ...(props.tag ? { tags: [props.tag] } : {}),
    });

    const body = spawned.get('Rigidbody');
    if (body && (props.velocity.x || props.velocity.y)) {
      body.velocity.x = props.velocity.x;
      body.velocity.y = props.velocity.y;
    }

    state.alive.add(spawned.id);
    state.spawned++;
  },
});

defineBehavior({
  name: 'KillY',
  description: 'Destroys the entity once it falls below (or rises above) a y threshold.',
  requires: ['Transform'],
  props: {
    y: { type: 'number', default: -20 },
    direction: { type: 'enum', values: ['below', 'above'], default: 'below' },
    event: { type: 'string', default: '', description: 'Optional event to queue instead of destroying' },
  },
  onFixedUpdate({ entity, props, world }) {
    const t = entity.require('Transform');
    const past = props.direction === 'below' ? t.position.y < props.y : t.position.y > props.y;
    if (!past) return;
    if (props.event) world.events.queue(props.event, { entity });
    else world.destroy(entity.id);
  },
});

defineBehavior({
  name: 'MouseAim',
  description: 'Rotates the entity to face the mouse cursor.',
  requires: ['Transform'],
  props: {
    offset: { type: 'number', default: 0, description: 'Extra rotation in degrees' },
    turnSpeed: { type: 'number', default: 0, min: 0, description: 'Degrees/sec; 0 snaps instantly' },
  },
  onUpdate({ entity, props, world, dt }) {
    const input = getInput(world);
    const wt = entity.get('WorldTransform');
    const t = entity.require('Transform');
    const ox = wt ? wt.x : t.position.x;
    const oy = wt ? wt.y : t.position.y;

    const target =
      Math.atan2(input.mouse.worldY - oy, input.mouse.worldX - ox) * (180 / Math.PI) + props.offset;

    if (props.turnSpeed > 0) {
      let delta = ((target - t.rotation + 540) % 360) - 180;
      const step = props.turnSpeed * dt;
      t.rotation += clamp(delta, -step, step);
    } else {
      t.rotation = target;
    }
  },
});

defineBehavior({
  name: 'GroundCheck',
  description:
    'Raycasts downward and writes the result to Rigidbody.grounded. Use it when a ' +
    'character needs reliable ground detection on slopes or moving platforms, where ' +
    'contact normals alone can flicker.',
  requires: ['Transform', 'Rigidbody'],
  props: {
    distance: { type: 'number', default: 0.1, min: 0, description: 'How far below the collider to probe' },
    mask: { type: 'int', default: -1, description: 'Collision layer bitmask' },
  },
  onFixedUpdate({ entity, props, world }) {
    const body = entity.require('Rigidbody');
    const wt = entity.get('WorldTransform');
    const box = entity.get('BoxCollider');
    const circle = entity.get('CircleCollider');

    const halfHeight = box ? (box.size.y * Math.abs(wt?.scaleY ?? 1)) / 2 : (circle?.radius ?? 0.5);
    const origin = {
      x: (wt?.x ?? 0) + (box?.offset.x ?? circle?.offset.x ?? 0),
      y: (wt?.y ?? 0) + (box?.offset.y ?? circle?.offset.y ?? 0) - halfHeight + 0.01,
    };

    const hit = getPhysics(world).raycast(origin, { x: 0, y: -1 }, {
      maxDistance: props.distance + 0.01,
      mask: props.mask,
      ignore: [entity.id],
    });
    if (hit) body.grounded = true;
  },
});

defineBehavior({
  name: 'SmoothFollow',
  description: 'Follows a target entity with exponential smoothing. Frame-rate independent.',
  requires: ['Transform'],
  props: {
    target: { type: 'entity', description: 'Scene id of the entity to follow' },
    offset: { type: 'vec2', default: [0, 0] },
    halfLife: { type: 'number', default: 0.15, min: 0 },
  },
  onLateUpdate({ entity, props, world, dt }) {
    if (!props.target) return;
    const target = world.findById(props.target) ?? world.findByName(props.target);
    if (!target?.alive) return;

    const tw = target.get('WorldTransform') ?? target.get('Transform');
    const tx = (tw.x ?? tw.position?.x ?? 0) + props.offset.x;
    const ty = (tw.y ?? tw.position?.y ?? 0) + props.offset.y;

    const t = entity.require('Transform');
    t.position.x = damp(t.position.x, tx, props.halfLife, dt);
    t.position.y = damp(t.position.y, ty, props.halfLife, dt);
  },
});

/** Names of the behaviors registered by this module. */
export const BUILTIN_BEHAVIORS = [
  'TopDownController',
  'PlatformerController',
  'Patrol',
  'Spin',
  'Oscillate',
  'DestroyOnTrigger',
  'Spawner',
  'KillY',
  'MouseAim',
  'GroundCheck',
  'SmoothFollow',
];
