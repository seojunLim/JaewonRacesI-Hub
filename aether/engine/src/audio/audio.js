/**
 * Audio backends.
 *
 * Same shape as the renderer: an interface, a real implementation, and a
 * recording implementation for headless runs. `SilentAudio` logs every play
 * call, so a test can assert that the coin sound fired on pickup without an
 * audio device — the kind of check that is otherwise simply not written.
 */

/** The interface both backends implement. */
export class AudioBackend {
  constructor() {
    this.masterVolume = 1;
    this.muted = false;
  }

  /** @param {string} _id @param {*} _buffer decoded audio */
  register(_id, _buffer) {}

  /**
   * @param {string} _id
   * @param {{volume?: number, pitch?: number, loop?: number}} _options
   * @returns {*} a handle usable with `stop`
   */
  play(_id, _options) {
    return null;
  }

  stop(_handle) {}
  stopAll() {}
  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
  }
  destroy() {}
}

/**
 * Records play calls instead of making sound. Used in Node, and in the browser
 * before the user has interacted with the page (autoplay policy).
 */
export class SilentAudio extends AudioBackend {
  constructor() {
    super();
    /** @type {Array<{id: string, volume: number, pitch: number, loop: boolean, time: number}>} */
    this.log = [];
    this.playing = new Set();
    this.nextHandle = 1;
  }

  register(id) {
    return id;
  }

  play(id, options = {}) {
    const handle = { id, handle: this.nextHandle++ };
    this.log.push({
      id,
      volume: options.volume ?? 1,
      pitch: options.pitch ?? 1,
      loop: Boolean(options.loop),
    });
    if (options.loop) this.playing.add(handle);
    return handle;
  }

  stop(handle) {
    this.playing.delete(handle);
  }

  stopAll() {
    this.playing.clear();
  }

  /** How many times a clip has played. The assertion a test actually wants. */
  countPlays(id) {
    return this.log.filter((entry) => entry.id === id).length;
  }

  /** Was this clip played at all? */
  played(id) {
    return this.log.some((entry) => entry.id === id);
  }

  clear() {
    this.log.length = 0;
    this.playing.clear();
  }
}

/** Web Audio backend. */
export class WebAudio extends AudioBackend {
  constructor(options = {}) {
    super();
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) throw new Error('WebAudio: no AudioContext in this environment');
    this.context = new Ctx();
    this.master = this.context.createGain();
    this.master.gain.value = options.volume ?? 1;
    this.master.connect(this.context.destination);
    /** @type {Map<string, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Set<AudioBufferSourceNode>} */
    this.active = new Set();
  }

  register(id, buffer) {
    this.buffers.set(id, buffer);
  }

  /** Decode raw bytes into a playable buffer. */
  async decode(arrayBuffer) {
    return this.context.decodeAudioData(arrayBuffer);
  }

  /**
   * Browsers suspend the audio context until a user gesture. Call this from a
   * click handler; the runtime wires it to the first input event automatically.
   */
  async resume() {
    if (this.context.state === 'suspended') await this.context.resume();
  }

  play(id, options = {}) {
    const buffer = this.buffers.get(id);
    if (!buffer || this.muted) return null;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.pitch ?? 1;
    source.loop = Boolean(options.loop);

    const gain = this.context.createGain();
    gain.gain.value = (options.volume ?? 1) * this.masterVolume;

    source.connect(gain);
    gain.connect(this.master);
    source.start(0);

    this.active.add(source);
    source.onended = () => this.active.delete(source);
    return source;
  }

  stop(handle) {
    if (!handle) return;
    try {
      handle.stop();
    } catch {
      // Already stopped; Web Audio throws rather than no-op'ing.
    }
    this.active.delete(handle);
  }

  stopAll() {
    for (const source of [...this.active]) this.stop(source);
  }

  setMasterVolume(v) {
    super.setMasterVolume(v);
    this.master.gain.value = this.masterVolume;
  }

  destroy() {
    this.stopAll();
    this.context.close();
  }
}
