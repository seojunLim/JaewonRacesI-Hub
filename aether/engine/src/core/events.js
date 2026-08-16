/**
 * The event bus.
 *
 * Two delivery modes, deliberately:
 *
 *   `emit(type, payload)`   — synchronous, for engine-internal signals where
 *                             the caller needs handlers to have run (component
 *                             added, scene loaded).
 *   `queue(type, payload)`  — deferred to the next `flush()`, for gameplay
 *                             events. Handlers run at a known point in the
 *                             frame instead of re-entering the middle of the
 *                             physics solver, so a collision handler can safely
 *                             destroy entities.
 *
 * Handler order is registration order, always. Nothing in the engine relies on
 * hash iteration order, which keeps replays deterministic.
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Array<{ fn: Function, once: boolean, context: * }>>} */
    this.handlers = new Map();
    /** @type {Array<{ type: string, payload: * }>} */
    this.pending = [];
    /** Wildcard listeners, called for every event. Useful for debug logging. */
    this.anyHandlers = [];
    /** Cap on events waiting at any one moment — catches a fan-out explosion. */
    this.maxQueueDepth = 10000;
    /**
     * Cap on re-entrant drain passes within a single flush.
     *
     * The depth cap alone does not catch the common feedback loop, where a
     * handler queues exactly one event in response to the one it just handled:
     * the queue never grows past a single entry, so `flush` would spin forever
     * at a constant depth. Counting passes catches it in bounded time.
     */
    this.maxFlushPasses = 1000;
  }

  /**
   * @param {string} type
   * @param {(payload: *, type: string) => void} fn
   * @returns {() => void} an unsubscribe function
   */
  on(type, fn, context = null) {
    if (typeof fn !== 'function') throw new Error(`EventBus.on("${type}"): handler must be a function`);
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push({ fn, once: false, context });
    return () => this.off(type, fn);
  }

  /** Fires at most once, then unsubscribes itself. */
  once(type, fn, context = null) {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push({ fn, once: true, context });
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.findIndex((h) => h.fn === fn);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.handlers.delete(type);
  }

  /** Listen to every event. Returns an unsubscribe function. */
  onAny(fn) {
    this.anyHandlers.push(fn);
    return () => {
      const i = this.anyHandlers.indexOf(fn);
      if (i >= 0) this.anyHandlers.splice(i, 1);
    };
  }

  /** Remove all handlers for a type, or all handlers entirely. */
  clear(type) {
    if (type === undefined) {
      this.handlers.clear();
      this.anyHandlers.length = 0;
      this.pending.length = 0;
    } else {
      this.handlers.delete(type);
    }
  }

  /** Deliver immediately. */
  emit(type, payload) {
    const list = this.handlers.get(type);
    if (list && list.length) {
      // Copy first: a handler may unsubscribe itself or add new handlers, and
      // neither should change who receives this particular emission.
      const snapshot = list.slice();
      for (const h of snapshot) {
        if (h.once) this.off(type, h.fn);
        h.fn.call(h.context, payload, type);
      }
    }
    for (const fn of this.anyHandlers.slice()) fn(payload, type);
    return this;
  }

  /** Defer until the next `flush()`. */
  queue(type, payload) {
    if (this.pending.length >= this.maxQueueDepth) {
      throw new Error(
        `EventBus queue exceeded ${this.maxQueueDepth} pending events while queueing "${type}". ` +
          'This almost always means a handler is queueing the event it handles.',
      );
    }
    this.pending.push({ type, payload });
    return this;
  }

  /**
   * Deliver everything queued. Events queued *by* handlers during a flush are
   * picked up by the same flush, bounded by `maxQueueDepth` so a feedback loop
   * throws instead of hanging.
   * @returns {number} how many events were delivered
   */
  flush() {
    let delivered = 0;
    let passes = 0;
    while (this.pending.length > 0) {
      if (++passes > this.maxFlushPasses) {
        const types = [...new Set(this.pending.map((e) => e.type))].join(', ');
        this.pending.length = 0;
        throw new Error(
          `EventBus.flush exceeded ${this.maxFlushPasses} drain passes; still queueing: ${types}. ` +
            'A handler is queueing an event that leads back to itself.',
        );
      }
      const batch = this.pending;
      this.pending = [];
      for (const { type, payload } of batch) {
        this.emit(type, payload);
        delivered++;
      }
    }
    return delivered;
  }

  listenerCount(type) {
    return this.handlers.get(type)?.length ?? 0;
  }

  /** Every type with at least one listener. Surfaced by `sjl describe`. */
  types() {
    return [...this.handlers.keys()].sort();
  }
}

/**
 * Event names the engine itself emits. Listed here so `sjl describe` can
 * publish them and an agent does not have to grep for `emit(` to find out what
 * it can subscribe to.
 */
export const EngineEvents = {
  WORLD_CREATED: 'world:created',
  ENTITY_CREATED: 'entity:created',
  ENTITY_DESTROYED: 'entity:destroyed',
  ENTITY_ENABLED: 'entity:enabled',
  ENTITY_DISABLED: 'entity:disabled',
  COMPONENT_ADDED: 'component:added',
  COMPONENT_REMOVED: 'component:removed',
  SCENE_LOADED: 'scene:loaded',
  SCENE_UNLOADED: 'scene:unloaded',
  COLLISION_ENTER: 'collision:enter',
  COLLISION_STAY: 'collision:stay',
  COLLISION_EXIT: 'collision:exit',
  TRIGGER_ENTER: 'trigger:enter',
  TRIGGER_STAY: 'trigger:stay',
  TRIGGER_EXIT: 'trigger:exit',
  ANIMATION_COMPLETE: 'animation:complete',
  ANIMATION_EVENT: 'animation:event',
  TWEEN_COMPLETE: 'tween:complete',
  ASSET_LOADED: 'asset:loaded',
  ASSET_FAILED: 'asset:failed',
  GAME_START: 'game:start',
  GAME_PAUSE: 'game:pause',
  GAME_RESUME: 'game:resume',
  GAME_STOP: 'game:stop',
};

/** Payload shapes for the engine events, for docs and `sjl describe`. */
export const EngineEventPayloads = {
  'entity:created': '{ entity: Entity }',
  'entity:destroyed': '{ entity: Entity, id: number }',
  'entity:enabled': '{ entity: Entity }',
  'entity:disabled': '{ entity: Entity }',
  'component:added': '{ entity: Entity, component: string, data: object }',
  'component:removed': '{ entity: Entity, component: string, data: object }',
  'scene:loaded': '{ scene: Scene, name: string }',
  'scene:unloaded': '{ name: string }',
  'collision:enter': '{ a: Entity, b: Entity, normal: Vec2, depth: number, contact: Vec2 }',
  'collision:stay': '{ a: Entity, b: Entity, normal: Vec2, depth: number, contact: Vec2 }',
  'collision:exit': '{ a: Entity, b: Entity }',
  'trigger:enter': '{ a: Entity, b: Entity }',
  'trigger:stay': '{ a: Entity, b: Entity }',
  'trigger:exit': '{ a: Entity, b: Entity }',
  'animation:complete': '{ entity: Entity, clip: string }',
  'animation:event': '{ entity: Entity, clip: string, name: string, frame: number }',
  'tween:complete': '{ entity: Entity, property: string }',
  'asset:loaded': '{ id: string, type: string }',
  'asset:failed': '{ id: string, type: string, error: string }',
};
