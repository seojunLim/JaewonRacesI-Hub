/**
 * The 2D physics world: integration, collision, resolution and queries.
 *
 * The step is a sequential-impulse solver, the same shape as Box2D's:
 *
 *   1. integrate forces into velocities
 *   2. rebuild the broadphase from current collider positions
 *   3. narrow-phase every candidate pair into a manifold
 *   4. iterate the manifolds, applying impulses until velocities agree
 *   5. push overlapping bodies apart (positional correction)
 *   6. integrate velocities into positions
 *   7. diff the contact set against last step and emit enter/stay/exit
 *
 * Determinism is a hard requirement here, so: pairs arrive in a stable order
 * from the broadphase, bodies are iterated in entity-creation order, and no
 * step reads a clock or an unseeded random. Two runs of the same scene produce
 * identical positions, which is what makes physics assertable in a test.
 *
 * ## Bodies and parenting
 *
 * Bodies are simulated in **world space**. An entity with a Rigidbody may still
 * be parented — the solver reads its world transform and writes the result back
 * through the parent's inverse — but a moving parent fighting the solver for
 * control of the same body is not a supported arrangement.
 */

import { SpatialHash } from './broadphase.js';
import { collide, aabbOf, raycastShape, containsPoint, box, circle } from './shapes.js';
import { EngineEvents } from '../core/events.js';
import { setWorldPosition } from '../components/transform.js';
import { syncTransforms } from '../systems/transform.js';

const DEFAULT_SETTINGS = {
  gravity: { x: 0, y: -20 },
  iterations: 8,
  correctionPercent: 0.8,
  slop: 0.01,
  sleepVelocity: 0.05,
  sleepTime: 0.5,
  cellSize: 2,
  enabled: true,
};

export class PhysicsWorld {
  /** @param {import('../core/world.js').World} world */
  constructor(world, settings = {}) {
    this.world = world;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.hash = new SpatialHash(this.settings.cellSize);

    /** Contact keys active last step, for enter/stay/exit diffing. */
    this.previousContacts = new Map();
    this.currentContacts = new Map();

    /** Rebuilt each step; also what queries read, so they see current positions. */
    this.colliders = [];

    this.stats = { bodies: 0, colliders: 0, pairs: 0, contacts: 0, awake: 0 };
  }

  applySettings(settings) {
    Object.assign(this.settings, settings);
    if (this.hash.cellSize !== this.settings.cellSize) {
      this.hash = new SpatialHash(this.settings.cellSize);
    }
  }

  // -------------------------------------------------------------------------
  // Collider gathering
  // -------------------------------------------------------------------------

  /**
   * Build the world-space shape list. Runs every step because anything may have
   * moved; caching it would mean tracking dirty flags across the entire engine
   * for a saving that does not show up at these entity counts.
   */
  gather() {
    const world = this.world;
    this.colliders.length = 0;
    this.hash.clear();

    for (const entity of world.query('Transform')) {
      const wt = entity.get('WorldTransform');
      const t = entity.get('Transform');
      const wx = wt ? wt.x : t.position.x;
      const wy = wt ? wt.y : t.position.y;
      const sx = wt ? Math.abs(wt.scaleX) : Math.abs(t.scale.x);
      const sy = wt ? Math.abs(wt.scaleY) : Math.abs(t.scale.y);

      const body = entity.get('Rigidbody');

      const boxCollider = entity.get('BoxCollider');
      if (boxCollider && boxCollider.enabled) {
        this.addCollider(entity, body, boxCollider, box(
          wx + boxCollider.offset.x * sx,
          wy + boxCollider.offset.y * sy,
          Math.max((boxCollider.size.x * sx) / 2, 1e-6),
          Math.max((boxCollider.size.y * sy) / 2, 1e-6),
        ));
      }

      const circleCollider = entity.get('CircleCollider');
      if (circleCollider && circleCollider.enabled) {
        // A non-uniform scale cannot produce a circle; use the larger axis so
        // the collider never ends up smaller than the sprite it represents.
        const radiusScale = Math.max(sx, sy);
        this.addCollider(entity, body, circleCollider, circle(
          wx + circleCollider.offset.x * sx,
          wy + circleCollider.offset.y * sy,
          Math.max(circleCollider.radius * radiusScale, 1e-6),
        ));
      }
    }

    this.stats.colliders = this.colliders.length;
    return this.colliders;
  }

