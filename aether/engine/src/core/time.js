/**
 * Frame timing.
 *
 * Two clocks run at once. `delta` is variable and tracks real elapsed time —
 * use it for rendering, camera smoothing and anything visual. `fixedDelta` is
 * a constant step used for physics and gameplay logic, so simulation results
 * do not depend on frame rate or machine speed.
 *
 * That split is what makes a run reproducible: given the same inputs and the
 * same seed, the fixed steps execute in exactly the same sequence whether the
 * game ran at 144fps in a browser or as fast as Node could go in a test.
 */

export class Time {
  constructor(options = {}) {
    /** Seconds since the previous frame, already scaled by `timeScale`. */
    this.delta = 0;
    /** Unscaled seconds since the previous frame — for UI and pause menus. */
    this.unscaledDelta = 0;
    /** Fixed simulation step, in seconds. Default 1/60. */
    this.fixedDelta = options.fixedDelta ?? 1 / 60;
    /** Total scaled seconds elapsed. */
    this.elapsed = 0;
    /** Total unscaled seconds elapsed. */
    this.unscaledElapsed = 0;
    /** Frames rendered since start. */
    this.frame = 0;
    /** Fixed steps executed since start — the deterministic clock. */
    this.fixedStep = 0;
    /** 0 pauses simulation; 0.5 is slow motion; 2 is double speed. */
    this.timeScale = options.timeScale ?? 1;
    /**
     * A frame longer than this is treated as `maxDelta` instead. Without the
     * clamp, a breakpoint or a backgrounded tab produces one enormous frame and
     * everything tunnels through walls on resume.
     */
    this.maxDelta = options.maxDelta ?? 0.25;
    /** Cap on fixed steps per frame, so a slow machine cannot spiral. */
    this.maxFixedStepsPerFrame = options.maxFixedStepsPerFrame ?? 8;

    this.accumulator = 0;
    /**
     * How far the current frame sits between the last fixed step and the next,
     * as 0..1. Renderers use it to interpolate positions and avoid the stutter
     * you get from drawing raw fixed-step state.
     */
    this.alpha = 0;

    this.smoothedFps = 0;
    this.frameTimeMs = 0;
  }

  /**
   * Advance the clock by one real frame.
   * @param {number} dtSeconds unclamped real elapsed time
   * @returns {number} how many fixed steps should run this frame
   */
  advance(dtSeconds) {
    const clamped = Math.min(Math.max(dtSeconds, 0), this.maxDelta);
    this.unscaledDelta = clamped;
    this.delta = clamped * this.timeScale;
    this.unscaledElapsed += this.unscaledDelta;
    this.elapsed += this.delta;
    this.frame++;

    this.frameTimeMs = clamped * 1000;
    const instantFps = clamped > 0 ? 1 / clamped : 0;
    this.smoothedFps = this.smoothedFps === 0 ? instantFps : this.smoothedFps * 0.9 + instantFps * 0.1;

    this.accumulator += this.delta;
    let steps = Math.floor(this.accumulator / this.fixedDelta);
    if (steps > this.maxFixedStepsPerFrame) {
      // Drop the backlog rather than trying to catch up, which would only make
      // the next frame later still.
      steps = this.maxFixedStepsPerFrame;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.fixedDelta;
    }
    this.alpha = this.fixedDelta > 0 ? this.accumulator / this.fixedDelta : 0;
    return steps;
  }

  /** Called by the scheduler after each fixed step. */
  onFixedStep() {
    this.fixedStep++;
  }

  get fps() {
    return this.smoothedFps;
  }

  reset() {
    this.delta = 0;
    this.unscaledDelta = 0;
    this.elapsed = 0;
    this.unscaledElapsed = 0;
    this.frame = 0;
    this.fixedStep = 0;
    this.accumulator = 0;
    this.alpha = 0;
    this.smoothedFps = 0;
  }

  toJSON() {
    return {
      frame: this.frame,
      fixedStep: this.fixedStep,
      elapsed: Number(this.elapsed.toFixed(6)),
      delta: Number(this.delta.toFixed(6)),
      fixedDelta: this.fixedDelta,
      timeScale: this.timeScale,
      fps: Math.round(this.smoothedFps),
    };
  }
}

/**
 * A countdown timer, the shape gameplay code reaches for constantly.
 *
 * @example
 * const cooldown = new Timer(0.5);
 * // in update:
 * if (cooldown.tick(time.delta)) fire();
 */
export class Timer {
  constructor(duration, { repeat = true, elapsed = 0 } = {}) {
    this.duration = duration;
    this.repeat = repeat;
    this.elapsed = elapsed;
    this.finished = false;
  }

  /** @returns {boolean} true on the tick where the timer completes */
  tick(dt) {
    if (this.finished) return false;
    this.elapsed += dt;
    if (this.elapsed < this.duration) return false;
    if (this.repeat) {
      this.elapsed -= this.duration;
    } else {
      this.elapsed = this.duration;
      this.finished = true;
    }
    return true;
  }

  get progress() {
    return this.duration <= 0 ? 1 : Math.min(1, this.elapsed / this.duration);
  }

  get remaining() {
    return Math.max(0, this.duration - this.elapsed);
  }

  reset(duration = this.duration) {
    this.duration = duration;
    this.elapsed = 0;
    this.finished = false;
    return this;
  }
}
