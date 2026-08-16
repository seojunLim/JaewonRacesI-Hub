/**
 * 반응하는 것들.
 *
 * 기획서 12·13장의 방향 — "어떻게 죽이지?" 보다 "얘는 무엇에 반응하지?".
 * 그래서 모든 적은 기본 공격으로도 죽지만 아주 느리고, 환경과 법칙에는 크게 무너진다.
 */

import { defineBehavior, getPhysics3D, instantiate } from '../engine/src/index.js';
import { impactOf } from './law.js';
import { hudState, say } from './player.js';

const IMPACT_TO_DAMAGE = 0.09;   // 충격량 → 피해 (물체 충돌이 근접 공격보다 훨씬 세다)
const MIN_IMPACT = 40;

/**
 * 적마다 "무엇에 얼마나 반응하는지"를 여기에 등록한다.
 * 피해 경로를 하나로 모아 두면 방패나 법칙 방어 같은 규칙이 한 곳에만 산다.
 */
const registry = new WeakMap();

function register(entity, entry) { registry.set(entity, entry); }

/** 씬 어디서든 'enemy:damage' 이벤트 하나로 피해를 넣는다. */
function ensureDispatcher(world) {
  if (world.__enemyDamageBound) return;
  world.__enemyDamageBound = true;
  world.events.on('enemy:damage', (payload) => {
    damage(world, payload.entity, payload.amount, payload.source);
  });
}

function damage(world, entity, amount, source) {
  if (!entity?.alive) return;
  const health = entity.get('Health');
  if (!health || health.current <= 0) return;

  // 등록된 규칙이 피해를 깎거나 지운다 (방패 · 법칙 방어 · 핵 노출)
  const entry = registry.get(entity);
  let dealt = entry?.modify ? entry.modify(amount, source) : amount;
  if (dealt <= 0) return;

  health.current = Math.max(0, health.current - dealt);
  world.events.emit('fx:enemyHit', { entity, amount: dealt, source });
  if (health.current <= 0) {
    world.events.emit('enemy:died', { entity, source });
    world.events.emit('fx:enemyDied', { entity, position: { ...entity.require('Transform3D').position } });
    world.destroy(entity.id);
  }
}

/* ── 돌진체 ─────────────────────────────────────────────────────── */

