/**
 * The headless runtime.
 *
 * This is the entry point an agent or a test uses. It builds an App with the
 * recording renderer and the silent audio backend, loads a scene from disk, and
 * hands back an object you can step and inspect.
 *
 * ```js
 * import { createHeadlessApp } from 'sjl-engine/headless';
 *
 * const app = await createHeadlessApp({ scene: 'scenes/level-1.json' });
 * app.input.press('jump');
 * app.run(30);
 * console.log(app.renderer.lastFrame.toAscii());
 * assert.ok(app.find('Player').get('Transform').position.y > 2);
 * ```
 *
 * Nothing here touches a DOM, a GPU or a clock, so results are identical on
 * every machine and every run.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { App } from './app.js';
import { HeadlessRenderer } from '../render/headless.js';
import { SilentAudio } from '../audio/audio.js';
import { Assets } from '../assets/assets.js';
import { Input, DEFAULT_ACTIONS } from '../input/input.js';
import { Scene } from '../scene/scene.js';

/**
 * @param {object} [options]
 * @param {string|object} [options.scene]   path to a scene file, or a scene object
 * @param {string} [options.root='.']       project root; asset paths resolve against it
 * @param {string[]} [options.scripts]      modules to import before loading the scene
 *                                          (this is where behaviors get registered)
 * @param {number} [options.width=800]
 * @param {number} [options.height=600]
 * @param {number|string} [options.seed]
 * @param {Record<string, *>} [options.actions]
 * @returns {Promise<App>}
 */
export async function createHeadlessApp(options = {}) {
  const root = path.resolve(options.root ?? '.');

  const renderer = new HeadlessRenderer({
    width: options.width ?? 800,
    height: options.height ?? 600,
    maxHistory: options.maxHistory ?? 8,
  });
  const audio = new SilentAudio();

  const assets = new Assets({
    baseUrl: root,
    renderer,
    audio,
    // Node has no `fetch` for local paths, so read from disk directly.
    fetchText: (url) => readFile(toLocalPath(url, root), 'utf8'),
    fetchBinary: async (url) => {
      const buffer = await readFile(toLocalPath(url, root));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  });

  const app = new App({
    renderer,
    audio,
    assets,
    seed: options.seed ?? 'sjl',
    fixedDelta: options.fixedDelta ?? 1 / 60,
    input: options.input ?? new Input({ actions: options.actions ?? DEFAULT_ACTIONS }),
    profiling: options.profiling ?? false,
    name: options.name ?? 'headless',
  });
  assets.events = app.world.events;

  // Game scripts register components and behaviors, so they must be imported
  // before a scene that references them is parsed.
  for (const script of options.scripts ?? []) {
    const resolved = path.isAbsolute(script) ? script : path.join(root, script);
    await import(pathToFileURL(resolved).href);
  }

  if (options.scene) {
    const scene = await resolveScene(options.scene, root);
    await app.loadScene(scene, { loadAssets: options.loadAssets ?? true });
  }

  return app;
}

/**
 * Load a project directory: read `sjl.config.json`, import its scripts, and
 * open its first scene. The zero-argument way to get a running game.
 *
 * @param {string} root
 * @param {object} [options]
 * @param {string} [options.scene] override which scene to open
 */
export async function loadProject(root, options = {}) {
  const config = await readProjectConfig(root);
  const sceneRef =
    options.scene ??
    config.scenes?.[0] ??
    'scenes/main.json';

  return createHeadlessApp({
    root,
    scene: sceneRef,
    scripts: config.scripts ?? [],
    actions: config.input?.actions,
    width: config.window?.width ?? 800,
    height: config.window?.height ?? 600,
    seed: options.seed ?? config.seed,
    ...options,
  });
}

/** Read and lightly normalize `sjl.config.json`. */
export async function readProjectConfig(root) {
  const configPath = path.join(root, 'sjl.config.json');
  try {
    const text = await readFile(configPath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `No sjl.config.json found in ${root}.\n` +
          'Run `sjl new <dir>` to scaffold a project, or pass --scene to point at a scene file directly.',
      );
    }
    throw new Error(`Could not read ${configPath}: ${error.message}`);
  }
}

async function resolveScene(scene, root) {
  if (typeof scene !== 'string') return scene;
  const file = path.isAbsolute(scene) ? scene : path.join(root, scene);
  const text = await readFile(file, 'utf8');
  try {
    return Scene.parse(text);
  } catch (error) {
    throw new Error(`${file}:\n${error.message}`);
  }
}

function toLocalPath(url, root) {
  if (path.isAbsolute(url)) return url;
  return path.join(root, url);
}

export { App } from './app.js';
export { HeadlessRenderer } from '../render/headless.js';
