/**
 * The 3D physics world.
 *
 * Structurally identical to the 2D solver — integrate forces, rebuild the
 * broadphase, narrow-phase into manifolds, iterate impulses, correct positions,
 * integrate velocities, diff contacts — with the same determinism guarantees:
 * stable pair order, creation-order body iteration, no clock or unseeded random
 * anywhere in the step.
 *
 * Angular dynamics are not simulated. With axis-aligned boxes and spheres there
 * is no meaningful inertia tensor, and a box that tumbles while its collider
 * stays axis-aligned looks worse than one that does not. `angularVelocity` on a
 * Rigidbody3D spins the visual transform and nothing else, which is documented
 * on the component.
 */

import { SpatialHash3D } from './broadphase.js';
import { collide, aabbOf, raycastShape, containsPoint, box3, sphere3 } from './shapes.js';
import { EngineEvents } from '../core/events.js';
import { setWorldPosition3D } from '../components/transform3d.js';
import { syncTransforms3D } from '../systems/transform3d.js';

const DEFAULT_SETTINGS = {
  gravity: { x: 0, y: -20, z: 0 },
  iterations: 8,
  correctionPercent: 0.8,
  slop: 0.01,
  sleepVelocity: 0.05,
  sleepTime: 0.5,
  cellSize: 2,
  enabled: true,
};

export class Physics3DWorld {
  /** @param {import('../core/world.js').World} world */
  constructor(world, settings = {}) {
    this.world = world;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.hash = new SpatialHash3D(this.settings.cellSize);

    this.previousContacts = new Map();
    this.currentContacts = new Map();
    this.colliders = [];

    this.stats = { bodies: 0, colliders: 0, pairs: 0, contacts: 0, awake: 0 };
  }

  applySettings(settings) {
    Object.assign(this.settings, settings);
    if (this.hash.cellSize !== this.settings.cellSize) {
      this.hash = new SpatialHash3D(this.settings.cellSize);
    }
  }

  // -------------------------------------------------------------------------
  // Collider gathering
  // -------------------------------------------------------------------------