export const Charger = defineBehavior({
  name: 'Charger',
  description:
    '플레이어를 향해 돌진한다. 벽에 부딪히면 스스로 무너지고, 돌진 중에 관성을 증폭하면 ' +
    '그 힘이 그대로 자기 피해로 돌아온다 — 적의 움직임도 "이미 일어난 움직임"이다.',
  requires: ['Transform3D', 'Rigidbody3D', 'Health', 'LawTarget'],
  props: {
    sightRange: { type: 'number', default: 18 },
    telegraph: { type: 'number', default: 0.6, description: '돌진 전 예비 동작 (초)' },
    chargeSpeed: { type: 'number', default: 15 },
    chargeTime: { type: 'number', default: 1.5 },
    touchDamage: { type: 'number', default: 14 },
    wallDamage: { type: 'number', default: 0.9, description: '충돌 속도 1당 자기 피해' },
  },
  onStart({ state, world, entity }) {
    state.mode = 'idle';
    state.timer = 0;
    state.dir = { x: 0, z: -1 };
    state.hitCd = 0;
    ensureDispatcher(world);
    register(entity, { state });
  },
  onFixedUpdate({ entity, props, state, world, dt }) {
    const body = entity.require('Rigidbody3D');
    const t = entity.require('Transform3D');
    const law = entity.get('LawTarget');
    if (law?.phased) return;

    const player = world.findFirstByTag('player');
    if (!player?.alive) return;
    const p = player.get('Transform3D').position;
    const dx = p.x - t.position.x;
    const dz = p.z - t.position.z;
    const dist = Math.hypot(dx, dz);
    if (state.hitCd > 0) state.hitCd -= dt;
    state.timer -= dt;

    if (state.mode === 'idle') {
      body.velocity.x *= 0.86;
      body.velocity.z *= 0.86;
      if (dist < props.sightRange && Math.abs(p.y - t.position.y) < 4) {
        state.mode = 'tell';
        state.timer = props.telegraph;
        state.dir = { x: dx / (dist || 1), z: dz / (dist || 1) };
        world.events.emit('fx:telegraph', { entity });
      }
    } else if (state.mode === 'tell') {
      body.velocity.x *= 0.7;
      body.velocity.z *= 0.7;
      state.dir = { x: dx / (dist || 1), z: dz / (dist || 1) };
      if (state.timer <= 0) {
        state.mode = 'charge';
        state.timer = props.chargeTime;
        body.velocity.x = state.dir.x * props.chargeSpeed;
        body.velocity.z = state.dir.z * props.chargeSpeed;
        world.events.emit('fx:charge', { entity });
      }
    } else if (state.mode === 'charge') {
      if (body.grounded) {
        body.velocity.x += (state.dir.x * props.chargeSpeed - body.velocity.x) * Math.min(1, dt * 3);
        body.velocity.z += (state.dir.z * props.chargeSpeed - body.velocity.z) * Math.min(1, dt * 3);
      }
      if (state.timer <= 0) { state.mode = 'idle'; state.timer = 0.8; }
    } else if (state.mode === 'stun') {
      body.velocity.x *= 0.8;
      body.velocity.z *= 0.8;
      if (state.timer <= 0) state.mode = 'idle';
    }

    // 접촉 피해
    if (dist < 1.6 && Math.abs(p.y - t.position.y) < 2 && state.hitCd <= 0) {
      state.hitCd = 0.9;
      world.events.emit('player:damage', {
        amount: state.mode === 'charge' ? props.touchDamage : props.touchDamage * 0.6,
        from: { ...t.position },
      });
    }

    entity.__chargerMode = state.mode;
  },
  onCollisionEnter({ entity, world, other, normal, state, props }) {
    const law = entity.get('LawTarget');
    if (!law) return;

    // 지형에 처박히면 스스로 무너진다
    const otherBody = other.get('Rigidbody3D');
    const isStatic = !otherBody || otherBody.type === 'static';
    if (isStatic) {
      const speed = Math.hypot(law.prevVelocity.x, law.prevVelocity.z);
      if (state.mode === 'charge' && speed > 7) {
        state.mode = 'stun';
        state.timer = 1.6;
        damage(world, entity, speed * props.wallDamage, 'wall');
        say(world, '벽에 처박혔다', 1.4);
        world.events.emit('fx:slam', { position: { ...entity.require('Transform3D').position }, power: speed });
      }
      return;
    }

    // 날아온 물체에 맞으면 충격량만큼
    const otherLaw = other.get('LawTarget');
    if (!otherLaw || otherLaw.kind === 'enemy') return;
    const impact = impactOf(other, entity, normal);
    if (impact < MIN_IMPACT) return;
    state.mode = 'stun';
    state.timer = 1.2;
    damage(world, entity, impact * IMPACT_TO_DAMAGE, 'impact');
    hudState(world).lastImpact = Math.round(impact);
  },
});

/* ── 방패병 ─────────────────────────────────────────────────────── */

