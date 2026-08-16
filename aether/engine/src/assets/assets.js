/**
 * The asset server.
 *
 * Assets are declared in the scene file, never imported by code:
 *
 * ```json
 * "assets": [
 *   { "id": "hero",  "type": "texture", "src": "sprites/hero.png",
 *     "frames": { "idle0": { "x": 0, "y": 0, "w": 16, "h": 16 } } },
 *   { "id": "coin",  "type": "audio",   "src": "sfx/coin.wav" },
 *   { "id": "level", "type": "json",    "src": "data/level.json" }
 * ]
 * ```
 *
 * A declared-not-imported pipeline is what makes `sjl validate` able to tell an
 * agent that `"texture": "her0"` refers to nothing — a check that is impossible
 * when assets arrive through arbitrary import statements.
 *
 * In Node there is no image decoder, so texture loads resolve to a descriptor
 * carrying the declared dimensions. Everything downstream — layout, physics,
 * the draw list — works from that descriptor, so a headless run behaves the
 * same as a rendered one, minus the pixels.
 */

import { EngineEvents } from '../core/events.js';

/**
 * @typedef {object} AssetDescriptor
 * @property {string} id
 * @property {'texture'|'audio'|'json'|'text'|'atlas'} type
 * @property {string} src
 * @property {Record<string, {x,y,w,h}>} [frames]  atlas regions, for textures
 * @property {number} [width]   declared size; required for textures in headless runs
 * @property {number} [height]
 */

export const ASSET_TYPES = ['texture', 'audio', 'json', 'text', 'atlas'];

