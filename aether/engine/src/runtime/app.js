/**
 * The App — the object a game actually holds.
 *
 * It owns the world, the scheduler, the clock and the backends, and it exposes
 * one method that matters more than the rest: `step(dt)`, which advances the
 * game by exactly one frame and returns.
 *
 * That is a deliberate design choice. Most engines hide the loop behind a
 * `run()` that never returns, which makes the game observable only from the
 * inside. Here the loop is the caller's: a browser drives it from
 * `requestAnimationFrame`, a test drives it in a `for` loop, and an agent
 * drives it one frame at a time while inspecting the world in between. Same
 * code, same results.
 */

import { World } from '../core/world.js';
import { Scheduler, Phase } from '../core/system.js';
import { Time } from '../core/time.js';
import { EventBus, EngineEvents } from '../core/events.js';
import { components as globalComponents } from '../core/component.js';
import { behaviors as globalBehaviors } from '../core/behavior.js';
import { builtinSystems } from '../systems/index.js';
import { installContactDispatch } from '../systems/behavior.js';
import { RENDERER_RESOURCE } from '../systems/render.js';
import { INPUT_RESOURCE } from '../systems/input.js';
import { AUDIO_RESOURCE } from '../systems/audio.js';
import { Input, DEFAULT_ACTIONS } from '../input/input.js';
import { SilentAudio } from '../audio/audio.js';
import { Assets } from '../assets/assets.js';
import { Scene, loadScene } from '../scene/scene.js';
import { serializeWorld } from '../scene/serialize.js';
import '../components/index.js';

/**
 * @typedef {object} AppOptions
 * @property {*} [renderer]        a Renderer; defaults to none (simulation only)
 * @property {*} [audio]           an AudioBackend; defaults to SilentAudio
 * @property {Input} [input]
 * @property {Assets} [assets]
 * @property {number|string} [seed]
 * @property {number} [fixedDelta=1/60]
 * @property {Record<string, *>} [actions] input action map
 * @property {boolean} [profiling=false]
 * @property {boolean} [autoStart=true] fire GAME_START on the first step
 */

export class App {
  /** @param {AppOptions} [options] */
  constructor(options = {}) {
    this.options = options;

    this.world = new World({
      seed: options.seed ?? 'sjl',
      components: options.components ?? globalComponents,
      name: options.name ?? 'game',
    });
    this.behaviors = options.behaviors ?? globalBehaviors;
    this.time = new Time({ fixedDelta: options.fixedDelta ?? 1 / 60 });
    this.scheduler = new Scheduler({ profiling: options.profiling ?? false });
    /** App-level events, distinct from the world's gameplay events. */
    this.events = new EventBus();

    this.input = options.input ?? new Input({ actions: options.actions ?? DEFAULT_ACTIONS });
    this.audio = options.audio ?? new SilentAudio();
    this.renderer = options.renderer ?? null;
    this.assets =
      options.assets ??
      new Assets({
        baseUrl: options.baseUrl ?? '',
        renderer: this.renderer,
        audio: this.audio,
        events: this.world.events,
      });

    this.world.setResource(INPUT_RESOURCE, this.input);
    this.world.setResource(AUDIO_RESOURCE, this.audio);
    this.world.setResource('assets', this.assets);
    this.world.setResource('app', this);
    if (this.renderer) this.world.setResource(RENDERER_RESOURCE, this.renderer);

    this.scheduler.addAll(builtinSystems());
    this.uninstallContacts = installContactDispatch(this.world);

    this.running = false;
    this.paused = false;
    this.started = false;
    this.frameCount = 0;
    /** Set by `stop()`; the browser loop checks it to cancel its rAF. */
    this.stopped = false;
  }

  // -------------------------------------------------------------------------
  // Systems
  // -------------------------------------------------------------------------

  /**
   * Register a game system.
   * @param {import('../core/system.js').SystemDefinition} definition
   */
  addSystem(definition) {
    return this.scheduler.add(definition);
  }

  removeSystem(name) {
    return this.scheduler.remove(name);
  }

  setSystemEnabled(name, enabled) {
    return this.scheduler.setEnabled(name, enabled);
  }

  /** Turn on collider/velocity overlays. */
  setDebugDraw(enabled) {
    this.scheduler.setEnabled('DebugDrawSystem', enabled);
    return this;
  }

  // -------------------------------------------------------------------------
  // Scenes
  // -------------------------------------------------------------------------

  /**
   * Load a scene, replacing whatever is in the world.
   *
   * @param {object|string|Scene} scene
   * @param {object} [options]
   * @param {boolean} [options.loadAssets=true] load declared assets first
   * @returns {Promise<Scene>}
   */
  async loadScene(scene, options = {}) {
    const parsed = scene instanceof Scene ? scene : Scene.parse(scene, options);

    if (options.loadAssets !== false && parsed.assets?.length) {
      this.assets.declare(parsed.assets);
      const { failed } = await this.assets.loadAll();
      if (failed.length) {
        // Not fatal: a game with a missing sound is still playable, and the
        // report tells you exactly which files to check.
        console.warn(
          `[sjl] ${failed.length} asset(s) failed to load:\n` +
            failed.map((f) => `  ${f.id}: ${f.error}`).join('\n'),
        );
      }
    }

    loadScene(this.world, parsed, { behaviors: this.behaviors, ...options });

    // Systems restart with each scene, so `start` hooks run against the new
    // world rather than a world that no longer exists.
    this.scheduler.stop({ world: this.world, time: this.time, app: this });
    this.currentScene = parsed;
    this.events.emit('scene:loaded', { scene: parsed });
    return parsed;
  }

