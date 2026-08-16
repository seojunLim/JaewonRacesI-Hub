/**
 * 세계의 법칙 — 무게 · 위상 · 관성
 *
 * 기획서 5~9장의 능력 체계를 데이터(LawTarget)와 한 곳의 규칙(castLaw / LawWorld)으로
 * 나눠 구현한다. 능력이 늘어나도 건드릴 곳은 SERIES 표 하나가 되도록 했다.
 *
 * 단위는 미터·킬로그램·초. "충격량"은 질량 × 접근속도(kg·m/s)이고,
 * 파괴 임계값과 피해량이 전부 이 값 하나로 결정된다.
 */

import { defineComponent, defineBehavior, getPhysics3D } from '../engine/src/index.js';

/* ── 상수 ────────────────────────────────────────────────────────── */

export const HEAVY_MASS = 8;      // 무게 증가 배율
export const HEAVY_GRAVITY = 2.2; // 무거워진 물체는 더 빠르게 떨어진다
export const LIGHT_MASS = 0.25;   // 무게 감소 배율
export const LIGHT_LIFT = 2.2;    // 가벼워진 물체가 떠오르는 속도 (m/s)
export const LIFT_DELAY = 0.7;    // 떠오르기 직전의 정적 — 올라탈 틈을 준다
export const WEIGHT_DURATION = 14;
export const PHASE_DURATION = 3.5;
export const PHASE_LOCK_DURATION = 7;
export const PHASE_DRAG = 1.1;    // 위상화된 물체가 미끄러지다 멈추는 정도
export const AMPLIFY = 2.2;       // 관성 증폭 배율
export const AMPLIFY_MIN = 4;     // 최소 가속량 (m/s)
export const REDIRECT_SPEED = 13; // 방향 변경이 부여하는 최소 속도

/* ── 컴포넌트 ────────────────────────────────────────────────────── */

export const LawTarget = defineComponent({
  name: 'LawTarget',
  category: 'Aether',
  requires: ['Transform3D'],
  description:
    '이 물체가 세계의 법칙 조작 대상임을 나타낸다. 장치가 조준할 수 있고, ' +
    '무게·위상·관성 상태와 마지막 충격량을 여기에 들고 있는다.',
  schema: {
    label: { type: 'string', default: '물체', description: 'HUD에 표시할 이름' },
    kind: {
      type: 'enum',
      values: ['rock', 'boulder', 'crate', 'debris', 'projectile', 'enemy', 'shield', 'structure', 'player'],
      default: 'rock',
      description: '연출과 피해 판정에 쓰이는 분류',
    },
    grabbable: { type: 'boolean', default: true, description: '조준 대상이 될 수 있는가' },

    weight: { type: 'int', default: 0, runtime: true, description: '-1 가벼움 / 0 / +1 무거움' },
    weightTimer: { type: 'number', default: 0, runtime: true },
    phaseTimer: { type: 'number', default: 0, runtime: true },
    phased: { type: 'boolean', default: false, runtime: true },
    liftDelay: { type: 'number', default: 0, runtime: true },
    baseMass: { type: 'number', default: 0, runtime: true, description: '능력 적용 전 원래 질량' },
    baseGravity: { type: 'number', default: 1, runtime: true },
    baseType: { type: 'string', default: '', runtime: true, description: '능력 적용 전 바디 타입' },
    impact: { type: 'number', default: 0, runtime: true, description: '가장 최근 충돌의 충격량' },
    prevVelocity: { type: 'vec3', default: [0, 0, 0], runtime: true, description: '물리 이전 속도' },
    flash: { type: 'number', default: 0, runtime: true, description: '능력 적중 연출 타이머' },
  },
});

/* ── 도우미 ──────────────────────────────────────────────────────── */

const speedOf = (v) => Math.hypot(v.x, v.y, v.z);

function bodyOf(entity) {
  return entity.get('Rigidbody3D');
}

function colliderOf(entity) {
  return entity.get('BoxCollider3D') ?? entity.get('SphereCollider');
}

/**
 * 잠든 바디를 깨운다.
 * 솔버는 멈춘 물체를 재우는데, 법칙은 "멈춰 있는 것"에도 걸린다.
 * 깨우지 않으면 가벼워진 상자가 그 자리에 그대로 앉아 있게 된다.
 */
