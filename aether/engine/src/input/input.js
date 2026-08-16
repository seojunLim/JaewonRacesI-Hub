/**
 * Input.
 *
 * Game code never reads `KeyW`. It reads the action `jump`, which an action map
 * binds to keys, mouse buttons and gamepad buttons. That indirection buys three
 * things: rebindable controls for free, one place to see every control the game
 * has, and — the reason it matters here — a test can drive the game by pressing
 * *actions*, so a headless run reads like the player's intent rather than like
 * a keyboard trace.
 *
 * @example
 * // In a test or an agent-driven run:
 * input.press('jump');
 * app.step(1 / 60);
 * input.release('jump');
 */

/** Buttons pressed *this frame* vs *held*. Both matter, and games conflate them constantly. */
export class Input {
  constructor(options = {}) {
    /** @type {Set<string>} physical inputs currently held */
    this.down = new Set();
    /** @type {Set<string>} went down during the frame just ending */
    this.pressedThisFrame = new Set();
    /** @type {Set<string>} came up during the frame just ending */
    this.releasedThisFrame = new Set();

    this.mouse = {
      /** Screen position in CSS pixels, origin top-left. */
      x: 0,
      y: 0,
      /** World position, filled in by the runtime using the active camera. */
      worldX: 0,
      worldY: 0,
      deltaX: 0,
      deltaY: 0,
      wheel: 0,
      /** True while the pointer is over the game surface. */
      over: false,
    };

    /** @type {Map<string, ActionBinding>} */
    this.actions = new Map();
    /** Snapshot of action states, so `pressed()` works for actions too. */
    this.actionState = new Map();
    this.previousActionState = new Map();

    /** @type {Array<{index: number, buttons: boolean[], axes: number[]}>} */
    this.gamepads = [];

    this.enabled = options.enabled ?? true;
    /** Recorded frames, when recording is on — replayable input for bug reports. */
    this.recording = null;

    if (options.actions) this.defineActions(options.actions);
  }

  // -------------------------------------------------------------------------
  // Action maps
  // -------------------------------------------------------------------------

  /**
   * @typedef {object} ActionBinding
   * @property {'button'|'axis'} type
   * @property {string[]} [keys]      for buttons: any of these triggers it
   * @property {string[]} [positive]  for axes: these push the value to +1
   * @property {string[]} [negative]  for axes: these push it to -1
   * @property {string} [gamepadAxis] e.g. `'leftStickX'`
   * @property {number} [deadZone]
   * @property {string} [description]
   */

  /**
   * Replace the action map.
   * @param {Record<string, ActionBinding>} map
   */
  defineActions(map) {
    this.actions.clear();
    for (const [name, binding] of Object.entries(map)) {
      this.defineAction(name, binding);
    }
    return this;
  }

  defineAction(name, binding) {
    const type = binding.type ?? (binding.positive || binding.negative ? 'axis' : 'button');
    this.actions.set(name, {
      type,
      keys: binding.keys ?? [],
      positive: binding.positive ?? [],
      negative: binding.negative ?? [],
      gamepadAxis: binding.gamepadAxis ?? null,
      deadZone: binding.deadZone ?? 0.15,
      description: binding.description ?? '',
    });
    return this;
  }

  /** Every action name, for `sjl describe` and the editor's input panel. */
  actionNames() {
    return [...this.actions.keys()].sort();
  }

  /**
   * Look up an action, failing loudly for unknown names.
   * Silently returning `false` for a typo'd action is how you end up staring at
   * a jump that never fires.
   */
  requireAction(name) {
    const action = this.actions.get(name);
    if (!action) {
      throw new Error(
        `Unknown input action "${name}". Defined actions: ${this.actionNames().join(', ') || '(none)'}\n` +
          'Define it in the project config under `input.actions`, or with input.defineAction().',
      );
    }
    return action;
  }

  // -------------------------------------------------------------------------
  // Queries — actions
  // -------------------------------------------------------------------------

