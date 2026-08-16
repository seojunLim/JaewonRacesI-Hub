/**
 * Animation systems: sprite clips and property tweens.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { EngineEvents } from '../core/events.js';
import { getEasing } from '../math/scalar.js';

export const SpriteAnimationSystem = defineSystem({
  name: 'SpriteAnimationSystem',
  phase: Phase.UPDATE,
  order: Order.DEFAULT,
  description: 'Advances SpriteAnimator clips and writes the current frame into Sprite.frame.',
  reads: ['SpriteAnimator'],
  writes: ['Sprite'],
  update({ world, dt }) {
    for (const [entity, animator, sprite] of world.each('SpriteAnimator', 'Sprite')) {
      if (!animator.playing || !animator.current) continue;

      const clip = animator.clips.find((c) => c.name === animator.current);
      if (!clip) {
        // Wrong clip names are common in generated scenes and silently freeze
        // the animation, so say so — once, by clearing `current`.
        console.warn(
          `[sjl] SpriteAnimator on "${entity.name}" references unknown clip "${animator.current}". ` +
            `Available: ${animator.clips.map((c) => c.name).join(', ') || '(none)'}`,
        );
        animator.current = '';
        continue;
      }
      if (!clip.frames || clip.frames.length === 0) continue;

      const fps = clip.fps > 0 ? clip.fps : 0;
      if (fps === 0) {
        sprite.frame = clip.frames[Math.min(animator.frameIndex, clip.frames.length - 1)];
        continue;
      }

      animator.timer += dt * animator.speed;
      const frameDuration = 1 / fps;

      while (animator.timer >= frameDuration) {
        animator.timer -= frameDuration;
        const next = animator.frameIndex + 1;

        if (next >= clip.frames.length) {
          if (clip.loop) {
            animator.frameIndex = 0;
          } else {
            animator.frameIndex = clip.frames.length - 1;
            animator.playing = false;
            world.events.queue(EngineEvents.ANIMATION_COMPLETE, { entity, clip: clip.name });
            break;
          }
        } else {
          animator.frameIndex = next;
        }

        for (const event of clip.events ?? []) {
          if (event.frame === animator.frameIndex) {
            world.events.queue(EngineEvents.ANIMATION_EVENT, {
              entity,
              clip: clip.name,
              name: event.name,
              frame: animator.frameIndex,
            });
          }
        }
      }

      sprite.frame = clip.frames[animator.frameIndex] ?? sprite.frame;
    }
  },
});

/**
 * Play a clip from the start. A no-op if the clip is already current, so it is
 * safe to call every frame from a state machine — which is exactly how animation
 * code tends to be written.
 */
export function playClip(entity, clipName, { restart = false } = {}) {
  const animator = entity.require('SpriteAnimator');
  if (animator.current === clipName && !restart && animator.playing) return;
  animator.current = clipName;
  animator.frameIndex = 0;
  animator.timer = 0;
  animator.playing = true;
}

// ---------------------------------------------------------------------------
// Tweens
// ---------------------------------------------------------------------------

export const TweenSystem = defineSystem({
  name: 'TweenSystem',
  phase: Phase.UPDATE,
  order: Order.DEFAULT + 1,
  description:
    'Animates a component property along an easing curve. `target` is a dotted path ' +
    'such as "Transform.position" or "Sprite.opacity".',
  reads: ['Tween'],
  update({ world, dt }) {
    for (const [entity, tween] of world.each('Tween')) {
      if (!tween.playing) continue;

      if (tween.delay > 0) {
        tween.delay -= dt;
        if (tween.delay > 0) continue;
        dt = -tween.delay;
        tween.delay = 0;
      }

      const resolved = resolvePath(entity, tween.target);
      if (!resolved) {
        console.warn(
          `[sjl] Tween on "${entity.name}" targets "${tween.target}", which does not resolve. ` +
            'Expected "ComponentName.field" or "ComponentName.field.subfield".',
        );
        world.removeComponent(entity.id, 'Tween');
        continue;
      }

      if (!tween.started) {
        tween.started = true;
        tween.resolvedFrom = tween.from ?? cloneValue(resolved.get());
      }

      tween.elapsed += dt * tween.direction;
      const duration = Math.max(tween.duration, 1e-6);
      let t = tween.elapsed / duration;
      let finished = false;

      if (t >= 1) {
        if (tween.loop === 'restart') {
          tween.elapsed = 0;
          t = 0;
        } else if (tween.loop === 'pingPong') {
          tween.direction = -1;
          tween.elapsed = duration;
          t = 1;
        } else {
          t = 1;
          finished = true;
        }
      } else if (t <= 0 && tween.direction < 0) {
        if (tween.loop === 'pingPong') {
          tween.direction = 1;
          tween.elapsed = 0;
          t = 0;
        } else {
          t = 0;
          finished = true;
        }
      }

      const eased = getEasing(tween.ease)(Math.min(Math.max(t, 0), 1));
      resolved.set(interpolate(tween.resolvedFrom, tween.to, eased));

      if (finished) {
        world.events.queue(EngineEvents.TWEEN_COMPLETE, { entity, property: tween.target });
        if (tween.destroyOnComplete) {
          world.destroy(entity.id);
        } else if (tween.removeOnComplete) {
          world.removeComponent(entity.id, 'Tween');
        } else {
          tween.playing = false;
        }
      }
    }
  },
});

/**
 * Resolve `"Component.field"` or `"Component.field.sub"` into a getter/setter
 * pair. Returns null when the component or the field does not exist.
 */
function resolvePath(entity, path) {
  const parts = String(path).split('.');
  if (parts.length < 2) return null;
  const [componentName, ...rest] = parts;
  const component = entity.get(componentName);
  if (!component) return null;

  let container = component;
  for (let i = 0; i < rest.length - 1; i++) {
    container = container?.[rest[i]];
    if (container == null || typeof container !== 'object') return null;
  }
  const key = rest[rest.length - 1];
  if (!(key in container)) return null;

  return {
    get: () => container[key],
    set: (value) => {
      // Write into the existing vec2/color object rather than replacing it, so
      // anything holding a reference (a renderer, another system) sees the update.
      const current = container[key];
      if (current && typeof current === 'object' && value && typeof value === 'object') {
        Object.assign(current, value);
      } else {
        container[key] = value;
      }
    },
  };
}

function cloneValue(value) {
  if (value && typeof value === 'object') return { ...value };
  return value;
}

/** Numbers, vec2s and colors all interpolate component-wise. */
function interpolate(from, to, t) {
  if (typeof from === 'number') {
    const target = typeof to === 'number' ? to : Number(to);
    return from + (target - from) * t;
  }
  if (Array.isArray(to)) {
    const a = Array.isArray(from) ? from : [from?.x ?? 0, from?.y ?? 0];
    return { x: a[0] + (to[0] - a[0]) * t, y: a[1] + (to[1] - a[1]) * t };
  }
  if (from && typeof from === 'object' && to && typeof to === 'object') {
    const out = {};
    for (const key of Object.keys(from)) {
      const a = from[key];
      const b = to[key] ?? a;
      out[key] = typeof a === 'number' && typeof b === 'number' ? a + (b - a) * t : a;
    }
    return out;
  }
  return t >= 1 ? to : from;
}

/**
 * Attach a tween imperatively.
 * @example tweenTo(entity, 'Sprite.opacity', 0, { duration: 0.4, ease: 'outQuad' });
 */
export function tweenTo(entity, target, to, options = {}) {
  return entity.world.addComponent(entity.id, 'Tween', { target, to, ...options });
}