function wake(body) {
  if (!body) return;
  body.sleeping = false;
  body.sleepTimer = 0;
}

/** 원래 질량/중력을 처음 한 번 기억해 둔다. */
function remember(entity, law) {
  if (law.baseMass > 0) return;
  const body = bodyOf(entity);
  law.baseMass = body ? body.mass : 1;
  law.baseGravity = body ? body.gravityScale : 1;
  law.baseType = body ? body.type : 'dynamic';
}

/**
 * 무게 상태를 적용한다. w = 1 무겁게 / -1 가볍게 / 0 원래대로.
 *
 * 가벼워진 물체는 단순히 질량만 줄지 않는다. 일정 속도로 "떠오른다" —
 * 위에 무엇이 올라타 있든. 이건 물리가 아니라 조작된 법칙이고,
 * 발판으로 쓸 수 있다는 사실이 이 능력의 재미 대부분을 만든다.
 */
export function applyWeight(entity, w) {
  const law = entity.get('LawTarget');
  const body = bodyOf(entity);
  if (!law || !body) return false;
  remember(entity, law);

  law.weight = w;
  law.weightTimer = w === 0 ? 0 : WEIGHT_DURATION;
  law.flash = 1;
  wake(body);

  if (w > 0) {
    body.mass = law.baseMass * HEAVY_MASS;
    body.gravityScale = HEAVY_GRAVITY;
    law.liftDelay = 0;
  } else if (w < 0) {
    body.mass = law.baseMass * LIGHT_MASS;
    body.gravityScale = 0.2;
    law.liftDelay = LIFT_DELAY;
  } else {
    body.mass = law.baseMass;
    body.gravityScale = law.baseGravity;
    body.type = law.baseType || body.type;
    law.liftDelay = 0;
  }
  entity.world.events.emit('law:weight', { entity, weight: w });
  return true;
}

/**
 * 위상화 — 대상을 현재 공간에서 분리한다.
 * 충돌체를 끄고 중력을 지우므로, 남은 것은 이미 가지고 있던 운동뿐이다.
 * 그래서 "밀어 넣으려면 먼저 움직임을 줘야 한다"가 규칙이 된다.
 */
export function applyPhase(entity, duration = PHASE_DURATION) {
  const law = entity.get('LawTarget');
  if (!law) return false;
  remember(entity, law);
  law.phaseTimer = Math.max(law.phaseTimer, duration);
  law.flash = 1;
  wake(bodyOf(entity));
  entity.world.events.emit('law:phase', { entity, duration });
  return true;
}

/** 관성 증폭 — 이미 일어난 움직임만 키울 수 있다. */
export function amplify(entity) {
  const body = bodyOf(entity);
  if (!body) return { ok: false, reason: '운동 없음' };
  const v = body.velocity;
  const sp = speedOf(v);
  if (sp < 1.2) return { ok: false, reason: '움직이지 않는 대상' };

  const target = Math.max(sp * AMPLIFY, sp + AMPLIFY_MIN);
  const k = target / sp;
  v.x *= k; v.y *= k; v.z *= k;
  wake(body);

  const law = entity.get('LawTarget');
  if (law) law.flash = 1;
  entity.world.events.emit('law:amplify', { entity, from: sp, to: target });
  return { ok: true, speed: target };
}

/** 방향 변경 — 멈춘 물체도 밀어낸다. 위상화된 물체를 벽 너머로 보내는 수단. */
export function redirect(entity, dir) {
  const body = bodyOf(entity);
  if (!body) return { ok: false, reason: '대상 없음' };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-6) return { ok: false, reason: '방향 없음' };

  const sp = Math.max(speedOf(body.velocity), REDIRECT_SPEED);
  body.velocity.x = (dir.x / len) * sp;
  body.velocity.y = (dir.y / len) * sp;
  body.velocity.z = (dir.z / len) * sp;
  wake(body);

  const law = entity.get('LawTarget');
  if (law) law.flash = 1;
  entity.world.events.emit('law:redirect', { entity, speed: sp });
  return { ok: true, speed: sp };
}

/* ── 능력 표 ─────────────────────────────────────────────────────── */