export const Shielded = defineBehavior({
  name: 'Shielded',
  description:
    '정면에 방패를 든 적. 방패는 부수는 것이 아니라 존재를 지우는 것 — ' +
    '방패를 위상화하면 공격이 그대로 지나간다.',
  requires: ['Transform3D', 'Rigidbody3D', 'Health', 'LawTarget'],
  props: {
    speed: { type: 'number', default: 2.6 },
    sightRange: { type: 'number', default: 22 },
    shield: { type: 'entity', default: '', description: '방패 엔티티' },
    shieldDistance: { type: 'number', default: 1.1 },
    touchDamage: { type: 'number', default: 10 },
  },
  onStart({ state, world, entity }) {
    state.hitCd = 0;
    state.facing = { x: 0, z: -1 };
    ensureDispatcher(world);
    register(entity, {
      state,
      // 방패가 실체를 가지고 있는 한 정면의 근접 공격은 통하지 않는다
      modify(amount, source) {
        if (source !== 'melee') return amount;
        const shield = state.shieldEntity;
        const law = shield?.get('LawTarget');
        if (!shield?.alive || !law || law.phased) return amount;
        world.events.emit('fx:blocked', { entity: shield });
        return 0;
      },
    });
  },
  onFixedUpdate({ entity, props, state, world, dt }) {
    if (!state.shieldEntity && props.shield) state.shieldEntity = world.findById(props.shield);
    const body = entity.require('Rigidbody3D');
    const t = entity.require('Transform3D');
    if (state.hitCd > 0) state.hitCd -= dt;

    const player = world.findFirstByTag('player');
    if (!player?.alive) return;
    const p = player.get('Transform3D').position;
    const dx = p.x - t.position.x;
    const dz = p.z - t.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    state.facing = { x: dx / dist, z: dz / dist };

    if (dist < props.sightRange && dist > 1.8) {
      body.velocity.x += (state.facing.x * props.speed - body.velocity.x) * Math.min(1, dt * 4);
      body.velocity.z += (state.facing.z * props.speed - body.velocity.z) * Math.min(1, dt * 4);
    } else {
      body.velocity.x *= 0.9;
      body.velocity.z *= 0.9;
    }
    t.rotation.y = Math.atan2(state.facing.x, state.facing.z) * (180 / Math.PI);

    // 방패를 정면에 붙여 둔다
    const shield = state.shieldEntity;
    if (shield?.alive) {
      const st = shield.get('Transform3D');
      const law = shield.get('LawTarget');
      if (st && !law?.phased) {
        st.position.x = t.position.x + state.facing.x * props.shieldDistance;
        st.position.y = t.position.y;
        st.position.z = t.position.z + state.facing.z * props.shieldDistance;
        st.rotation.y = t.rotation.y;
      }
    }

    if (dist < 1.9 && state.hitCd <= 0) {
      state.hitCd = 1.1;
      world.events.emit('player:damage', { amount: props.touchDamage, from: { ...t.position } });
    }
  },
  onCollisionEnter({ entity, world, other, normal, state }) {
    const otherLaw = other.get('LawTarget');
    if (!otherLaw || otherLaw.kind === 'enemy' || otherLaw.kind === 'shield') return;
    const impact = impactOf(other, entity, normal);
    if (impact < MIN_IMPACT) return;
    damage(world, entity, impact * IMPACT_TO_DAMAGE, 'impact');
    hudState(world).lastImpact = Math.round(impact);
  },
});

/* ── 보스 : 낙하를 잊은 자 ──────────────────────────────────────── */

