/**
 * BehaviorSystem — runs per-entity game logic.
 *
 * Three systems share this module, one per update phase, plus a subscriber that
 * routes physics collision events to the behaviors on the entities involved.
 *
 * Ordering within a phase is by entity creation order, and by attach order
 * within an entity. That is arbitrary but *stable*, which is the property that
 * matters: a scene reloaded from the same file always runs its behaviors in the
 * same sequence.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { EngineEvents } from '../core/events.js';

/**
 * Run one hook across every behavior instance in the world.
 * @param {import('../core/system.js').SystemContext} ctx
 * @param {string} hook
 */
function runHook(ctx, hook) {
  const { world, time, dt, app } = ctx;
  const store = world.stores.get('Behaviors');
  if (!store || store.size === 0) return;

  for (const entity of world.query('Behaviors')) {
    const data = store.get(entity.id);
    if (!data) continue;
    const items = data.items;
    if (!items || items.length === 0) continue;

    // Snapshot: a behavior may attach or detach behaviors on its own entity.
    for (const instance of items.slice()) {
      if (instance.destroyed || !instance.enabled) continue;
      if (!entity.alive) break;

      if (!instance.awoken) {
        instance.awoken = true;
        instance.invoke('onAwake', { time, dt, app });
        if (!entity.alive || instance.destroyed) continue;
      }
      if (!instance.started) {
        instance.started = true;
        instance.invoke('onStart', { time, dt, app });
        if (!entity.alive || instance.destroyed) continue;
      }
      instance.invoke(hook, { time, dt, app });
    }
  }
}

export const BehaviorFixedUpdateSystem = defineSystem({
  name: 'BehaviorFixedUpdateSystem',
  phase: Phase.FIXED_PRE,
  order: Order.DEFAULT,
  description:
    'Runs behavior onFixedUpdate hooks. This is where gameplay logic belongs — ' +
    'it steps at a constant rate, so the result does not depend on frame rate.',
  reads: ['Behaviors'],
  update: (ctx) => runHook(ctx, 'onFixedUpdate'),
});

export const BehaviorUpdateSystem = defineSystem({
  name: 'BehaviorUpdateSystem',
  phase: Phase.UPDATE,
  order: Order.EARLY,
  description: 'Runs behavior onUpdate hooks, once per rendered frame with variable dt.',
  reads: ['Behaviors'],
  update: (ctx) => runHook(ctx, 'onUpdate'),
});

export const BehaviorLateUpdateSystem = defineSystem({
  name: 'BehaviorLateUpdateSystem',
  phase: Phase.LATE_UPDATE,
  order: Order.DEFAULT,
  description: 'Runs behavior onLateUpdate hooks, after all onUpdate hooks have finished.',
  reads: ['Behaviors'],
  update: (ctx) => runHook(ctx, 'onLateUpdate'),
});

/**
 * Deliver a collision/trigger event to the behaviors on both entities.
 *
 * Each side sees itself as `entity` and the other as `other`, so a behavior
 * never has to work out which end of the collision it is on — a small thing
 * that removes a genuinely common source of mistakes.
 */
function dispatchContact(payload, hook, extra = {}) {
  deliver(payload.a, payload.b, hook, payload, extra);
  deliver(payload.b, payload.a, hook, payload, extra, true);
}

function deliver(entity, other, hook, payload, extra, flipNormal = false) {
  if (!entity.alive) return;
  const data = entity.get('Behaviors');
  if (!data?.items?.length) return;
  const normal = payload.normal
    ? flipNormal
      ? { x: -payload.normal.x, y: -payload.normal.y }
      : payload.normal
    : undefined;
  for (const instance of data.items.slice()) {
    if (instance.destroyed || !instance.enabled) continue;
    if (!instance.definition[hook]) continue;
    instance.invoke(hook, { other, normal, depth: payload.depth, contact: payload.contact, ...extra });
  }
}

/**
 * Subscribe behavior contact hooks to the physics events.
 * Called once by the App during setup.
 * @param {import('../core/world.js').World} world
 */
export function installContactDispatch(world) {
  const bus = world.events;
  const subscriptions = [
    bus.on(EngineEvents.COLLISION_ENTER, (p) => dispatchContact(p, 'onCollisionEnter')),
    bus.on(EngineEvents.COLLISION_STAY, (p) => dispatchContact(p, 'onCollisionStay')),
    bus.on(EngineEvents.COLLISION_EXIT, (p) => dispatchContact(p, 'onCollisionExit')),
    bus.on(EngineEvents.TRIGGER_ENTER, (p) => dispatchContact(p, 'onTriggerEnter')),
    bus.on(EngineEvents.TRIGGER_STAY, (p) => dispatchContact(p, 'onTriggerStay')),
    bus.on(EngineEvents.TRIGGER_EXIT, (p) => dispatchContact(p, 'onTriggerExit')),
    // Fire onDestroy so behaviors can release timers, pooled objects and the
    // like.
    //
    // This hangs off `component:removed` rather than `entity:destroyed` on
    // purpose: destruction strips components before announcing the entity, so
    // by the time `entity:destroyed` fires the Behaviors component is already
    // gone and there would be nothing left to notify. Removal fires with the
    // data still in hand, and covers detaching the component on its own too.
    bus.on(EngineEvents.COMPONENT_REMOVED, ({ component, data }) => {
      if (component !== 'Behaviors') return;
      if (!data?.items?.length) return;
      for (const instance of data.items) {
        if (instance.destroyed) continue;
        instance.destroyed = true;
        try {
          instance.invoke('onDestroy', {});
        } catch (error) {
          // A throwing teardown must not abort the destruction of the rest of
          // the entity, or the world is left half-torn-down.
          console.error(`[sjl] ${instance.type}.onDestroy failed:`, error.message);
        }
      }
    }),
  ];
  return () => subscriptions.forEach((off) => off());
}