  /** Load a scene synchronously, skipping asset loading. Handy in tests. */
  loadSceneSync(scene, options = {}) {
    const parsed = scene instanceof Scene ? scene : Scene.parse(scene, options);
    if (parsed.assets?.length) this.assets.declare(parsed.assets);
    loadScene(this.world, parsed, { behaviors: this.behaviors, ...options });
    this.scheduler.stop({ world: this.world, time: this.time, app: this });
    this.currentScene = parsed;
    return parsed;
  }

  /** Re-instantiate the current scene from its source document. */
  reloadScene() {
    if (!this.currentScene) throw new Error('No scene has been loaded yet');
    return this.loadSceneSync(this.currentScene);
  }

  /** The live world serialized back to a scene document. */
  saveScene(options = {}) {
    return serializeWorld(this.world, options);
  }

  // -------------------------------------------------------------------------
  // The loop
  // -------------------------------------------------------------------------

  /**
   * Advance the game by one frame.
   *
   * @param {number} [dt=1/60] real elapsed seconds. Pass a constant for a
   *        deterministic run; pass real frame times for a live game.
   * @returns {number} the number of fixed steps executed this frame
   */
  step(dt = 1 / 60) {
    if (!this.started) {
      this.started = true;
      this.running = true;
      this.world.events.emit(EngineEvents.GAME_START, { app: this });
      this.events.emit('start', { app: this });
    }
    if (this.paused) {
      // A paused game still renders, so the pause menu is visible and the
      // editor can scrub the camera around a frozen scene.
      this.scheduler.runPhase(Phase.PRE_RENDER, { world: this.world, time: this.time, app: this, dt: 0 });
      this.scheduler.runPhase(Phase.RENDER, { world: this.world, time: this.time, app: this, dt: 0 });
      this.scheduler.runPhase(Phase.POST_RENDER, { world: this.world, time: this.time, app: this, dt: 0 });
      return 0;
    }

    const fixedSteps = this.time.advance(dt);
    this.scheduler.run({ world: this.world, time: this.time, app: this }, fixedSteps);
    this.frameCount++;
    return fixedSteps;
  }

  /**
   * Run a fixed number of frames at a constant dt.
   *
   * The workhorse for tests and agent-driven runs: deterministic, fast, and it
   * returns control so the caller can assert on the result.
   *
   * @param {number} frames
   * @param {number} [dt=1/60]
   */
  run(frames, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) {
      if (this.stopped) break;
      this.step(dt);
    }
    return this;
  }

  /** Advance by seconds rather than frames. */
  advance(seconds, dt = 1 / 60) {
    return this.run(Math.round(seconds / dt), dt);
  }

  /**
   * Step until `predicate(app)` is true, or `maxFrames` elapse.
   *
   * @example
   * const won = app.runUntil((a) => a.world.findByName('Banner')?.get('Text').text === 'You win');
   *
   * @returns {boolean} whether the predicate was satisfied
   */
  runUntil(predicate, { maxFrames = 600, dt = 1 / 60 } = {}) {
    for (let i = 0; i < maxFrames; i++) {
      if (predicate(this)) return true;
      this.step(dt);
    }
    return predicate(this);
  }

  pause() {
    if (this.paused) return this;
    this.paused = true;
    this.world.events.emit(EngineEvents.GAME_PAUSE, { app: this });
    return this;
  }

  resume() {
    if (!this.paused) return this;
    this.paused = false;
    this.world.events.emit(EngineEvents.GAME_RESUME, { app: this });
    return this;
  }

  togglePause() {
    return this.paused ? this.resume() : this.pause();
  }

  /** Tear down: stop systems, silence audio, release backend resources. */
  stop() {
    if (this.stopped) return this;
    this.stopped = true;
    this.running = false;
    this.scheduler.stop({ world: this.world, time: this.time, app: this });
    this.world.events.emit(EngineEvents.GAME_STOP, { app: this });
    this.audio?.stopAll?.();
    this.uninstallContacts?.();
    return this;
  }

  // -------------------------------------------------------------------------
  // Inspection
  // -------------------------------------------------------------------------

  /**
   * A snapshot of everything an outside observer needs.
   *
   * Written for agents: one call returns the clock, the entity tree, the system
   * schedule and the last frame's draw list, all as plain JSON. It is what you
   * print when a headless run does not do what you expected.
   */
  inspect(options = {}) {
    return {
      time: this.time.toJSON(),
      paused: this.paused,
      scene: this.currentScene?.name ?? null,
      entities: this.world.debugDump(options).entities,
      systems: this.scheduler.describe(),
      input: this.input.toJSON(),
      ...(this.renderer?.lastFrame ? { lastFrame: this.renderer.lastFrame.summary() } : {}),
      ...(this.scheduler.profiling ? { profile: this.scheduler.report() } : {}),
    };
  }

  /** The scene graph as indented text. The fastest way to see what exists. */
  tree() {
    return this.world.debugTree();
  }

  /** Shorthand: `app.find('Player')` by name, then by scene id, then by tag. */
  find(query) {
    return (
      this.world.findByName(query) ?? this.world.findById(query) ?? this.world.findFirstByTag(query)
    );
  }

  /** Shorthand for the physics query API. */
  get physics() {
    return this.world.getResource('physics');
  }
}
