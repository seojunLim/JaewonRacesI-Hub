/**
 * AudioSystem — turns AudioSource component state into backend calls.
 */

import { Phase, Order, defineSystem } from '../core/system.js';

export const AUDIO_RESOURCE = 'audio';

/** @returns {import('../audio/audio.js').AudioBackend|undefined} */
export function getAudio(world) {
  return world.getResource(AUDIO_RESOURCE);
}

/**
 * Play a one-shot without needing an entity or a component.
 * The common case: a behavior wants a sound *now*.
 */
export function playSound(world, clip, options = {}) {
  return getAudio(world)?.play(clip, options) ?? null;
}

export const AudioSystem = defineSystem({
  name: 'AudioSystem',
  phase: Phase.LATE_UPDATE,
  order: Order.LAST,
  description:
    'Plays AudioSource clips. Set `play: true` on the component from anywhere; the ' +
    'system starts the sound and clears the flag, so it fires exactly once.',
  reads: ['AudioSource'],
  update({ world }) {
    const audio = world.getResource(AUDIO_RESOURCE);
    if (!audio) return;

    for (const [entity, source] of world.each('AudioSource')) {
      if (!source.play) continue;
      source.play = false;

      if (!source.clip) {
        console.warn(`[sjl] AudioSource on "${entity.name}" was triggered but has no clip set.`);
        continue;
      }
      // Restart looping sources rather than stacking a second copy on top.
      if (source.loop && source.handle) audio.stop(source.handle);

      source.handle = audio.play(source.clip, {
        volume: source.volume,
        pitch: source.pitch,
        loop: source.loop,
      });
      source.playing = Boolean(source.handle);
    }
  },
  start({ world }) {
    // `playOnStart` fires once, when the scene begins.
    for (const [, source] of world.each('AudioSource')) {
      if (source.playOnStart) source.play = true;
    }
  },
  stop({ world }) {
    world.getResource(AUDIO_RESOURCE)?.stopAll();
  },
});

/** Stop a looping AudioSource. */
export function stopSource(world, entity) {
  const source = entity.get('AudioSource');
  if (!source?.handle) return;
  getAudio(world)?.stop(source.handle);
  source.handle = null;
  source.playing = false;
}