/**
 * 계열 → 행동 4개. HUD와 입력 처리와 계측이 전부 이 표 하나를 읽는다.
 * slot 0=좌클릭 1=우클릭 2=E 3=Shift.
 */
export const SERIES = {
  weight: {
    key: 'Q', name: '무게', color: '#ff8a3d',
    acts: ['무게 증가', '무게 감소', '무게 이동', '자기 무게'],
  },
  phase: {
    key: 'E', name: '위상', color: '#b06bff',
    acts: ['위상화', '위상 고정', '위상 교환', '—'],
  },
  inertia: {
    key: 'R', name: '관성', color: '#4be3ff',
    acts: ['관성 증폭', '방향 변경', '관성 저장/방출', '자기 관성'],
  },
};

/**
 * 능력 발동. 브라우저의 입력 처리와 헤드리스 테스트가 같은 문을 쓴다.
 *
 * @param {World} world
 * @param {{series: string, slot: number, target?: Entity, aim?: {x,y,z}, caster?: Entity}} req
 * @returns {{ok: boolean, reason?: string}}
 */
export function castLaw(world, req) {
  const { series, slot, target, aim, caster } = req;
  const memo = lawMemo(world);
  const done = (extra = {}) => {
    world.events.emit('law:cast', { series, slot, target, ...extra });
    return { ok: true, ...extra };
  };
  const fail = (reason) => ({ ok: false, reason });

  if (series === 'weight') {
    if (slot === 3) {
      if (!caster) return fail('대상 없음');
      const self = caster.get('LawTarget');
      if (!self) return fail('대상 없음');
      applyWeight(caster, self.weight > 0 ? 0 : 1);
      return done({ self: true });
    }
    if (!target) return fail('대상 없음');
    if (slot === 0) { applyWeight(target, 1); return done(); }
    if (slot === 1) { applyWeight(target, -1); return done(); }
    if (slot === 2) {
      // 무게 이동 : 첫 번째 E 로 출처를 찍고, 두 번째 E 로 옮긴다.
      if (!memo.transfer) {
        memo.transfer = target;
        world.events.emit('law:marked', { entity: target, kind: 'weight' });
        return done({ marked: true });
      }
      const src = memo.transfer;
      memo.transfer = null;
      if (src === target || !src.alive) return fail('같은 대상');
      const w = src.get('LawTarget')?.weight ?? 0;
      applyWeight(target, w);
      applyWeight(src, 0);
      return done({ moved: true });
    }
    return fail('없는 능력');
  }

  if (series === 'phase') {
    if (slot === 3) return fail('자기 위상화는 제한되어 있다');
    if (!target) return fail('대상 없음');
    if (slot === 0) { applyPhase(target, PHASE_DURATION); return done(); }
    if (slot === 1) { applyPhase(target, PHASE_LOCK_DURATION); return done({ locked: true }); }
    if (slot === 2) {
      if (!memo.transfer) {
        memo.transfer = target;
        world.events.emit('law:marked', { entity: target, kind: 'phase' });
        return done({ marked: true });
      }
      const src = memo.transfer;
      memo.transfer = null;
      if (src === target || !src.alive) return fail('같은 대상');
      const a = src.get('LawTarget');
      const b = target.get('LawTarget');
      const swap = a.phaseTimer;
      a.phaseTimer = b.phaseTimer;
      b.phaseTimer = swap;
      a.flash = 1; b.flash = 1;
      return done({ swapped: true });
    }
    return fail('없는 능력');
  }

  if (series === 'inertia') {
    if (slot === 3) {
      if (!caster) return fail('대상 없음');
      memo.selfInertia = 2.4;
      return done({ self: true });
    }
    if (!target) return fail('대상 없음');
    if (slot === 0) {
      const r = amplify(target);
      return r.ok ? done({ speed: r.speed }) : fail(r.reason);
    }
    if (slot === 1) {
      if (!aim) return fail('조준 없음');
      const t = target.get('WorldTransform3D') ?? target.get('Transform3D');
      const r = redirect(target, {
        x: aim.x - t.position.x,
        y: aim.y - t.position.y,
        z: aim.z - t.position.z,
      });
      return r.ok ? done({ speed: r.speed }) : fail(r.reason);
    }
    if (slot === 2) {
      const body = bodyOf(target);
      if (!body) return fail('대상 없음');
      if (!memo.stored) {
        const sp = speedOf(body.velocity);
        if (sp < 1.5) return fail('저장할 움직임 없음');
        memo.stored = { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z, speed: sp };
        body.velocity.x = 0; body.velocity.y = 0; body.velocity.z = 0;
        world.events.emit('law:stored', { entity: target, speed: sp });
        return done({ stored: sp });
      }
      const s = memo.stored;
      memo.stored = null;
      body.velocity.x += s.x;
      body.velocity.y += s.y;
      body.velocity.z += s.z;
      const law = target.get('LawTarget');
      if (law) law.flash = 1;
      world.events.emit('law:released', { entity: target, speed: s.speed });
      return done({ released: s.speed });
    }
    return fail('없는 능력');
  }
  return fail('없는 계열');
}

