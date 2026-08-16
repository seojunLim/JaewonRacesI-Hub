/**
 * Systems and the scheduler.
 *
 * A system is a named function with a declared phase and order. The scheduler
 * runs them in one fixed, inspectable sequence every frame — `sjl describe`
 * prints that sequence, so "when does my code run relative to physics" is a
 * question you look up rather than infer.
 *
 * Frame shape:
 *
 *   PRE_UPDATE  → once   (input polling, timers)
 *   FIXED_*     → 0..n   (physics and gameplay logic, constant dt)
 *   UPDATE      → once   (animation, non-physical movement, cameras)
 *   LATE_UPDATE → once   (camera follow, anything reacting to UPDATE)
 *   PRE_RENDER  → once   (cull, sort, build draw lists)
 *   RENDER      → once   (submit draw calls)
 *   POST_RENDER → once   (debug overlays, screenshots)
 */

/** Execution phases, in the order they run. */
export const Phase = {
  PRE_UPDATE: 'preUpdate',
  FIXED_PRE: 'fixedPre',
  FIXED_UPDATE: 'fixedUpdate',
  FIXED_POST: 'fixedPost',
  UPDATE: 'update',
  LATE_UPDATE: 'lateUpdate',
  PRE_RENDER: 'preRender',
  RENDER: 'render',
  POST_RENDER: 'postRender',
};

export const PHASE_ORDER = [
  Phase.PRE_UPDATE,
  Phase.FIXED_PRE,
  Phase.FIXED_UPDATE,
  Phase.FIXED_POST,
  Phase.UPDATE,
  Phase.LATE_UPDATE,
  Phase.PRE_RENDER,
  Phase.RENDER,
  Phase.POST_RENDER,
];

/** The phases that run inside the fixed-timestep loop. */
export const FIXED_PHASES = [Phase.FIXED_PRE, Phase.FIXED_UPDATE, Phase.FIXED_POST];

/**
 * Conventional order values. Systems sort ascending, so a lower number runs
 * earlier. Game systems that do not care should leave `order` at 0.
 */
export const Order = {
  FIRST: -1000,
  EARLY: -100,
  DEFAULT: 0,
  LATE: 100,
  LAST: 1000,
};

/**
 * @typedef {object} SystemDefinition
 * @property {string} name
 * @property {string} [phase]        one of `Phase`, default `Phase.UPDATE`
 * @property {number} [order]        lower runs first, default 0
 * @property {string} [description]
 * @property {string[]} [reads]      components read — documentation, and the
 *                                   basis for the dependency graph in `describe`
 * @property {string[]} [writes]     components written
 * @property {(ctx: SystemContext) => void} update
 * @property {(ctx: SystemContext) => void} [start]   once, before the first update
 * @property {(ctx: SystemContext) => void} [stop]    on teardown
 * @property {boolean} [enabled]
 */

/**
 * @typedef {object} SystemContext
 * @property {import('./world.js').World} world
 * @property {import('./time.js').Time} time
 * @property {number} dt          `time.delta`, or `time.fixedDelta` in fixed phases
 * @property {*} app              the owning App, when there is one
 */

export class System {
  /** @param {SystemDefinition} def */
  constructor(def) {
    if (!def.name) throw new Error('defineSystem: `name` is required');
    if (typeof def.update !== 'function') {
      throw new Error(`System "${def.name}": \`update\` must be a function`);
    }
    if (def.phase && !PHASE_ORDER.includes(def.phase)) {
      throw new Error(
        `System "${def.name}": unknown phase "${def.phase}". ` +
          `Valid phases: ${PHASE_ORDER.join(', ')}`,
      );
    }
    this.name = def.name;
    this.phase = def.phase ?? Phase.UPDATE;
    this.order = def.order ?? Order.DEFAULT;
    this.description = def.description ?? '';
    this.reads = def.reads ?? [];
    this.writes = def.writes ?? [];
    this.update = def.update;
    this.start = def.start ?? null;
    this.stop = def.stop ?? null;
    this.enabled = def.enabled ?? true;
    this.started = false;

    /** Rolling profile data, surfaced by the editor's stats panel. */
    this.lastDurationMs = 0;
    this.totalDurationMs = 0;
    this.callCount = 0;
  }

  get averageDurationMs() {
    return this.callCount === 0 ? 0 : this.totalDurationMs / this.callCount;
  }

  describe() {
    return {
      name: this.name,
      phase: this.phase,
      order: this.order,
      description: this.description,
      reads: this.reads,
      writes: this.writes,
      enabled: this.enabled,
    };
  }
}

/**
 * Runs systems in phase order, handling the fixed-timestep inner loop.
 */
export class Scheduler {
  constructor(options = {}) {
    /** @type {Map<string, System[]>} */
    this.phases = new Map(PHASE_ORDER.map((p) => [p, []]));
    /** @type {Map<string, System>} */
    this.byName = new Map();
    this.profiling = options.profiling ?? false;
    /** Set true to have `run` collect a per-system timing report. */
    this.lastReport = null;
  }