  gather() {
    const world = this.world;
    this.colliders.length = 0;
    this.hash.clear();

    for (const entity of world.query('Transform3D')) {
      const wt = entity.get('WorldTransform3D');
      const t = entity.get('Transform3D');
      const position = wt ? wt.position : t.position;
      const scale = wt ? wt.scale : t.scale;
      const sx = Math.abs(scale.x);
      const sy = Math.abs(scale.y);
      const sz = Math.abs(scale.z);

      const body = entity.get('Rigidbody3D');

      const boxCollider = entity.get('BoxCollider3D');
      if (boxCollider?.enabled) {
        this.addCollider(entity, body, boxCollider, box3(
          position.x + boxCollider.offset.x * sx,
          position.y + boxCollider.offset.y * sy,
          position.z + boxCollider.offset.z * sz,
          Math.max((boxCollider.size.x * sx) / 2, 1e-6),
          Math.max((boxCollider.size.y * sy) / 2, 1e-6),
          Math.max((boxCollider.size.z * sz) / 2, 1e-6),
        ));
      }

      const sphereCollider = entity.get('SphereCollider');
      if (sphereCollider?.enabled) {
        // A non-uniform scale cannot produce a sphere; take the largest axis so
        // the collider is never smaller than the mesh it stands in for.
        const radiusScale = Math.max(sx, sy, sz);
        this.addCollider(entity, body, sphereCollider, sphere3(
          position.x + sphereCollider.offset.x * sx,
          position.y + sphereCollider.offset.y * sy,
          position.z + sphereCollider.offset.z * sz,
          Math.max(sphereCollider.radius * radiusScale, 1e-6),
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
      // A collider with no Rigidbody3D is implicitly static — how level
      // geometry is authored without a body on every block.
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

  step(dt) {
    if (!this.settings.enabled || dt <= 0) return;
    const world = this.world;

    // Behaviors run before this in FIXED_PRE, so their transform writes must be
    // folded into the world transforms before anything reads a collider
    // position — otherwise integration writes the pre-behavior position back.
    syncTransforms3D(world);

    const bodies = world.query('Rigidbody3D', 'Transform3D');
    this.stats.bodies = bodies.length;

    this.integrateForces(bodies, dt);
    this.gather();

    const pairs = this.hash.pairs((a, b) => {
      const isTrigger = a.data.isTrigger || b.data.isTrigger;
      if (!isTrigger && a.data.type !== 'dynamic' && b.data.type !== 'dynamic') return false;
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

      this.currentContacts.set(contactKey(a.entityId, b.entityId), { a, b, manifold });
      if (a.isTrigger || b.isTrigger) continue;
      manifolds.push({ a, b, manifold });
    }

    // Sleeping bodies keep their grounded flag: clearing it would report a
    // resting character as airborne and a controller would refuse to jump.
    for (const entity of bodies) {
      const rb = entity.get('Rigidbody3D');
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
      const rb = entity.get('Rigidbody3D');
      if (rb.type !== 'dynamic' || rb.sleeping) continue;

      rb.velocity.x += g.x * rb.gravityScale * dt;
      rb.velocity.y += g.y * rb.gravityScale * dt;
      rb.velocity.z += g.z * rb.gravityScale * dt;

      // Exponential damping, so the result does not depend on the step size.
      if (rb.linearDamping > 0) {
        const factor = 1 / (1 + rb.linearDamping * dt);
        rb.velocity.x *= factor;
        rb.velocity.y *= factor;
        rb.velocity.z *= factor;
      }

      if (rb.freezeX) rb.velocity.x = 0;
      if (rb.freezeY) rb.velocity.y = 0;
      if (rb.freezeZ) rb.velocity.z = 0;
    }
  }

  integrateVelocities(bodies, dt) {
    for (const entity of bodies) {
      const rb = entity.get('Rigidbody3D');
      if (rb.type === 'static' || rb.sleeping) continue;

      const t = entity.get('Transform3D');
      const wt = entity.get('WorldTransform3D');
      const world = wt ? wt.position : t.position;

      const nx = world.x + rb.velocity.x * dt;
      const ny = world.y + rb.velocity.y * dt;
      const nz = world.z + rb.velocity.z * dt;

      if (entity.parent) {
        setWorldPosition3D(entity, nx, ny, nz);
      } else {
        t.position.x = nx;
        t.position.y = ny;
        t.position.z = nz;
      }

      // Visual-only spin.
      t.rotation.x += rb.angularVelocity.x * dt;
      t.rotation.y += rb.angularVelocity.y * dt;
      t.rotation.z += rb.angularVelocity.z * dt;

      // Keep the world transform coherent for anything reading it later in the
      // step, such as a raycast from a fixedUpdate hook.
      if (wt && !entity.parent) {
        wt.position.x = nx;
        wt.position.y = ny;
        wt.position.z = nz;
      }
    }
  }

  /** Sequential impulse along the contact normal, plus Coulomb friction. */
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

    const va = ra?.velocity ?? ZERO;
    const vb = rb?.velocity ?? ZERO;

    const rvx = vb.x - va.x;
    const rvy = vb.y - va.y;
    const rvz = vb.z - va.z;
    const velAlongNormal = rvx * manifold.nx + rvy * manifold.ny + rvz * manifold.nz;

    // Already separating: an impulse here would suck them back together.
    if (velAlongNormal > 0) return;

    // As in 2D, take the larger restitution — marking a ball bouncy should not
    // require marking every surface it might touch.
    const restitution = Math.max(a.collider.restitution, b.collider.restitution);
    // Suppressed at low speed, or a resting body microbounces and never sleeps.
    const bounce = Math.abs(velAlongNormal) < 1 ? 0 : restitution;

    const j = (-(1 + bounce) * velAlongNormal) / invMassSum;
    const ix = manifold.nx * j;
    const iy = manifold.ny * j;
    const iz = manifold.nz * j;

    if (aDynamic) applyImpulse(ra, -ix * invMassA, -iy * invMassA, -iz * invMassA);
    if (bDynamic) applyImpulse(rb, ix * invMassB, iy * invMassB, iz * invMassB);

    // Friction along the tangent, clamped by Coulomb's law.
    const tx = rvx - manifold.nx * velAlongNormal;
    const ty = rvy - manifold.ny * velAlongNormal;
    const tz = rvz - manifold.nz * velAlongNormal;
    const tLen = Math.hypot(tx, ty, tz);
    if (tLen > 1e-6) {
      const tnx = tx / tLen;
      const tny = ty / tLen;
      const tnz = tz / tLen;
      let jt = -(rvx * tnx + rvy * tny + rvz * tnz) / invMassSum;
      const mu = Math.sqrt(a.collider.friction * b.collider.friction);
      const maxFriction = Math.abs(j) * mu;
      jt = Math.max(-maxFriction, Math.min(maxFriction, jt));

      if (aDynamic) applyImpulse(ra, -tnx * jt * invMassA, -tny * jt * invMassA, -tnz * jt * invMassA);
      if (bDynamic) applyImpulse(rb, tnx * jt * invMassB, tny * jt * invMassB, tnz * jt * invMassB);
    }

    // "Grounded": a contact whose normal points mostly upward for this body.
    if (aDynamic && manifold.ny < -0.5) ra.grounded = true;
    if (bDynamic && manifold.ny > 0.5) rb.grounded = true;
  }

  /** Positional correction — impulses alone leave a residual overlap. */
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

    if (aDynamic) {
      this.translate(a.entity, -manifold.nx * correction * invMassA, -manifold.ny * correction * invMassA, -manifold.nz * correction * invMassA, ra);
    }
    if (bDynamic) {
      this.translate(b.entity, manifold.nx * correction * invMassB, manifold.ny * correction * invMassB, manifold.nz * correction * invMassB, rb);
    }
  }

  translate(entity, dx, dy, dz, body) {
    if (body?.freezeX) dx = 0;
    if (body?.freezeY) dy = 0;
    if (body?.freezeZ) dz = 0;

    const t = entity.get('Transform3D');
    const wt = entity.get('WorldTransform3D');

    if (entity.parent) {
      const current = wt ? wt.position : t.position;
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nz = current.z + dz;
      setWorldPosition3D(entity, nx, ny, nz);
      if (wt) {
        wt.position.x = nx;
        wt.position.y = ny;
        wt.position.z = nz;
      }
    } else {
      t.position.x += dx;
      t.position.y += dy;
      t.position.z += dz;
      if (wt) {
        wt.position.x = t.position.x;
        wt.position.y = t.position.y;
        wt.position.z = t.position.z;
      }
    }

    // Keep the collider shapes in sync so later solver iterations see the
    // corrected position instead of re-resolving the same overlap.
    for (const record of this.colliders) {
      if (record.entityId === entity.id) {
        record.shape.x += dx;
        record.shape.y += dy;
        record.shape.z += dz;
      }
    }
  }

  updateSleep(bodies, dt) {
    let awake = 0;
    const { sleepVelocity, sleepTime } = this.settings;
    for (const entity of bodies) {
      const rb = entity.get('Rigidbody3D');
      if (rb.type !== 'dynamic') continue;
      if (!rb.canSleep) {
        rb.sleeping = false;
        awake++;
        continue;
      }
      const speed = Math.hypot(rb.velocity.x, rb.velocity.y, rb.velocity.z);
      if (speed > sleepVelocity) {
        rb.sleepTimer = 0;
        rb.sleeping = false;
      } else {
        rb.sleepTimer += dt;
        if (rb.sleepTimer >= sleepTime) {
          rb.sleeping = true;
          rb.velocity.x = 0;
          rb.velocity.y = 0;
          rb.velocity.z = 0;
        }
      }
      if (!rb.sleeping) awake++;
    }
    this.stats.awake = awake;
  }

  /**
   * Diff this step's contacts against last step's and queue the events.
   *
   * These are the same event names the 2D solver uses, so a behavior's
   * `onCollisionEnter` hook works identically in 2D and 3D. The payload's
   * `normal` gains a `z`; nothing else changes.
   */
  emitContactEvents() {
    const events = this.world.events;

    for (const [key, contact] of this.currentContacts) {
      const isTrigger = contact.a.isTrigger || contact.b.isTrigger;
      const existed = this.previousContacts.has(key);
      const payload = {
        a: contact.a.entity,
        b: contact.b.entity,
        normal: { x: contact.manifold.nx, y: contact.manifold.ny, z: contact.manifold.nz },
        depth: contact.manifold.depth,
        contact: { x: contact.manifold.cx, y: contact.manifold.cy, z: contact.manifold.cz },
      };
      if (isTrigger) {
        events.queue(existed ? EngineEvents.TRIGGER_STAY : EngineEvents.TRIGGER_ENTER, payload);
      } else {
        events.queue(existed ? EngineEvents.COLLISION_STAY : EngineEvents.COLLISION_ENTER, payload);
      }
    }

    for (const [key, contact] of this.previousContacts) {
      if (this.currentContacts.has(key)) continue;
      // Skip exits for destroyed entities: "it stopped touching me because it
      // ceased to exist" is not information a game wants.
      if (!contact.a.entity.alive || !contact.b.entity.alive) continue;
      const isTrigger = contact.a.isTrigger || contact.b.isTrigger;
      events.queue(isTrigger ? EngineEvents.TRIGGER_EXIT : EngineEvents.COLLISION_EXIT, {
        a: contact.a.entity,
        b: contact.b.entity,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Cast a ray and return the nearest hit.
   * @param {{x,y,z}} origin
   * @param {{x,y,z}} direction need not be normalized
   * @returns {{entity, point, normal, distance}|null}
   */
  raycast(origin, direction, options = {}) {
    return this.raycastAll(origin, direction, options)[0] ?? null;
  }

  /** Every hit along a ray, nearest first. */
  raycastAll(origin, direction, options = {}) {
    const maxDistance = options.maxDistance ?? Infinity;
    const mask = options.mask ?? -1;
    const ignore = options.ignore ? new Set(options.ignore) : null;
    const includeTriggers = options.includeTriggers ?? false;

    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len === 0) return [];
    const dir = { x: direction.x / len, y: direction.y / len, z: direction.z / len };

    const searchDistance = Number.isFinite(maxDistance) ? maxDistance : 1e6;
    const candidates = this.hash.queryRay(origin, dir, searchDistance, mask);

    const hits = [];
    for (const proxy of candidates) {
      const record = proxy.data;
      if (ignore?.has(record.entityId)) continue;
      if (record.isTrigger && !includeTriggers) continue;
      const hit = raycastShape(record.shape, origin, dir, maxDistance);
      if (!hit) continue;
      hits.push({
        entity: record.entity,
        collider: record.collider,
        point: { x: hit.x, y: hit.y, z: hit.z },
        normal: { x: hit.nx, y: hit.ny, z: hit.nz },
        distance: hit.t,
      });
    }
    hits.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id);
    return hits;
  }

  /** Every collider overlapping an axis-aligned box, in stable order. */
  overlapBox(center, size, options = {}) {
    return this.overlapShape(
      box3(center.x, center.y, center.z, size.x / 2, size.y / 2, size.z / 2),
      options,
    );
  }

  overlapSphere(center, radius, options = {}) {
    return this.overlapShape(sphere3(center.x, center.y, center.z, radius), options);
  }

  overlapShape(shape, options = {}) {
    const mask = options.mask ?? -1;
    const ignore = options.ignore ? new Set(options.ignore) : null;
    const includeTriggers = options.includeTriggers ?? true;
    const aabb = aabbOf(shape);
    const candidates = this.hash.queryAABB(
      aabb.minX, aabb.minY, aabb.minZ, aabb.maxX, aabb.maxY, aabb.maxZ, mask,
    );

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
  queryPoint(x, y, z, options = {}) {
    const mask = options.mask ?? -1;
    const includeTriggers = options.includeTriggers ?? true;
    const out = [];
    for (const proxy of this.hash.queryPoint(x, y, z, mask)) {
      const record = proxy.data;
      if (record.isTrigger && !includeTriggers) continue;
      if (containsPoint(record.shape, x, y, z)) out.push(record.entity);
    }
    return out;
  }

  reset() {
    this.previousContacts.clear();
    this.currentContacts.clear();
    this.hash.clear();
    this.colliders.length = 0;
  }
}

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

function applyImpulse(body, dx, dy, dz) {
  if (!body.freezeX) body.velocity.x += dx;
  if (!body.freezeY) body.velocity.y += dy;
  if (!body.freezeZ) body.velocity.z += dz;
}

function contactKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