/** 세계 하나당 하나뿐인 장치 상태 (저장된 관성, 이동 대상 지정). */
export function lawMemo(world) {
  if (!world.__lawMemo) world.__lawMemo = { stored: null, transfer: null, selfInertia: 0 };
  return world.__lawMemo;
}

/* ── 법칙 진행 ───────────────────────────────────────────────────── */

/**
 * 모든 LawTarget의 상태를 매 고정 스텝 갱신한다.
 *
 * 물리(fixedUpdate)보다 먼저 도는 fixedPre 에서 돌기 때문에
 * 여기서 기록한 속도가 곧 "충돌 직전 속도"가 되고, 충격량 계산의 기준이 된다.
 */
export const LawWorld = defineBehavior({
  name: 'LawWorld',
  description:
    '세계의 법칙 상태를 진행시킨다. 씬마다 하나만 두면 된다 — ' +
    '무게/위상 지속시간, 부양, 위상 중 통과, 실체화 밀어내기를 모두 처리한다.',
  props: {},
  onFixedUpdate({ world, dt }) {
    const memo = lawMemo(world);
    if (memo.selfInertia > 0) memo.selfInertia -= dt;

    for (const [entity, law] of world.each('LawTarget')) {
      const body = entity.get('Rigidbody3D');
      if (!body) continue;
      if (law.baseMass <= 0) remember(entity, law);
      if (law.flash > 0) law.flash = Math.max(0, law.flash - dt * 2.5);
      // 법칙이 한 번이라도 걸린 몸은 다시 재우지 않는다.
      // 잠든 몸은 솔버가 통째로 건너뛰므로, 떠오르는 발판이 밀어 올려도 반응하지 않는다.
      // (다시 켜지 않는 이유: 플레이어처럼 스스로 수면을 끈 몸을 되살리면 안 되기 때문)
      if (law.weight !== 0 || law.phaseTimer > 0) body.canSleep = false;

      /* 무게 지속시간 */
      if (law.weightTimer > 0) {
        law.weightTimer -= dt;
        if (law.weightTimer <= 0) applyWeight(entity, 0);
      }

      /* 부양 : 위에 무엇이 올라타 있든 일정 속도로 떠오른다.
         떠오르는 동안 바디를 키네마틱으로 바꾼다 — 솔버가 밀어낼 수 없게 되고,
         그래서 사람을 태운 채로도 올라간다. 이건 물리가 아니라 조작된 법칙이다. */
      if (law.weight < 0) {
        if (law.liftDelay > 0) {
          law.liftDelay -= dt;
        } else {
          if (body.type === 'dynamic') body.type = 'kinematic';
          // 키네마틱 바디는 수면 갱신에서 제외되므로, 잠든 채로 굳지 않게 직접 깨운다
          wake(body);
          body.velocity.y = ceilingBlocked(entity, body) ? 0 : LIGHT_LIFT;
        }
      }

      /* 위상 : 충돌체를 끄고 중력을 지운다 */
      const collider = colliderOf(entity);
      if (law.phaseTimer > 0) {
        law.phaseTimer -= dt;
        if (!law.phased) {
          law.phased = true;
          if (collider) collider.enabled = false;
          body.gravityScale = 0;
        }
        body.velocity.x -= body.velocity.x * PHASE_DRAG * dt;
        body.velocity.y -= body.velocity.y * PHASE_DRAG * dt;
        body.velocity.z -= body.velocity.z * PHASE_DRAG * dt;
        if (law.phaseTimer <= 0) materialize(entity, law, collider, body);
      }

      /* 충돌 직전 속도 기록 — 충격량은 여기서 나온다 */
      law.prevVelocity.x = body.velocity.x;
      law.prevVelocity.y = body.velocity.y;
      law.prevVelocity.z = body.velocity.z;
    }
  },
});