  addCollider(entity, body, collider, shape) {
    const record = {
      entity,
      entityId: entity.id,
      body,
      collider,
      shape,
      isTrigger: collider.isTrigger,
      // A collider with no Rigidbody is implicitly static — the usual way to
      // author level geometry without a body on every tile.
      type: body ? body.type : 'static',
    };
    this.colliders.push(record);
    this.hash.insert({
      id: entity.id,
      index: 0,
      aabb: aabbOf(shape),
      layer: collider.layer,
      mask: collider.mask,
      data: record,
    });
    return record;
  }

  // -------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------

  /** @param {number} dt fixed timestep in seconds */
  step(dt) {
    if (!this.settings.enabled || dt <= 0) return;
    const world = this.world;

    // Recompute world transforms from the current local ones before doing
    // anything else.
    //
    // Behaviors run in FIXED_PRE, after the scheduler's transform pass, so any
    // entity a behavior moved has a fresh `Transform` and a stale
    // `WorldTransform`. Integrating from the stale copy would write the old
    // position straight back and silently undo the behavior's movement — which
    // looks exactly like "my kinematic body refuses to move".
    syncTransforms(world);

    const bodies = world.query('Rigidbody', 'Transform');
    this.stats.bodies = bodies.length;

    this.integrateForces(bodies, dt);
    this.gather();

    const pairs = this.hash.pairs((a, b) => {
      // Triggers report overlaps regardless of body type — a static trigger
      // zone with a kinematic body passing through it is the normal case, and
      // requiring a dynamic body would make most triggers silently never fire.
      const isTrigger = a.data.isTrigger || b.data.isTrigger;
      // Without a trigger there is nothing to report and, unless one side is
      // dynamic, nothing to resolve either.
      if (!isTrigger && a.data.type !== 'dynamic' && b.data.type !== 'dynamic') return false;
      // Both asleep means neither can be affected this step.
      if (a.data.body?.sleeping && b.data.body?.sleeping) return false;
      return true;
    });
    this.stats.pairs = pairs.length;

    const manifolds = [];
    this.currentContacts = new Map();

    for (const [pa, pb] of pairs) {
      const a = pa.data;
      const b = pb.data;
      const manifold = collide(a.shape, b.shape);
      if (!manifold) continue;

      const key = contactKey(a.entityId, b.entityId);
      this.currentContacts.set(key, { a, b, manifold });

      if (a.isTrigger || b.isTrigger) continue;
      manifolds.push({ a, b, manifold });
    }

    // Clear grounded before solving; contacts this step set it again. Sleeping
    // bodies are skipped by the solver, so clearing theirs would report a
    // resting character as airborne — and a platformer controller reading that
    // would refuse to jump.
    for (const entity of bodies) {
      const rb = entity.get('Rigidbody');
      if (rb.type === 'dynamic' && !rb.sleeping) rb.grounded = false;
    }

    for (let i = 0; i < this.settings.iterations; i++) {
      for (const contact of manifolds) this.resolveVelocity(contact);
    }
    for (const contact of manifolds) this.resolvePosition(contact);

    this.integrateVelocities(bodies, dt);
    this.updateSleep(bodies, dt);
    this.emitContactEvents();

    this.stats.contacts = this.currentContacts.size;
    this.previousContacts = this.currentContacts;
  }

  integrateForces(bodies, dt) {
    const g = this.settings.gravity;
    for (const entity of bodies) {
      const rb = entity.get('Rigidbody');
      if (rb.type !== 'dynamic' || rb.sleeping) {
        rb.force.x = 0;
        rb.force.y = 0;
        rb.torque = 0;
        continue;
      }

      const invMass = 1 / rb.mass;
      rb.velocity.x += (g.x * rb.gravityScale + rb.force.x * invMass) * dt;
      rb.velocity.y += (g.y * rb.gravityScale + rb.force.y * invMass) * dt;
      rb.angularVelocity += rb.torque * invMass * dt;

      // Exponential damping, so the result does not depend on the step size.
      if (rb.linearDamping > 0) {
        const factor = 1 / (1 + rb.linearDamping * dt);
        rb.velocity.x *= factor;
        rb.velocity.y *= factor;
      }
      if (rb.angularDamping > 0) {
        rb.angularVelocity *= 1 / (1 + rb.angularDamping * dt);
      }

      if (rb.freezeX) rb.velocity.x = 0;
      if (rb.freezeY) rb.velocity.y = 0;
      if (rb.freezeRotation) rb.angularVelocity = 0;

      rb.force.x = 0;
      rb.force.y = 0;
      rb.torque = 0;
    }
  }

