/**
 * Small built-in gameplay systems: lifetimes, following, particles, audio
 * triggering and camera follow.
 *
 * Each is a handful of lines. They exist as engine built-ins because every
 * project writes them, and having one canonical version means the editor can
 * show them and `sjl describe` can list them, instead of each game inventing
 * its own slightly different `Lifetime`.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { damp } from '../math/scalar.js';
import * as Color from '../math/color.js';

export const LifetimeSystem = defineSystem({
  name: 'LifetimeSystem',
  phase: Phase.UPDATE,
  order: Order.LATE,
  description: 'Destroys entities whose Lifetime has elapsed.',
  reads: ['Lifetime'],
  update({ world, dt }) {
    for (const [entity, lifetime] of world.each('Lifetime')) {
      lifetime.elapsed += dt;
      if (lifetime.elapsed >= lifetime.seconds) world.destroy(entity.id);
    }
  },
});

export const HealthSystem = defineSystem({
  name: 'HealthSystem',
  phase: Phase.UPDATE,
  order: Order.DEFAULT,
  description: 'Counts down invulnerability timers on Health components.',
  reads: ['Health'],
  update({ world, dt }) {
    for (const [, health] of world.each('Health')) {
      if (health.invulnerableTimer > 0) {
        health.invulnerableTimer = Math.max(0, health.invulnerableTimer - dt);
        if (health.invulnerableTimer === 0) health.invulnerable = false;
      }
    }
  },
});

export const FollowSystem = defineSystem({
  name: 'FollowSystem',
  phase: Phase.LATE_UPDATE,
  order: Order.DEFAULT,
  description: 'Moves entities with a Follow component toward their target.',
  reads: ['Follow'],
  writes: ['Transform'],
  update({ world, dt }) {
    for (const [entity, follow, transform] of world.each('Follow', 'Transform')) {
      if (!follow.target) continue;
      const target = world.findById(follow.target) ?? world.findByName(follow.target);
      if (!target?.alive) continue;

      const tw = target.get('WorldTransform');
      const tt = target.get('Transform');
      const tx = (tw ? tw.x : tt?.position.x ?? 0) + follow.offset.x;
      const ty = (tw ? tw.y : tt?.position.y ?? 0) + follow.offset.y;

      if (follow.halfLife > 0) {
        transform.position.x = damp(transform.position.x, tx, follow.halfLife, dt);
        transform.position.y = damp(transform.position.y, ty, follow.halfLife, dt);
      } else if (follow.speed > 0) {
        const dx = tx - transform.position.x;
        const dy = ty - transform.position.y;
        const dist = Math.hypot(dx, dy);
        const step = follow.speed * dt;
        if (dist <= step || dist === 0) {
          transform.position.x = tx;
          transform.position.y = ty;
        } else {
          transform.position.x += (dx / dist) * step;
          transform.position.y += (dy / dist) * step;
        }
      } else {
        transform.position.x = tx;
        transform.position.y = ty;
      }

      if (follow.matchRotation && tt) transform.rotation = tt.rotation;
    }
  },
});

export const CameraFollowSystem = defineSystem({
  name: 'CameraFollowSystem',
  phase: Phase.LATE_UPDATE,
  order: Order.LATE,
  description:
    'Moves a camera toward its follow target with a dead zone and optional world bounds. ' +
    'Runs late so it sees the final position of whatever it is tracking this frame.',
  reads: ['CameraFollow', 'Camera'],
  writes: ['Transform'],
  update({ world, dt }) {
    for (const [entity, follow, transform] of world.each('CameraFollow', 'Transform')) {
      if (!follow.target) continue;
      const target = world.findById(follow.target) ?? world.findByName(follow.target);
      if (!target?.alive) continue;

      const tw = target.get('WorldTransform');
      const tt = target.get('Transform');
      let desiredX = (tw ? tw.x : tt?.position.x ?? 0) + follow.offset.x;
      let desiredY = (tw ? tw.y : tt?.position.y ?? 0) + follow.offset.y;

      // Dead zone: the camera holds still while the target stays inside it,
      // which is what stops a platformer camera twitching on every small jump.
      if (follow.deadZone.x > 0) {
        const dx = desiredX - transform.position.x;
        if (Math.abs(dx) <= follow.deadZone.x) desiredX = transform.position.x;
        else desiredX = transform.position.x + dx - Math.sign(dx) * follow.deadZone.x;
      }
      if (follow.deadZone.y > 0) {
        const dy = desiredY - transform.position.y;
        if (Math.abs(dy) <= follow.deadZone.y) desiredY = transform.position.y;
        else desiredY = transform.position.y + dy - Math.sign(dy) * follow.deadZone.y;
      }

      if (follow.lockX) desiredX = transform.position.x;
      if (follow.lockY) desiredY = transform.position.y;

      if (follow.halfLife > 0) {
        transform.position.x = damp(transform.position.x, desiredX, follow.halfLife, dt);
        transform.position.y = damp(transform.position.y, desiredY, follow.halfLife, dt);
      } else {
        transform.position.x = desiredX;
        transform.position.y = desiredY;
      }

      const camera = entity.get('Camera');
      if (camera?.bounds?.enabled) {
        transform.position.x = Math.min(
          Math.max(transform.position.x, camera.bounds.min.x),
          camera.bounds.max.x,
        );
        transform.position.y = Math.min(
          Math.max(transform.position.y, camera.bounds.min.y),
          camera.bounds.max.y,
        );
      }
    }
  },
});

export const ParticleSystem = defineSystem({
  name: 'ParticleSystem',
  phase: Phase.UPDATE,
  order: Order.LATE,
  description:
    'Simulates ParticleEmitter particles. Uses the world\'s seeded RNG, so a particle ' +
    'effect looks identical on every run — including in headless captures.',
  reads: ['ParticleEmitter'],
  update({ world, dt }) {
    for (const [entity, emitter] of world.each('ParticleEmitter')) {
      const wt = entity.get('WorldTransform');
      const t = entity.get('Transform');
      const ox = wt ? wt.x : t?.position.x ?? 0;
      const oy = wt ? wt.y : t?.position.y ?? 0;
      const rng = world.random;

      // Simulate existing particles first, so a particle spawned this frame is
      // not immediately aged by a full step.
      const alive = [];
      for (const p of emitter.particles) {
        p.age += dt;
        if (p.age >= p.life) continue;
        if (emitter.drag > 0) {
          const factor = 1 / (1 + emitter.drag * dt);
          p.vx *= factor;
          p.vy *= factor;
        }
        p.vx += emitter.gravity.x * dt;
        p.vy += emitter.gravity.y * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        alive.push(p);
      }
      emitter.particles = alive;

      if (!emitter.enabled) continue;

      let toEmit = 0;
      if (emitter.burst > 0) {
        toEmit += emitter.burst;
        emitter.burst = 0;
      }
      if (emitter.rate > 0) {
        emitter.emitAccumulator += emitter.rate * dt;
        const whole = Math.floor(emitter.emitAccumulator);
        emitter.emitAccumulator -= whole;
        toEmit += whole;
      }

      const room = emitter.maxParticles - emitter.particles.length;
      toEmit = Math.min(toEmit, Math.max(0, room));

      for (let i = 0; i < toEmit; i++) {
        const angle =
          (emitter.direction + rng.range(-emitter.spread / 2, emitter.spread / 2)) * (Math.PI / 180);
        const speed = rng.range(emitter.speed.x, emitter.speed.y);
        emitter.particles.push({
          x: ox,
          y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          age: 0,
          life: rng.range(emitter.lifetime.x, emitter.lifetime.y),
          startSize: rng.range(emitter.startSize.x, emitter.startSize.y),
        });
      }
    }
  },
});

/** Interpolated color for a particle at its current age. Used by renderers. */
export function particleColor(emitter, particle, out = Color.color()) {
  return Color.lerp(emitter.startColor, emitter.endColor, particle.age / particle.life, out);
}

/** Interpolated size for a particle at its current age. */
export function particleSize(emitter, particle) {
  const t = particle.age / particle.life;
  return particle.startSize + (emitter.endSize - particle.startSize) * t;
}