export class Assets {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl='']       prefix for every `src`
   * @param {(url: string) => Promise<*>} [options.fetchBinary]
   * @param {(url: string) => Promise<string>} [options.fetchText]
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? '';
    /** @type {Map<string, {descriptor: AssetDescriptor, data: *, state: string, error?: string}>} */
    this.entries = new Map();
    this.fetchBinary = options.fetchBinary ?? null;
    this.fetchText = options.fetchText ?? null;
    /** Renderer/audio backends that want a copy when an asset finishes loading. */
    this.renderer = options.renderer ?? null;
    this.audio = options.audio ?? null;
    this.events = options.events ?? null;
  }

  /** Declare assets without loading them yet. */
  declare(descriptors) {
    for (const descriptor of descriptors) {
      if (!descriptor?.id) continue;
      const existing = this.entries.get(descriptor.id);
      if (existing && existing.state === 'loaded') continue;
      this.entries.set(descriptor.id, { descriptor, data: null, state: 'declared' });
    }
    return this;
  }

  has(id) {
    return this.entries.has(id);
  }

  /** The loaded data for an asset, or null if it has not loaded. */
  get(id) {
    return this.entries.get(id)?.data ?? null;
  }

  descriptor(id) {
    return this.entries.get(id)?.descriptor ?? null;
  }

  state(id) {
    return this.entries.get(id)?.state ?? 'missing';
  }

  ids() {
    return [...this.entries.keys()];
  }

  /**
   * Load everything declared. Failures are recorded per asset rather than
   * rejecting the batch — one missing sound should not stop a level from
   * opening, and the report says exactly what is missing.
   *
   * @returns {Promise<{loaded: string[], failed: Array<{id: string, error: string}>}>}
   */
  async loadAll() {
    const loaded = [];
    const failed = [];
    for (const [id, entry] of this.entries) {
      if (entry.state === 'loaded') {
        loaded.push(id);
        continue;
      }
      try {
        entry.data = await this.loadOne(entry.descriptor);
        entry.state = 'loaded';
        loaded.push(id);
        this.publish(entry.descriptor, entry.data);
        this.events?.emit(EngineEvents.ASSET_LOADED, { id, type: entry.descriptor.type });
      } catch (error) {
        entry.state = 'failed';
        entry.error = error.message;
        failed.push({ id, error: error.message });
        this.events?.emit(EngineEvents.ASSET_FAILED, {
          id,
          type: entry.descriptor.type,
          error: error.message,
        });
      }
    }
    return { loaded, failed };
  }

  /** @param {AssetDescriptor} descriptor */
  async loadOne(descriptor) {
    const url = this.resolve(descriptor.src);
    switch (descriptor.type ?? 'texture') {
      case 'texture':
      case 'atlas':
        return this.loadTexture(descriptor, url);
      case 'audio':
        return this.loadAudio(descriptor, url);
      case 'json': {
        const text = await this.readText(url);
        try {
          return JSON.parse(text);
        } catch (error) {
          throw new Error(`Asset "${descriptor.id}" is not valid JSON: ${error.message}`);
        }
      }
      case 'text':
        return this.readText(url);
      default:
        throw new Error(
          `Unknown asset type "${descriptor.type}" for "${descriptor.id}". ` +
            `Valid types: ${ASSET_TYPES.join(', ')}`,
        );
    }
  }

  async loadTexture(descriptor, url) {
    // Browser: decode a real image.
    if (typeof Image !== 'undefined') {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () =>
          reject(new Error(`Failed to load texture "${descriptor.id}" from ${url}`));
        img.src = url;
      });
      return {
        kind: 'texture',
        id: descriptor.id,
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        frames: descriptor.frames ?? {},
      };
    }

    // Headless: a descriptor is enough for everything except rasterizing.
    return {
      kind: 'texture',
      id: descriptor.id,
      image: null,
      width: descriptor.width ?? 0,
      height: descriptor.height ?? 0,
      frames: descriptor.frames ?? {},
      headless: true,
    };
  }

  async loadAudio(descriptor, url) {
    if (this.audio?.decode && this.fetchBinary) {
      const bytes = await this.fetchBinary(url);
      const buffer = await this.audio.decode(bytes);
      return { kind: 'audio', id: descriptor.id, buffer };
    }
    // No decoder available: register the id so play calls still resolve and get
    // recorded by the silent backend.
    return { kind: 'audio', id: descriptor.id, buffer: null, headless: true };
  }

  async readText(url) {
    if (this.fetchText) return this.fetchText(url);
    if (typeof fetch !== 'undefined') {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response.text();
    }
    throw new Error(
      `Cannot read "${url}": no text loader is configured. ` +
        'Pass `fetchText` when constructing Assets (the Node runtime does this for you).',
    );
  }

  /** Hand a freshly loaded asset to the renderer or audio backend. */
  publish(descriptor, data) {
    if (data?.kind === 'texture' && this.renderer) {
      this.renderer.uploadTexture(descriptor.id, data.image ?? data, data.frames);
    }
    if (data?.kind === 'audio' && this.audio) {
      this.audio.register(descriptor.id, data.buffer);
    }
  }

  resolve(src) {
    if (!src) return '';
    if (/^([a-z]+:)?\/\//i.test(src) || src.startsWith('data:')) return src;
    if (!this.baseUrl) return src;
    return `${this.baseUrl.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
  }

  /**
   * Register an already-decoded asset. Used by tests and by the editor when the
   * user drops a file in.
   */
  set(id, type, data) {
    this.entries.set(id, {
      descriptor: { id, type, src: '<inline>' },
      data,
      state: 'loaded',
    });
    this.publish({ id, type }, data);
    return this;
  }

  /** A report of what loaded, for `sjl doctor` and the editor's asset panel. */
  report() {
    return [...this.entries.values()].map(({ descriptor, state, error }) => ({
      id: descriptor.id,
      type: descriptor.type,
      src: descriptor.src,
      state,
      ...(error ? { error } : {}),
    }));
  }

  clear() {
    this.entries.clear();
  }
}

/**
 * Build a frame table for a uniform grid sheet.
 *
 * Hand-writing 32 frame rectangles in JSON is miserable and error-prone; almost
 * every sprite sheet is a regular grid.
 *
 * @example
 * gridFrames({ prefix: 'run', columns: 4, rows: 2, tileWidth: 16, tileHeight: 16 })
 * // -> { run0: {x:0,y:0,w:16,h:16}, run1: {...}, ... run7 }
 */
export function gridFrames({ prefix = 'frame', columns, rows, tileWidth, tileHeight, offsetX = 0, offsetY = 0 }) {
  const frames = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      frames[`${prefix}${row * columns + col}`] = {
        x: offsetX + col * tileWidth,
        y: offsetY + row * tileHeight,
        w: tileWidth,
        h: tileHeight,
      };
    }
  }
  return frames;
}

/** Frame names for a grid, in order — feeds straight into an animation clip. */
export function gridFrameNames(prefix, count, start = 0) {
  return Array.from({ length: count }, (_, i) => `${prefix}${start + i}`);
}
