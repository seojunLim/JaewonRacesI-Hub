/**
 * The browser runtime.
 *
 * Creates a canvas, picks the best available renderer, binds DOM input, and
 * drives `app.step()` from `requestAnimationFrame`.
 *
 * ```html
 * <script type="module">
 *   import { createGame } from './engine/src/runtime/browser.js';
 *   const game = await createGame({ mount: '#game', scene: 'scenes/level-1.json' });
 * </script>
 * ```
 */

import { App } from './app.js';
import { WebGL2Renderer, isWebGL2Available } from '../render/webgl2.js';
import { WebGL3DRenderer } from '../render/webgl3d.js';
import { Canvas2DRenderer } from '../render/canvas2d.js';
import { Assets } from '../assets/assets.js';
import { Input, DEFAULT_ACTIONS } from '../input/input.js';
import { WebAudio, SilentAudio } from '../audio/audio.js';
import { Scene } from '../scene/scene.js';
import { RENDERER_RESOURCE } from '../systems/render.js';

/**
 * @param {object} options
 * @param {string|HTMLElement} [options.mount='body']
 * @param {string|object} [options.scene]
 * @param {string} [options.baseUrl='']
 * @param {'auto'|'webgl3d'|'webgl2'|'canvas2d'} [options.renderer='auto']
 * @param {number} [options.width]   defaults to the mount element's size
 * @param {number} [options.height]
 * @param {boolean} [options.resize=true] track the container's size
 * @param {boolean} [options.autoStart=true]
 * @returns {Promise<App>}
 */
export async function createGame(options = {}) {
  const container = resolveMount(options.mount ?? 'body');
  const canvas = options.canvas ?? document.createElement('canvas');
  if (!canvas.parentNode) container.appendChild(canvas);
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  // Without this the canvas ignores keyboard events entirely, and the game
  // silently does not respond to the keys the player is pressing.
  canvas.tabIndex = 0;

  const width = options.width ?? container.clientWidth ?? 800;
  const height = options.height ?? container.clientHeight ?? 600;
  canvas.width = width;
  canvas.height = height;

  const renderer = createRenderer(canvas, options, width, height);

  let audio;
  try {
    audio = options.audio ?? new WebAudio();
  } catch {
    // No Web Audio (or a policy blocked construction): fall back to the silent
    // backend so the game still runs, just without sound.
    audio = new SilentAudio();
  }

  const input = options.input ?? new Input({ actions: options.actions ?? DEFAULT_ACTIONS });
  const assets = new Assets({
    baseUrl: options.baseUrl ?? '',
    renderer,
    audio,
  });

  const app = new App({
    renderer,
    audio,
    input,
    assets,
    seed: options.seed,
    fixedDelta: options.fixedDelta ?? 1 / 60,
    profiling: options.profiling ?? false,
  });
  assets.events = app.world.events;
  app.canvas = canvas;

  const detachInput = bindInput(canvas, input, audio);
  const detachResize = options.resize === false ? null : bindResize(container, canvas, renderer, options);

  if (options.scene) {
    const scene = typeof options.scene === 'string'
      ? Scene.parse(await fetchText(resolveUrl(options.baseUrl, options.scene)))
      : options.scene;
    await app.loadScene(scene);
  }

  if (options.autoStart !== false) startLoop(app);

  const originalStop = app.stop.bind(app);
  app.stop = () => {
    detachInput();
    detachResize?.();
    renderer.destroy?.();
    return originalStop();
  };

  return app;
}