  /** @param {SystemDefinition|System} def @returns {System} */
  add(def) {
    const system = def instanceof System ? def : new System(def);
    if (this.byName.has(system.name)) {
      throw new Error(
        `System "${system.name}" is already registered. System names must be unique ` +
          'so that they can be referenced by name in config and disabled individually.',
      );
    }
    this.byName.set(system.name, system);
    const list = this.phases.get(system.phase);
    list.push(system);
    // Stable sort by order, then by insertion — two systems with the same order
    // always run in the order they were added, on every machine.
    list.sort((a, b) => a.order - b.order);
    return system;
  }

  /** Register several at once. */
  addAll(defs) {
    return defs.map((d) => this.add(d));
  }

  remove(name) {
    const system = this.byName.get(name);
    if (!system) return false;
    this.byName.delete(name);
    const list = this.phases.get(system.phase);
    const i = list.indexOf(system);
    if (i >= 0) list.splice(i, 1);
    return true;
  }

  get(name) {
    return this.byName.get(name);
  }

  setEnabled(name, enabled) {
    const system = this.byName.get(name);
    if (!system) throw new Error(`No system named "${name}". Registered: ${[...this.byName.keys()].join(', ')}`);
    system.enabled = enabled;
    return system;
  }

  has(name) {
    return this.byName.has(name);
  }

  /** Every system, in the exact order it will run. */
  ordered() {
    const out = [];
    for (const phase of PHASE_ORDER) out.push(...this.phases.get(phase));
    return out;
  }

  /** Run one phase. */
  runPhase(phase, ctx) {
    const list = this.phases.get(phase);
    if (!list || list.length === 0) return;
    const { world } = ctx;
    for (const system of list) {
      if (!system.enabled) continue;
      if (!system.started) {
        system.started = true;
        system.start?.(ctx);
      }
      world.beginIteration();
      if (this.profiling) {
        const t0 = now();
        try {
          system.update(ctx);
        } finally {
          world.endIteration();
        }
        system.lastDurationMs = now() - t0;
        system.totalDurationMs += system.lastDurationMs;
        system.callCount++;
      } else {
        try {
          system.update(ctx);
        } finally {
          world.endIteration();
        }
      }
    }
  }

  /**
   * Run one full frame.
   *
   * @param {object} ctx `{ world, time, app }`
   * @param {number} fixedSteps how many fixed steps to run, from `time.advance`
   */
  run(ctx, fixedSteps) {
    const { world, time } = ctx;

    this.runPhase(Phase.PRE_UPDATE, { ...ctx, dt: time.delta });
    world.events.flush();

    const fixedCtx = { ...ctx, dt: time.fixedDelta };
    for (let i = 0; i < fixedSteps; i++) {
      for (const phase of FIXED_PHASES) this.runPhase(phase, fixedCtx);
      time.onFixedStep();
      // Flush inside the loop so collision handlers from step N have run before
      // step N+1 integrates. Deferring them to the end of the frame would make
      // a two-step frame behave differently from two one-step frames.
      world.events.flush();
    }

    const varCtx = { ...ctx, dt: time.delta };
    this.runPhase(Phase.UPDATE, varCtx);
    world.events.flush();
    this.runPhase(Phase.LATE_UPDATE, varCtx);
    world.events.flush();
    this.runPhase(Phase.PRE_RENDER, varCtx);
    this.runPhase(Phase.RENDER, varCtx);
    this.runPhase(Phase.POST_RENDER, varCtx);
    world.events.flush();

    if (this.profiling) this.lastReport = this.report();
  }

  /** Call every system's `stop` hook. */
  stop(ctx) {
    for (const system of this.ordered()) {
      if (system.started) {
        system.stop?.(ctx);
        system.started = false;
      }
    }
  }

  report() {
    return this.ordered()
      .filter((s) => s.callCount > 0)
      .map((s) => ({
        name: s.name,
        phase: s.phase,
        lastMs: Number(s.lastDurationMs.toFixed(3)),
        avgMs: Number(s.averageDurationMs.toFixed(3)),
        calls: s.callCount,
      }))
      .sort((a, b) => b.avgMs - a.avgMs);
  }

  resetProfile() {
    for (const s of this.byName.values()) {
      s.lastDurationMs = 0;
      s.totalDurationMs = 0;
      s.callCount = 0;
    }
  }

  describe() {
    return PHASE_ORDER.map((phase) => ({
      phase,
      fixed: FIXED_PHASES.includes(phase),
      systems: this.phases.get(phase).map((s) => s.describe()),
    })).filter((p) => p.systems.length > 0);
  }
}

const now =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Number(process.hrtime.bigint() / 1000n) / 1000;

/** Convenience constructor, mirroring `defineComponent`. */
export function defineSystem(def) {
  return new System(def);
}