  /** Is the action held right now? */
  isDown(name) {
    const action = this.requireAction(name);
    if (action.type === 'axis') return Math.abs(this.axis(name)) > action.deadZone;
    return action.keys.some((code) => this.down.has(code)) || this.gamepadButtonDown(action.keys);
  }

  /** Did the action go down during this frame? */
  pressed(name) {
    return (this.actionState.get(name) ?? 0) > 0.5 && (this.previousActionState.get(name) ?? 0) <= 0.5;
  }

  /** Did the action come up during this frame? */
  released(name) {
    return (this.actionState.get(name) ?? 0) <= 0.5 && (this.previousActionState.get(name) ?? 0) > 0.5;
  }

  /**
   * Axis value in -1..1. For a digital axis (keys) the value is exactly -1, 0
   * or 1 — no smoothing, because smoothing belongs in the character controller
   * where the game can tune it, not hidden in the input layer.
   */
  axis(name) {
    const action = this.requireAction(name);
    let value = 0;
    if (action.positive.some((code) => this.down.has(code))) value += 1;
    if (action.negative.some((code) => this.down.has(code))) value -= 1;

    if (value === 0 && action.gamepadAxis) {
      const analog = this.gamepadAxis(action.gamepadAxis);
      if (Math.abs(analog) > action.deadZone) value = analog;
    }
    return value;
  }