  integrateVelocities(bodies, dt) {
    for (const entity of bodies) {
      const rb = entity.get('Rigidbody');
      if (rb.type === 'static' || rb.sleeping) continue;

      const t = entity.get('Transform');
      const wt = entity.get('WorldTransform');
      const wx = wt ? wt.x : t.position.x;
      const wy = wt ? wt.y : t.position.y;

      const nx = wx + rb.velocity.x * dt;
      const ny = wy + rb.velocity.y * dt;

      if (entity.parent) {
        setWorldPosition(entity, nx, ny);
      } else {
        t.position.x = nx;
        t.position.y = ny;
      }
      if (!rb.freezeRotation) t.rotation += rb.angularVelocity * dt;

      // Keep WorldTransform coherent for anything reading it later in the step
      // (raycasts from a fixedUpdate hook, for instance).
      if (wt && !entity.parent) {
        wt.x = nx;
        wt.y = ny;
      }
    }
  }

  /**
   * Sequential impulse along the contact normal, plus Coulomb friction along
   * the tangent.
   */
  resolveVelocity({ a, b, manifold }) {
    const ra = a.body;
    const rb = b.body;
    const aDynamic = a.type === 'dynamic' && !ra?.sleeping;
    const bDynamic = b.type === 'dynamic' && !rb?.sleeping;
    if (!aDynamic && !bDynamic) return;

    const invMassA = aDynamic ? 1 / ra.mass : 0;
    const invMassB = bDynamic ? 1 / rb.mass : 0;
    const invMassSum = invMassA + invMassB;
    if (invMassSum === 0) return;

    const va = ra?.velocity ?? ZERO_VELOCITY;
    const vb = rb?.velocity ?? ZERO_VELOCITY;

    const rvx = vb.x - va.x;
    const rvy = vb.y - va.y;
    const velAlongNormal = rvx * manifold.nx + rvy * manifold.ny;

    // Already separating: leave it alone, or the impulse would suck them back
    // together.
    if (velAlongNormal > 0) return;

    // Take the *larger* restitution, as Box2D does. With `min`, marking a ball
    // bouncy would do nothing until you also marked every surface it might
    // touch — which is not what "this ball is bouncy" means.
    const restitution = Math.max(a.collider.restitution, b.collider.restitution);
    // Below a threshold, restitution is suppressed. Without this, a resting
    // body microbounces forever and never sleeps.
    const bounce = Math.abs(velAlongNormal) < 1 ? 0 : restitution;

    const j = (-(1 + bounce) * velAlongNormal) / invMassSum;
    const ix = manifold.nx * j;
    const iy = manifold.ny * j;

    if (aDynamic) applyImpulse(ra, -ix * invMassA, -iy * invMassA);
    if (bDynamic) applyImpulse(rb, ix * invMassB, iy * invMassB);

    // Friction along the tangent, clamped by Coulomb's law.
    const tx = rvx - manifold.nx * velAlongNormal;
    const ty = rvy - manifold.ny * velAlongNormal;
    const tLen = Math.hypot(tx, ty);
    if (tLen > 1e-6) {
      const tnx = tx / tLen;
      const tny = ty / tLen;
      let jt = -(rvx * tnx + rvy * tny) / invMassSum;
      const mu = Math.sqrt(a.collider.friction * b.collider.friction);
      const maxFriction = Math.abs(j) * mu;
      jt = Math.max(-maxFriction, Math.min(maxFriction, jt));

      if (aDynamic) applyImpulse(ra, -tnx * jt * invMassA, -tny * jt * invMassA);
      if (bDynamic) applyImpulse(rb, tnx * jt * invMassB, tny * jt * invMassB);
    }

    // "Grounded" means a contact whose normal points mostly upward relative to
    // the body — the check every character controller needs.
    if (aDynamic && manifold.ny < -0.5) ra.grounded = true;
    if (bDynamic && manifold.ny > 0.5) rb.grounded = true;
  }