export const ForgottenFall = defineBehavior({
  name: 'ForgottenFall',
  description:
    '첫 번째 보스. 떠 있는 파편이 법칙 방어를 이룬다. 파편을 무겁게 만들어 궤도에서 ' +
    '떨어뜨리면 핵이 드러나고, 그때 무거운 물체를 증폭해 맞히는 것이 정답 중 하나다. ' +
    '단순 공격도 통하지만 눈에 띄게 느리다.',
  requires: ['Transform3D', 'Rigidbody3D', 'Health', 'LawTarget'],
  props: {
    debrisPrefab: { type: 'string', default: 'Debris' },
    debrisCount: { type: 'int', default: 3 },
    orbitRadius: { type: 'number', default: 4.2 },
    orbitSpeed: { type: 'number', default: 70, description: '도/초' },
    chargeSpeed: { type: 'number', default: 13 },
    slamRadius: { type: 'number', default: 9 },
    exposeTime: { type: 'number', default: 9 },
    meleeResist: { type: 'number', default: 0.2, description: '방어 중 근접 공격이 통하는 비율' },
  },

  onStart({ entity, state, props, world }) {
    state.debris = [];
    state.mode = 'idle';
    state.timer = 1.4;
    state.vuln = 0;
    state.phaseIndex = 0;
    state.hitCd = 0;
    summon(entity, state, props, world);

    ensureDispatcher(world);
    register(entity, {
      state,
      modify(amount, source) {
        const armored = state.debris.filter((d) => d.alive && d.__orbiting).length > 0;
        let out = amount;
        // 단순 공격으로도 죽지만, 법칙 방어가 남아 있으면 거의 통하지 않는다
        if (source === 'melee') {
          out *= armored ? props.meleeResist : 0.6;
          if (armored) world.events.emit('fx:blocked', { entity });
        }
        if (state.vuln > 0) out *= 2;
        return out;
      },
    });
  },

  onFixedUpdate({ entity, props, state, world, dt }) {
    const t = entity.require('Transform3D');
    const body = entity.require('Rigidbody3D');
    const hud = hudState(world);
    const health = entity.require('Health');
    if (state.hitCd > 0) state.hitCd -= dt;
    if (state.vuln > 0) state.vuln -= dt;

    /* 궤도 파편 : 능력이 닿으면 궤도를 잃는다 */
    let orbiting = 0;
    for (const d of state.debris) {
      if (!d.alive || !d.__orbiting) continue;
      const law = d.get('LawTarget');
      const db = d.get('Rigidbody3D');
      if (law.weight !== 0 || law.phased || law.__struck) {
        d.__orbiting = false;
        db.gravityScale = law.weight > 0 ? 2.2 : 1;
        world.events.emit('boss:debrisFell', { entity: d });
        say(world, '파편이 궤도를 잃었다', 1.6);
        continue;
      }
      orbiting++;
      d.__angle += props.orbitSpeed * (Math.PI / 180) * dt;
      const dt2 = d.get('Transform3D');
      const nx = t.position.x + Math.cos(d.__angle) * props.orbitRadius;
      const ny = t.position.y + 0.6 + Math.sin(d.__angle * 1.7) * 0.9;
      const nz = t.position.z + Math.sin(d.__angle) * props.orbitRadius;
      // 키네마틱처럼 다루되 속도를 채워 둔다 — 부딪힌 것을 밀어내야 하므로
      db.velocity.x = (nx - dt2.position.x) / dt;
      db.velocity.y = (ny - dt2.position.y) / dt;
      db.velocity.z = (nz - dt2.position.z) / dt;
      dt2.position.x = nx; dt2.position.y = ny; dt2.position.z = nz;
    }

    if (orbiting === 0 && state.vuln <= 0 && state.mode !== 'expose') {
      state.mode = 'expose';
      state.vuln = props.exposeTime;
      state.timer = 1.2;
      say(world, '핵이 드러났다 — 지금이다', 2.4);
      world.events.emit('fx:expose', { entity });
    }

    hud.bossHp = health.current / health.max;
    hud.bossArmor = orbiting;
    hud.bossVuln = state.vuln > 0;

    /* 페이즈 : 체력이 3분의 1씩 줄 때마다 법칙을 다시 끌어모은다 */
    const step = health.max / 3;
    if (health.current <= health.max - step * (state.phaseIndex + 1) && health.current > 0) {
      state.phaseIndex++;
      state.vuln = 0;
      summon(entity, state, props, world);
      say(world, `보스가 법칙을 다시 끌어모은다 — 페이즈 ${state.phaseIndex + 1}`, 2.6);
    }

    /* 행동 */
    const player = world.findFirstByTag('player');
    if (!player?.alive) return;
    const p = player.get('Transform3D').position;
    const dx = p.x - t.position.x;
    const dz = p.z - t.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    state.timer -= dt;

    if (state.mode === 'idle' || state.mode === 'expose') {
      body.velocity.x *= 0.9;
      body.velocity.z *= 0.9;
      if (state.timer <= 0) {
        state.next = world.random.pick(['charge', 'slam', 'throw']);
        state.mode = 'tell';
        state.timer = 0.7;
        world.events.emit('fx:telegraph', { entity });
      }
    } else if (state.mode === 'tell') {
      body.velocity.x *= 0.8;
      body.velocity.z *= 0.8;
      state.dir = { x: dx / dist, z: dz / dist };
      if (state.timer <= 0) {
        state.mode = state.next;
        state.timer = state.next === 'charge' ? 1.5 : 1;
        if (state.next === 'charge') {
          body.velocity.x = state.dir.x * props.chargeSpeed;
          body.velocity.z = state.dir.z * props.chargeSpeed;
          world.events.emit('fx:charge', { entity });
        } else if (state.next === 'slam') {
          body.velocity.y = 9;
        } else {
          throwRock(entity, state, world, p);
        }
      }
    } else if (state.mode === 'charge') {
      if (state.timer <= 0) { state.mode = state.vuln > 0 ? 'expose' : 'idle'; state.timer = 1.3; }
    } else if (state.mode === 'slam') {
      if (body.grounded && state.timer < 0.75) {
        state.mode = state.vuln > 0 ? 'expose' : 'idle';
        state.timer = 1.3;
        world.events.emit('fx:slam', { position: { ...t.position }, power: 14 });
        const physics = getPhysics3D(world);
        if (physics) {
          for (const hit of physics.overlapSphere(t.position, props.slamRadius, { ignore: [entity.id] })) {
            const other = hit.entity ?? hit;
            const ob = other.get?.('Rigidbody3D');
            if (!ob || ob.type !== 'dynamic') continue;
            const ot = other.get('Transform3D').position;
            const ddx = ot.x - t.position.x, ddz = ot.z - t.position.z;
            const dd = Math.hypot(ddx, ddz) || 1;
            ob.velocity.y = Math.max(ob.velocity.y, 7);
            ob.velocity.x += (ddx / dd) * 6;
            ob.velocity.z += (ddz / dd) * 6;
          }
        }
        if (dist < props.slamRadius) {
          world.events.emit('player:damage', { amount: 13, from: { ...t.position } });
        }
      }
    } else if (state.mode === 'throw') {
      if (state.timer <= 0) { state.mode = state.vuln > 0 ? 'expose' : 'idle'; state.timer = 1.2; }
    }

    if (dist < 2.4 && state.mode === 'charge' && state.hitCd <= 0) {
      state.hitCd = 1;
      world.events.emit('player:damage', { amount: 18, from: { ...t.position } });
    }
  },

  onCollisionEnter({ entity, world, other, normal, state }) {
    const otherLaw = other.get('LawTarget');
    if (!otherLaw) return;
    const impact = impactOf(other, entity, normal);
    if (impact < MIN_IMPACT) return;
    hudState(world).lastImpact = Math.round(impact);
    world.events.emit('enemy:damage', {
      entity, amount: impact * IMPACT_TO_DAMAGE, source: 'impact', from: { ...other.get('Transform3D').position },
    });
    if (state.mode === 'charge') { state.mode = 'idle'; state.timer = 1.6; state.vuln = Math.max(state.vuln, 2.4); }
  },
});