/** Drive `app.step` from requestAnimationFrame until the app is stopped. */
export function startLoop(app) {
  let last = performance.now();
  let frameHandle = 0;

  const frame = (now) => {
    if (app.stopped) return;
    const dt = (now - last) / 1000;
    last = now;
    app.step(dt);
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);

  // A backgrounded tab stops firing rAF; without resetting `last` on return,
  // the first frame back would be a multi-second dt.
  const onVisibility = () => {
    if (!document.hidden) last = performance.now();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    cancelAnimationFrame(frameHandle);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

function createRenderer(canvas, options, width, height) {
  const choice = options.renderer ?? 'auto';
  const rendererOptions = {
    width,
    height,
    pixelRatio: options.pixelRatio ?? window.devicePixelRatio ?? 1,
    antialias: options.antialias ?? false,
  };

  if (choice === 'canvas2d') return new Canvas2DRenderer(canvas, rendererOptions);
  if (choice === 'webgl2') return new WebGL2Renderer(canvas, rendererOptions);
  if (choice === 'webgl3d') return new WebGL3DRenderer(canvas, rendererOptions);

  if (isWebGL2Available()) {
    try {
      // The 3D renderer extends the 2D one, so it is the right default even for
      // a purely 2D game: it costs one extra shader program at startup and
      // nothing per frame, and it means a scene that later gains a Camera3D
      // just works instead of silently drawing nothing.
      return new WebGL3DRenderer(canvas, rendererOptions);
    } catch (error) {
      console.warn(
        '[sjl] 3D renderer failed to initialize, falling back to the 2D one:',
        error.message,
      );
      try {
        return new WebGL2Renderer(canvas, rendererOptions);
      } catch (fallbackError) {
        console.warn('[sjl] WebGL2 unavailable, falling back to Canvas2D:', fallbackError.message);
      }
    }
  }
  return new Canvas2DRenderer(canvas, rendererOptions);
}

/** Wire DOM events into the Input object. Returns a detach function. */
export function bindInput(canvas, input, audio) {
  const onKeyDown = (event) => {
    input.setKey(event.code, true);
    // Arrow keys and space scroll the page by default, which is disorienting
    // while playing. Only swallow keys the game has actually bound.
    if (isBound(input, event.code)) event.preventDefault();
    audio?.resume?.();
  };
  const onKeyUp = (event) => input.setKey(event.code, false);

  const onPointerMove = (event) => {
    const rect = canvas.getBoundingClientRect();
    input.setMousePosition(event.clientX - rect.left, event.clientY - rect.top);
    input.mouse.over = true;
  };
  const onPointerDown = (event) => {
    canvas.focus();
    input.setKey(`Mouse${event.button}`, true);
    audio?.resume?.();
  };
  const onPointerUp = (event) => input.setKey(`Mouse${event.button}`, false);
  const onPointerLeave = () => {
    input.mouse.over = false;
  };
  const onWheel = (event) => {
    input.mouse.wheel += Math.sign(event.deltaY);
  };
  const onContextMenu = (event) => event.preventDefault();
  // Losing focus with keys held leaves them stuck down forever otherwise.
  const onBlur = () => input.reset();

  const onGamepad = () => pollGamepads(input);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('contextmenu', onContextMenu);

  const gamepadTimer = setInterval(() => pollGamepads(input), 16);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    clearInterval(gamepadTimer);
  };
}

function pollGamepads(input) {
  if (!navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  input.gamepads = [];
  for (const pad of pads) {
    if (!pad) continue;
    input.gamepads.push({
      index: pad.index,
      buttons: pad.buttons.map((b) => b.pressed),
      axes: [...pad.axes],
    });
  }
}

function isBound(input, code) {
  for (const action of input.actions.values()) {
    if (action.keys.includes(code) || action.positive.includes(code) || action.negative.includes(code)) {
      return true;
    }
  }
  return false;
}

function bindResize(container, canvas, renderer, options) {
  const apply = () => {
    const width = options.width ?? container.clientWidth ?? canvas.width;
    const height = options.height ?? container.clientHeight ?? canvas.height;
    if (width > 0 && height > 0) renderer.resize(width, height);
  };
  apply();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
}

function resolveMount(mount) {
  if (typeof mount === 'string') {
    const element = document.querySelector(mount);
    if (!element) throw new Error(`createGame: no element matches "${mount}"`);
    return element;
  }
  return mount;
}

function resolveUrl(baseUrl, src) {
  if (!baseUrl) return src;
  return `${baseUrl.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

export { App, RENDERER_RESOURCE };