  /**
   * Baumgarte-style positional correction: velocity impulses alone leave bodies
   * slightly overlapped, and the error accumulates into visible sinking.
   */
  resolvePosition({ a, b, manifold }) {
    const ra = a.body;
    const rb = b.body;
    const aDynamic = a.type === 'dynamic' && !ra?.sleeping;
    const bDynamic = b.type === 'dynamic' && !rb?.sleeping;
    if (!aDynamic && !bDynamic) return;

    const invMassA = aDynamic ? 1 / ra.mass : 0;
    const invMassB = bDynamic ? 1 / rb.mass : 0;
    const invMassSum = invMassA + invMassB;
    if (invMassSum === 0) return;

    const correction =
      (Math.max(manifold.depth - this.settings.slop, 0) / invMassSum) * this.settings.correctionPercent;
    const cx = manifold.nx * correction;
    const cy = manifold.ny * correction;

    if (aDynamic) this.translate(a.entity, -cx * invMassA, -cy * invMassA, ra);
    if (bDynamic) this.translate(b.entity, cx * invMassB, cy * invMassB, rb);
  }

  translate(entity, dx, dy, body) {
    if (body?.freezeX) dx = 0;
    if (body?.freezeY) dy = 0;
    const t = entity.get('Transform');
    const wt = entity.get('WorldTransform');
    if (entity.parent) {
      const wx = (wt ? wt.x : t.position.x) + dx;
      const wy = (wt ? wt.y : t.position.y) + dy;
      setWorldPosition(entity, wx, wy);
      if (wt) {
        wt.x = wx;
        wt.y = wy;
      }
    } else {
      t.position.x += dx;
      t.position.y += dy;
      if (wt) {
        wt.x = t.position.x;
        wt.y = t.position.y;
      }
    }
    // Keep the collider shape in sync so later iterations of the solver see the
    // corrected position instead of re-resolving the same overlap.
    for (const record of this.colliders) {
      if (record.entityId === entity.id) {
        record.shape.x += dx;
        record.shape.y += dy;
      }
    }
  }

  updateSleep(bodies, dt) {
    let awake = 0;
    const { sleepVelocity, sleepTime } = this.settings;
    for (const entity of bodies) {
      const rb = entity.get('Rigidbody');
      if (rb.type !== 'dynamic') continue;
      if (!rb.canSleep) {
        rb.sleeping = false;
        awake++;
        continue;
      }
      const speed = Math.hypot(rb.velocity.x, rb.velocity.y);
      if (speed > sleepVelocity || Math.abs(rb.angularVelocity) > sleepVelocity * 60) {
        rb.sleepTimer = 0;
        rb.sleeping = false;
      } else {
        rb.sleepTimer += dt;
        if (rb.sleepTimer >= sleepTime) {
          rb.sleeping = true;
          rb.velocity.x = 0;
          rb.velocity.y = 0;
          rb.angularVelocity = 0;
        }
      }
      if (!rb.sleeping) awake++;
    }
    this.stats.awake = awake;
  }