function summon(entity, state, props, world) {
  for (const d of state.debris) if (d.alive) world.destroy(d.id);
  state.debris = [];
  const t = entity.require('Transform3D');
  for (let i = 0; i < props.debrisCount; i++) {
    const angle = (i / props.debrisCount) * Math.PI * 2;
    const d = instantiate(world, {
      prefab: props.debrisPrefab,
      tags: ['debris'],
      components: {
        Transform3D: {
          position: [
            t.position.x + Math.cos(angle) * props.orbitRadius,
            t.position.y + 0.6,
            t.position.z + Math.sin(angle) * props.orbitRadius,
          ],
        },
      },
    });
    d.__orbiting = true;
    d.__angle = angle;
    const body = d.get('Rigidbody3D');
    if (body) body.gravityScale = 0;
    state.debris.push(d);
  }
  world.events.emit('boss:summon', { entity, count: props.debrisCount });
}

function throwRock(entity, state, world, targetPos) {
  const t = entity.require('Transform3D');
  const dx = targetPos.x - t.position.x;
  const dz = targetPos.z - t.position.z;
  const d = Math.hypot(dx, dz) || 1;
  const rock = instantiate(world, {
    prefab: 'Rock',
    components: {
      Transform3D: { position: [t.position.x + (dx / d) * 2, t.position.y + 1.4, t.position.z + (dz / d) * 2] },
      Rigidbody3D: { velocity: [(dx / d) * 14, 5, (dz / d) * 14] },
    },
  });
  world.events.emit('boss:threw', { entity, rock });
}

/** 파편이 무언가에 세게 부딪히면 그것만으로도 궤도를 잃는다. */
export const OrbitDebris = defineBehavior({
  name: 'OrbitDebris',
  description: '보스의 부유 파편. 강한 충격을 받으면 궤도에서 떨어진다.',
  requires: ['LawTarget'],
  props: {},
  onCollisionEnter({ entity, other, normal }) {
    const law = entity.get('LawTarget');
    if (!law || !entity.__orbiting) return;
    const impact = impactOf(other, entity, normal);
    if (impact > 120) law.__struck = true;
  },
});
