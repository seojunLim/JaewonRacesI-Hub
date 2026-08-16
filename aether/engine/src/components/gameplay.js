/**
 * Animation, audio and general gameplay components.
 */

import { defineComponent } from '../core/component.js';
import { EASING_NAMES } from '../math/scalar.js';

export const SpriteAnimator = defineComponent({
  name: 'SpriteAnimator',
  category: 'Animation',
  requires: ['Sprite'],
  description:
    'Plays frame-based sprite animations. Clips are declared inline so a scene file is ' +
    'self-contained; `sjl validate` checks that `current` names a clip that exists.',
  schema: {
    clips: {
      type: 'array',
      description: 'Animation clips available on this entity',
      items: {
        type: 'object',
        fields: {
          name: { type: 'string', required: true },
          frames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Atlas frame names, in play order',
          },
          fps: { type: 'number', default: 12, min: 0 },
          loop: { type: 'boolean', default: true },
          events: {
            type: 'array',
            description: 'Fires `animation:event` when playback reaches a frame',
            items: {
              type: 'object',
              fields: {
                frame: { type: 'int', default: 0, min: 0 },
                name: { type: 'string' },
              },
            },
          },
        },
      },
      default: [],
    },
    current: { type: 'string', default: '', description: 'Name of the clip to play' },
    playing: { type: 'boolean', default: true },
    speed: { type: 'number', default: 1, description: 'Playback rate multiplier' },
    frameIndex: { type: 'int', default: 0, min: 0 },
    timer: { type: 'number', default: 0 },
  },
});

export const Tween = defineComponent({
  name: 'Tween',
  category: 'Animation',
  description:
    'Animates one numeric or vec2 property over time. `target` is a dotted path into the ' +
    "entity's components, e.g. `Transform.position` or `Sprite.opacity`.",
  schema: {
    target: { type: 'string', required: true, description: 'Dotted path, e.g. "Transform.position"' },
    from: { type: 'any', description: 'Start value. Omit to use the current value on start.' },
    to: { type: 'any', required: true, description: 'End value' },
    duration: { type: 'number', default: 1, min: 0 },
    ease: { type: 'enum', values: EASING_NAMES, default: 'linear' },
    delay: { type: 'number', default: 0, min: 0 },
    loop: { type: 'enum', values: ['none', 'restart', 'pingPong'], default: 'none' },
    playing: { type: 'boolean', default: true },
    destroyOnComplete: { type: 'boolean', default: false, description: 'Destroy the entity when done' },
    removeOnComplete: { type: 'boolean', default: true, description: 'Remove this Tween when done' },
    elapsed: { type: 'number', default: 0 },
    direction: { type: 'int', default: 1 },
    started: { type: 'boolean', default: false },
    resolvedFrom: { type: 'any' },
  },
});

export const AudioSource = defineComponent({
  name: 'AudioSource',
  category: 'Audio',
  description:
    'Plays a sound. In headless runs the audio backend records calls instead of making ' +
    'noise, so tests can assert that the jump sound fired without an audio device.',
  schema: {
    clip: { type: 'asset', assetType: 'audio' },
    volume: { type: 'number', default: 1, min: 0, max: 1 },
    pitch: { type: 'number', default: 1, min: 0.01, max: 4 },
    loop: { type: 'boolean', default: false },
    playOnStart: { type: 'boolean', default: false },
    /** Set true for one frame to trigger playback from a behavior or a scene event. */
    play: { type: 'boolean', default: false },
    /** Read-only: whether the backend reports this source as sounding. */
    playing: { type: 'boolean', default: false },
    handle: { type: 'any' },
  },
});

export const Lifetime = defineComponent({
  name: 'Lifetime',
  category: 'Gameplay',
  description: 'Destroys the entity after `seconds`. The standard way to clean up effects.',
  schema: {
    seconds: { type: 'number', default: 1, min: 0 },
    elapsed: { type: 'number', default: 0 },
  },
});

export const Health = defineComponent({
  name: 'Health',
  category: 'Gameplay',
  description:
    'Hit points. Nothing in the engine reads this — it exists because almost every game ' +
    'declares it identically, and having one shared shape means the editor and the ' +
    'debug overlay can display it.',
  schema: {
    current: { type: 'number', default: 100, min: 0 },
    max: { type: 'number', default: 100, min: 0.0001 },
    invulnerable: { type: 'boolean', default: false },
    invulnerableTimer: { type: 'number', default: 0, min: 0 },
  },
});

export const Behaviors = defineComponent({
  name: 'Behaviors',
  category: 'Core',
  runtime: true,
  description:
    'Holds this entity\'s live behavior instances. Written by the scene loader from the ' +
    'entity-level `behaviors` array — you do not add this component by hand.',
  schema: {
    items: { type: 'any' },
  },
  onAdd(data) {
    if (!Array.isArray(data.items)) data.items = [];
  },
});

export const Follow = defineComponent({
  name: 'Follow',
  category: 'Gameplay',
  requires: ['Transform'],
  description: 'Moves this entity toward another entity every frame. Simpler than a behavior.',
  schema: {
    target: { type: 'entity' },
    offset: { type: 'vec2', default: [0, 0] },
    speed: { type: 'number', default: 0, min: 0, description: '0 means snap to the target instantly' },
    halfLife: { type: 'number', default: 0, min: 0, description: 'If > 0, smooth instead of moving at `speed`' },
    matchRotation: { type: 'boolean', default: false },
  },
});