  /** Diff this step's contacts against last step's and queue the events. */
  emitContactEvents() {
    const events = this.world.events;

    for (const [key, contact] of this.currentContacts) {
      const isTrigger = contact.a.isTrigger || contact.b.isTrigger;
      const existed = this.previousContacts.has(key);
      const payload = {
        a: contact.a.entity,
        b: contact.b.entity,
        normal: { x: contact.manifold.nx, y: contact.manifold.ny },
        depth: contact.manifold.depth,
        contact: { x: contact.manifold.cx, y: contact.manifold.cy },
      };
      if (isTrigger) {
        events.queue(existed ? EngineEvents.TRIGGER_STAY : EngineEvents.TRIGGER_ENTER, payload);
      } else {
        events.queue(existed ? EngineEvents.COLLISION_STAY : EngineEvents.COLLISION_ENTER, payload);
      }
    }

    for (const [key, contact] of this.previousContacts) {
      if (this.currentContacts.has(key)) continue;
      // Skip exits for entities that were destroyed — the handler would get a
      // dead handle, and "it stopped touching me because it ceased to exist" is
      // not information a game usually wants.
      if (!contact.a.entity.alive || !contact.b.entity.alive) continue;
      const payload = { a: contact.a.entity, b: contact.b.entity };
      const isTrigger = contact.a.isTrigger || contact.b.isTrigger;
      events.queue(isTrigger ? EngineEvents.TRIGGER_EXIT : EngineEvents.COLLISION_EXIT, payload);
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Cast a ray and return the nearest hit.
   *
   * @param {{x:number,y:number}} origin
   * @param {{x:number,y:number}} direction  need not be normalized
   * @param {object} [options]
   * @param {number} [options.maxDistance=Infinity]
   * @param {number} [options.mask=-1]        collision layers to test
   * @param {number[]} [options.ignore]       entity ids to skip
   * @param {boolean} [options.includeTriggers=false]
   * @returns {{entity: *, point: {x,y}, normal: {x,y}, distance: number}|null}
   */
  raycast(origin, direction, options = {}) {
    const hits = this.raycastAll(origin, direction, { ...options, sorted: true });
    return hits[0] ?? null;
  }

  /** Every hit along a ray, nearest first. */
  raycastAll(origin, direction, options = {}) {
    const maxDistance = options.maxDistance ?? Infinity;
    const mask = options.mask ?? -1;
    const ignore = options.ignore ? new Set(options.ignore) : null;
    const includeTriggers = options.includeTriggers ?? false;

    const len = Math.hypot(direction.x, direction.y);
    if (len === 0) return [];
    const dx = direction.x / len;
    const dy = direction.y / len;

    const searchDistance = Number.isFinite(maxDistance) ? maxDistance : 1e6;
    const candidates = this.hash.queryRay(origin.x, origin.y, dx, dy, searchDistance, mask);

    const hits = [];
    for (const proxy of candidates) {
      const record = proxy.data;
      if (ignore?.has(record.entityId)) continue;
      if (record.isTrigger && !includeTriggers) continue;
      const hit = raycastShape(record.shape, origin.x, origin.y, dx, dy, maxDistance);
      if (!hit) continue;
      hits.push({
        entity: record.entity,
        collider: record.collider,
        point: { x: hit.x, y: hit.y },
        normal: { x: hit.nx, y: hit.ny },
        distance: hit.t,
      });
    }
    hits.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id);
    return hits;
  }

  /** Every collider overlapping an axis-aligned box, in stable order. */
  overlapBox(center, size, options = {}) {
    const hw = size.x / 2;
    const hh = size.y / 2;
    const query = box(center.x, center.y, hw, hh);
    return this.overlapShape(query, options);
  }

  overlapCircle(center, radius, options = {}) {
    return this.overlapShape(circle(center.x, center.y, radius), options);
  }

  overlapShape(shape, options = {}) {
    const mask = options.mask ?? -1;
    const ignore = options.ignore ? new Set(options.ignore) : null;
    const includeTriggers = options.includeTriggers ?? true;
    const aabb = aabbOf(shape);
    const candidates = this.hash.queryAABB(aabb.minX, aabb.minY, aabb.maxX, aabb.maxY, mask);

    const out = [];
    for (const proxy of candidates) {
      const record = proxy.data;
      if (ignore?.has(record.entityId)) continue;
      if (record.isTrigger && !includeTriggers) continue;
      if (!collide(shape, record.shape)) continue;
      out.push(record.entity);
    }
    return out;
  }

  /** Every collider containing a world point. */
  queryPoint(x, y, options = {}) {
    const mask = options.mask ?? -1;
    const includeTriggers = options.includeTriggers ?? true;
    const out = [];
    for (const proxy of this.hash.queryPoint(x, y, mask)) {
      const record = proxy.data;
      if (record.isTrigger && !includeTriggers) continue;
      if (containsPoint(record.shape, x, y)) out.push(record.entity);
    }
    return out;
  }

  /** Drop all cached contact state — call after loading a new scene. */
  reset() {
    this.previousContacts.clear();
    this.currentContacts.clear();
    this.hash.clear();
    this.colliders.length = 0;
  }
}

const ZERO_VELOCITY = Object.freeze({ x: 0, y: 0 });

function applyImpulse(body, dx, dy) {
  if (!body.freezeX) body.velocity.x += dx;
  if (!body.freezeY) body.velocity.y += dy;
}

/** Order-independent key for an entity pair. */
function contactKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