  /** Two axes as a vector, normalized so diagonals are not faster. */
  vector(xAction, yAction, out = { x: 0, y: 0 }) {
    out.x = this.axis(xAction);
    out.y = this.axis(yAction);
    const len = Math.hypot(out.x, out.y);
    if (len > 1) {
      out.x /= len;
      out.y /= len;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Queries — raw
  // -------------------------------------------------------------------------

  /** Raw physical input, e.g. `key('KeyW')` or `key('Mouse0')`. */
  key(code) {
    return this.down.has(code);
  }

  keyPressed(code) {
    return this.pressedThisFrame.has(code);
  }

  keyReleased(code) {
    return this.releasedThisFrame.has(code);
  }

  mouseButton(button = 0) {
    return this.down.has(`Mouse${button}`);
  }

  mouseButtonPressed(button = 0) {
    return this.pressedThisFrame.has(`Mouse${button}`);
  }

  gamepadButtonDown(codes) {
    for (const code of codes) {
      if (!code.startsWith('Gamepad')) continue;
      const index = Number(code.slice('Gamepad'.length));
      if (Number.isNaN(index)) continue;
      for (const pad of this.gamepads) {
        if (pad.buttons[index]) return true;
      }
    }
    return false;
  }

  gamepadAxis(name) {
    const map = { leftStickX: 0, leftStickY: 1, rightStickX: 2, rightStickY: 3 };
    const index = map[name] ?? Number(name);
    if (Number.isNaN(index)) return 0;
    for (const pad of this.gamepads) {
      const value = pad.axes[index];
      if (value !== undefined && Math.abs(value) > 0) return value;
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // Driving input (browser events, tests, agents)
  // -------------------------------------------------------------------------

  /** Set a physical input's state. Called by the browser bindings and by tests. */
  setKey(code, isDown) {
    if (!this.enabled) return;
    if (isDown) {
      if (!this.down.has(code)) this.pressedThisFrame.add(code);
      this.down.add(code);
    } else {
      if (this.down.has(code)) this.releasedThisFrame.add(code);
      this.down.delete(code);
    }
  }

  /**
   * Press an *action* — the ergonomic entry point for tests and agents.
   * Presses the action's first bound physical input.
   */
  press(name) {
    const action = this.requireAction(name);
    const code = action.keys[0] ?? action.positive[0];
    if (!code) {
      throw new Error(`Action "${name}" has no bindings, so it cannot be pressed`);
    }
    this.setKey(code, true);
    return this;
  }

  release(name) {
    const action = this.requireAction(name);
    for (const code of [...action.keys, ...action.positive, ...action.negative]) {
      this.setKey(code, false);
    }
    return this;
  }

  /** Hold an axis at -1 or +1 by pressing the appropriate binding. */
  setAxis(name, value) {
    const action = this.requireAction(name);
    for (const code of [...action.positive, ...action.negative]) this.setKey(code, false);
    if (value > 0 && action.positive[0]) this.setKey(action.positive[0], true);
    if (value < 0 && action.negative[0]) this.setKey(action.negative[0], true);
    return this;
  }

  setMousePosition(x, y) {
    this.mouse.deltaX = x - this.mouse.x;
    this.mouse.deltaY = y - this.mouse.y;
    this.mouse.x = x;
    this.mouse.y = y;
  }

  /** Clear everything — call when the window loses focus, or keys stick down. */
  reset() {
    this.down.clear();
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouse.wheel = 0;
    this.mouse.deltaX = 0;
    this.mouse.deltaY = 0;
    this.actionState.clear();
    this.previousActionState.clear();
  }

  /**
   * Sample the action map into `actionState`, keeping the previous frame's
   * values so `pressed()` and `released()` can compare them.
   *
   * Called by InputSystem at the top of the frame, before any gameplay code
   * reads input — so every system in the frame sees the same input snapshot,
   * rather than a state that shifts as events arrive mid-frame.
   */
  beginFrame() {
    this.previousActionState = this.actionState;
    this.actionState = new Map();
    for (const [name, action] of this.actions) {
      const value =
        action.type === 'axis'
          ? Math.abs(this.axis(name)) > action.deadZone
            ? 1
            : 0
          : action.keys.some((c) => this.down.has(c)) || this.gamepadButtonDown(action.keys)
            ? 1
            : 0;
      this.actionState.set(name, value);
    }
    if (this.recording) {
      this.recording.push({ down: [...this.down], mouse: { x: this.mouse.x, y: this.mouse.y } });
    }
  }

  /**
   * Clear per-frame flags. Called at the very end of the frame, so a press that
   * arrives during the frame is still visible to every system that runs in it.
   */
  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.mouse.wheel = 0;
    this.mouse.deltaX = 0;
    this.mouse.deltaY = 0;
  }

  /** Start capturing per-frame input, for replay or a bug report. */
  startRecording() {
    this.recording = [];
    return this;
  }

  stopRecording() {
    const frames = this.recording;
    this.recording = null;
    return frames;
  }

  /** A readable snapshot, for debug overlays and test failure messages. */
  toJSON() {
    return {
      down: [...this.down],
      mouse: { x: Math.round(this.mouse.x), y: Math.round(this.mouse.y) },
      actions: Object.fromEntries(
        [...this.actions.keys()].map((name) => [
          name,
          this.actions.get(name).type === 'axis' ? this.axis(name) : this.isDown(name),
        ]),
      ),
    };
  }
}

/**
 * A sensible default action map, used when a project does not define one.
 * Covers WASD + arrows + gamepad, which is what a prototype needs on day one.
 */
export const DEFAULT_ACTIONS = {
  moveX: {
    type: 'axis',
    positive: ['KeyD', 'ArrowRight'],
    negative: ['KeyA', 'ArrowLeft'],
    gamepadAxis: 'leftStickX',
    description: 'Horizontal movement',
  },
  moveY: {
    type: 'axis',
    positive: ['KeyW', 'ArrowUp'],
    negative: ['KeyS', 'ArrowDown'],
    gamepadAxis: 'leftStickY',
    description: 'Vertical movement',
  },
  jump: { type: 'button', keys: ['Space', 'KeyW', 'ArrowUp', 'Gamepad0'], description: 'Jump' },
  fire: { type: 'button', keys: ['Mouse0', 'KeyJ', 'Gamepad2'], description: 'Primary action' },
  interact: { type: 'button', keys: ['KeyE', 'Gamepad1'], description: 'Interact / use' },
  pause: { type: 'button', keys: ['Escape', 'KeyP', 'Gamepad9'], description: 'Pause' },
  restart: { type: 'button', keys: ['KeyR'], description: 'Restart the level' },
};