/** 떠오르는 물체가 천장에 닿았는가. 닿았으면 거기서 멈춘다. */
function ceilingBlocked(entity, body) {
  const physics = getPhysics3D(entity.world);
  if (!physics) return false;
  const t = entity.get('Transform3D');
  const half = entity.get('SphereCollider')?.radius
    ?? (entity.get('BoxCollider3D')?.size?.y ?? 1) / 2;
  const hits = physics.raycastAll(
    { x: t.position.x, y: t.position.y + half * 0.9, z: t.position.z },
    { x: 0, y: 1, z: 0 },
    { maxDistance: half * 0.6 + LIGHT_LIFT * 0.06, ignore: [entity.id] },
  );
  // 위에 올라탄 사람이나 물건은 천장이 아니다 — 지형만 상승을 막는다
  return hits.some((hit) => (hit.entity.get('Rigidbody3D')?.type ?? 'static') !== 'dynamic');
}

/** 위상이 풀릴 때. 벽 속이라면 가장 가까운 빈 곳으로 밀어낸다. */
function materialize(entity, law, collider, body) {
  law.phased = false;
  law.phaseTimer = 0;
  if (collider) collider.enabled = true;
  if (law.weight >= 0 && law.baseType) body.type = law.baseType;
  body.gravityScale = law.weight > 0 ? HEAVY_GRAVITY : law.weight < 0 ? 0.2 : law.baseGravity;

  const t = entity.get('Transform3D');
  const physics = getPhysics3D(entity.world);
  if (!physics) return;
  const radius = entity.get('SphereCollider')?.radius
    ?? (entity.get('BoxCollider3D')?.size?.y ?? 1) / 2;

  const blocked = () =>
    physics.overlapSphere(t.position, radius * 0.9, { ignore: [entity.id] }).length > 0;
  if (!blocked()) return;

  const dirs = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ];
  const origin = { x: t.position.x, y: t.position.y, z: t.position.z };
  for (let step = radius; step < radius * 12; step += radius * 0.5) {
    for (const d of dirs) {
      t.position.x = origin.x + d[0] * step;
      t.position.y = origin.y + d[1] * step;
      t.position.z = origin.z + d[2] * step;
      if (!blocked()) return;
    }
  }
  t.position.x = origin.x; t.position.y = origin.y; t.position.z = origin.z;
}

/**
 * 충돌 충격량 = 질량 × 접근 속도.
 * 파괴도 피해도 전부 이 값 하나로 판정하므로, 플레이어는 숫자 하나만 이해하면 된다.
 */
export function impactOf(entity, other, normal) {
  const law = entity.get('LawTarget');
  const body = entity.get('Rigidbody3D');
  if (!body) return 0;
  const v = law ? law.prevVelocity : body.velocity;

  const otherLaw = other?.get('LawTarget');
  const ov = otherLaw ? otherLaw.prevVelocity : (other?.get('Rigidbody3D')?.velocity ?? { x: 0, y: 0, z: 0 });
  const rel = { x: v.x - ov.x, y: v.y - ov.y, z: v.z - ov.z };

  // 엔진의 비헤이비어 충돌 디스패처는 b 쪽 엔티티에 노멀을 2D 로 뒤집어 넘긴다
  // (engine/src/systems/behavior.js 의 deliver(): z 가 사라진다).
  // z 가 없는 노멀로 내적하면 NaN 이 되므로, 그럴 땐 접근 속도의 크기를 쓴다.
  const usable = normal
    && Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z);
  const approach = usable
    ? Math.abs(rel.x * normal.x + rel.y * normal.y + rel.z * normal.z)
    : Math.hypot(rel.x, rel.y, rel.z);
  return body.mass * approach;
}
