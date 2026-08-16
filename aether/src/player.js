/**
 * 플레이어 — 이동 / 회피 / 공격, 그리고 손에 연결된 장치.
 *
 * 조작은 기획서 10장 그대로다.
 *   Z 를 누르면 세계가 느려지고, 계열 키(Q/E/R)를 고른 뒤, 조준하고 발동한다.
 * 능력을 "선택"하는 화면이 없다는 점이 이 게임 조작의 전부다.
 */

import {
  defineBehavior,
  activeCamera3D,
  computeView3D,
  screenToRay,
  getPhysics3D,
  getInput,
  forwardFlat,
  rightDir,
  RENDERER_RESOURCE,
} from '../engine/src/index.js';

import { SERIES, castLaw, lawMemo, applyWeight } from './law.js';

const TIME_SLOW = 0.25;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 씬 전체가 공유하는 HUD 상태. index.html 이 매 프레임 읽어간다. */
export function hudState(world) {
  if (!world.__hud) {
    world.__hud = {
      hp: 100, maxHp: 100,
      lawMode: false, series: 'weight', available: ['weight', 'phase', 'inertia'],
      target: null, targetInfo: null,
      stored: 0, marked: false, selfWeight: false, selfInertia: 0,
      lastImpact: 0, message: '', messageTimer: 0,
      uses: {}, chamber: '', objective: '', elapsed: 0, cleared: false, deaths: 0,
      bossHp: -1, bossArmor: 0, bossVuln: false, enemiesLeft: 0,
    };
  }
  return world.__hud;
}

export function say(world, message, seconds = 3.2) {
  const hud = hudState(world);
  hud.message = message;
  hud.messageTimer = seconds;
}

/* ── 플레이어 ────────────────────────────────────────────────────── */

export const AetherPlayer = defineBehavior({
  name: 'AetherPlayer',
  description:
    '3인칭 이동·점프·회피·기본 공격. 이동은 카메라 기준이고, 공격은 물체를 차낸다 — ' +
    '관성 능력이 쓸 "이미 일어난 움직임"을 플레이어가 스스로 만들 수 있어야 하기 때문이다.',
  requires: ['Transform3D', 'Rigidbody3D', 'LawTarget'],
  props: {
    speed: { type: 'number', default: 7.5, description: '최고 이동 속도 (m/s)' },
    acceleration: { type: 'number', default: 60 },
    airAcceleration: { type: 'number', default: 24 },
    jumpHeight: { type: 'number', default: 2.4, description: '최고 도달 높이 (m)' },
    dashSpeed: { type: 'number', default: 17 },
    dashTime: { type: 'number', default: 0.16 },
    dashCooldown: { type: 'number', default: 0.55 },
    attackRange: { type: 'number', default: 2.6 },
    attackImpulse: { type: 'number', default: 11, description: '물체를 차낼 때 주는 속도' },
    attackDamage: { type: 'number', default: 8 },
    maxHp: { type: 'number', default: 100 },
  },

  onStart({ entity, state, props, world }) {
    // 플레이어는 잠들지 않는다. 솔버가 재운 몸은 키네마틱 발판이 밀어 올려도 반응하지 않는다.
    entity.require('Rigidbody3D').canSleep = false;
    const t = entity.require('Transform3D');
    state.spawn = { x: t.position.x, y: t.position.y, z: t.position.z };
    state.hp = props.maxHp;
    state.dash = 0;
    state.dashCd = 0;
    state.attackCd = 0;
    state.invuln = 0;
    state.facing = { x: 0, y: 0, z: -1 };
    const hud = hudState(world);
    hud.hp = state.hp;
    hud.maxHp = props.maxHp;

    // 씬을 다시 로드하면 onStart 가 다시 돌기 때문에, 구독을 들고 있다가 정리한다.
    // 정리하지 않으면 챔버를 옮길 때마다 피해가 두 배씩 들어간다.
    state.off = [];
    state.off.push(world.events.on('player:damage', ({ amount, from }) => {
      if (state.invuln > 0) return;
      state.hp -= amount;
      state.invuln = 0.8;
      hudState(world).hp = Math.max(0, state.hp);
      const body = entity.get('Rigidbody3D');
      if (body && from) {
        const t2 = entity.require('Transform3D');
        const dx = t2.position.x - from.x;
        const dz = t2.position.z - from.z;
        const len = Math.hypot(dx, dz) || 1;
        body.velocity.x = (dx / len) * 7;
        body.velocity.y = 4;
        body.velocity.z = (dz / len) * 7;
      }
      world.events.emit('fx:hit', { entity, amount });
      if (state.hp <= 0) world.events.emit('player:died', { entity });
    }));

    state.off.push(world.events.on('player:died', () => {
      const hud = hudState(world);
      hud.deaths++;
      state.hp = props.maxHp;
      hud.hp = state.hp;
      state.invuln = 1.2;
      const t2 = entity.require('Transform3D');
      t2.position.x = state.spawn.x;
      t2.position.y = state.spawn.y;
      t2.position.z = state.spawn.z;
      const body = entity.get('Rigidbody3D');
      if (body) { body.velocity.x = 0; body.velocity.y = 0; body.velocity.z = 0; }
      say(world, '다시 눈을 뜬다', 2);
    }));
  },

  onDestroy({ state }) {
    for (const off of state.off ?? []) off();
    state.off = [];
  },

  onFixedUpdate({ entity, props, state, world, dt }) {
    const input = getInput(world);
    const body = entity.require('Rigidbody3D');
    const t = entity.require('Transform3D');
    const memo = lawMemo(world);
    const lawMode = input.isDown('law');

    if (state.dashCd > 0) state.dashCd -= dt;
    if (state.attackCd > 0) state.attackCd -= dt;
    if (state.invuln > 0) state.invuln -= dt;

    /* 카메라 기준 이동 방향 */
    const cam = activeCamera3D(world);
    let fx = 0, fz = -1, rx = 1, rz = 0;
    if (cam?.transform) {
      const f = forwardFlat(cam.transform);
      const r = rightDir(cam.transform);
      fx = f.x; fz = f.z;
      const rl = Math.hypot(r.x, r.z) || 1;
      rx = r.x / rl; rz = r.z / rl;
    }
    const mx = input.axis('moveX');
    const mz = input.axis('moveY');
    let wishX = rx * mx + fx * mz;
    let wishZ = rz * mx + fz * mz;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }
    if (wishLen > 0.01) {
      state.facing.x = wishX / (wishLen || 1);
      state.facing.z = wishZ / (wishLen || 1);
    }

    const heavy = entity.get('LawTarget').weight > 0;
    const speed = props.speed * (heavy ? 0.55 : 1);
    const grounded = body.grounded;

    /* 회피 — 무적 프레임이 붙은 짧은 돌진 */
    if (!lawMode && input.pressed('dash') && state.dashCd <= 0 && state.dash <= 0) {
      state.dash = props.dashTime;
      state.dashCd = props.dashCooldown;
      state.invuln = Math.max(state.invuln, props.dashTime + 0.12);
      const dx = wishLen > 0.01 ? wishX : state.facing.x;
      const dz = wishLen > 0.01 ? wishZ : state.facing.z;
      body.velocity.x = dx * props.dashSpeed;
      body.velocity.z = dz * props.dashSpeed;
      body.velocity.y = Math.max(body.velocity.y, 0);
      world.events.emit('fx:dash', { entity });
    }

    if (state.dash > 0) {
      state.dash -= dt;
      body.gravityScale = 0.15;
      if (state.dash <= 0) {
        body.gravityScale = 1;
        body.velocity.x *= 0.45;
        body.velocity.z *= 0.45;
      }
    } else {
      const accel = grounded ? props.acceleration : props.airAcceleration;
      // 자기 관성 유지 : 공중에서 감속하지 않는다
      const keepMomentum = memo.selfInertia > 0 && !grounded;
      const targetX = wishX * speed;
      const targetZ = wishZ * speed;
      if (!keepMomentum || wishLen > 0.01) {
        body.velocity.x += clamp(targetX - body.velocity.x, -accel * dt, accel * dt);
        body.velocity.z += clamp(targetZ - body.velocity.z, -accel * dt, accel * dt);
      }
    }

    /* 점프 */
    if (input.pressed('jump') && grounded && state.dash <= 0) {
      const g = 24 * (heavy ? 2.2 : 1);
      body.velocity.y = Math.sqrt(2 * g * props.jumpHeight) * (heavy ? 0.8 : 1);
      world.events.emit('fx:jump', { entity });
    }

    /* 기본 공격 — 적에게는 피해, 물체에는 운동 */
    if (!lawMode && input.pressed('fire') && state.attackCd <= 0) {
      state.attackCd = 0.38;
      attack(world, entity, props, state);
    }

    if (t.position.y < -40) world.events.emit('player:died', { entity });

    const hud = hudState(world);
    hud.selfWeight = heavy;
    hud.selfInertia = Math.max(0, memo.selfInertia);
  },
});

function attack(world, entity, props, state) {
  const t = entity.require('Transform3D');
  const physics = getPhysics3D(world);
  const center = {
    x: t.position.x + state.facing.x * props.attackRange * 0.6,
    y: t.position.y,
    z: t.position.z + state.facing.z * props.attackRange * 0.6,
  };
  world.events.emit('fx:attack', { entity, center });
  if (!physics) return;

  const hits = physics.overlapSphere(center, props.attackRange * 0.7, { ignore: [entity.id] });
  const damaged = new Set();
  for (const hit of hits) {
    const other = hit.entity ?? hit;
    if (!other?.alive) continue;
    const law = other.get('LawTarget');

    if (other.has('Health') && !damaged.has(other.id)) {
      damaged.add(other.id);
      world.events.emit('enemy:damage', {
        entity: other, amount: props.attackDamage, source: 'melee', from: t.position,
      });
      continue;
    }
    // 물체를 차낸다 — 무거울수록 덜 밀린다
    const body = other.get('Rigidbody3D');
    if (body && law && body.type === 'dynamic') {
      const ratio = clamp((law.baseMass || body.mass) / body.mass, 0.12, 1);
      body.velocity.x += state.facing.x * props.attackImpulse * ratio;
      body.velocity.z += state.facing.z * props.attackImpulse * ratio;
      body.velocity.y += 1.6 * ratio;
      law.flash = Math.max(law.flash, 0.4);
    }
  }
}

/* ── 장치 (능력 입력) ───────────────────────────────────────────── */

export const LawDevice = defineBehavior({
  name: 'LawDevice',
  description:
    '법칙 조작 모드. Z 를 누르고 있으면 시간이 느려지고, Q/E/R 로 계열을 고른 뒤 ' +
    '좌클릭·우클릭·E·Shift 로 세부 능력을 발동한다. 조준은 화면의 커서.',
  requires: ['Transform3D'],
  props: {
    range: { type: 'number', default: 34, description: '조준 사거리 (m)' },
    assistAngle: { type: 'number', default: 0.94, description: '조준 보조 각도의 코사인' },
    cooldown: { type: 'number', default: 0.22 },
  },

  onStart({ state, world, entity }) {
    state.series = null;
    state.cd = 0;
    state.wasLaw = false;
    // 사용 가능한 계열은 챔버가 정한다 (Chamber.abilities). 여기서 덮어쓰지 않는다.
    const hud = hudState(world);
    if (!hud.available?.length) hud.available = ['weight', 'phase', 'inertia'];
    state.off = [];
    state.off.push(world.events.on('law:stored', ({ speed }) => { hudState(world).stored = speed; }));
    state.off.push(world.events.on('law:released', () => { hudState(world).stored = 0; }));
    state.off.push(world.events.on('law:marked', () => { hudState(world).marked = true; }));
    state.off.push(world.events.on('law:cast', ({ series, slot }) => {
      const hud2 = hudState(world);
      const key = `${series}${slot}`;
      hud2.uses[key] = (hud2.uses[key] || 0) + 1;
      if (!(series === 'weight' && slot === 2) && !(series === 'phase' && slot === 2)) {
        hud2.marked = !!lawMemo(world).transfer;
      }
    }));
    state.player = entity;
  },

  onDestroy({ state }) {
    for (const off of state.off ?? []) off();
    state.off = [];
  },

  onUpdate({ world, props, state, entity, app, time, dt }) {
    const input = getInput(world);
    const hud = hudState(world);
    const lawMode = input.isDown('law');

    if (state.cd > 0) state.cd -= dt;
    if (hud.messageTimer > 0) hud.messageTimer -= dt;
    else hud.message = '';

    /* 시간 감속 — "세계의 법칙을 만지는 동안" 세계가 기다려 준다 */
    const clock = time ?? app?.time;
    if (clock) {
      const want = lawMode ? TIME_SLOW : 1;
      clock.timeScale += (want - clock.timeScale) * Math.min(1, dt * 14);
      if (Math.abs(clock.timeScale - want) < 0.02) clock.timeScale = want;
    }

    if (!lawMode) {
      state.wasLaw = false;
      hud.lawMode = false;
      hud.target = null;
      hud.targetInfo = null;
      return;
    }
    if (!state.wasLaw) {
      state.wasLaw = true;
      state.chose = false;   // 이번 Z 홀드에서 계열을 골랐는지
      world.events.emit('fx:lawmode', { entity });
    }
    hud.lawMode = true;

    /* 조준이 먼저다 — 같은 프레임에 누른 키가 이 대상에 적용된다 */
    const aim = aimRay(world, entity, props);
    state.target = aim?.target ?? null;
    state.aimPoint = aim?.point ?? null;
    hud.target = state.target ? state.target.name : null;
    hud.targetInfo = state.target ? describeTarget(state.target) : null;

    const fire = (slot) => {
      if (state.cd > 0) return;
      const res = castLaw(world, {
        series: state.series,
        slot,
        target: state.target,
        aim: state.aimPoint,
        caster: entity,
      });
      if (res.ok) {
        state.cd = props.cooldown;
        world.events.emit('fx:cast', { series: state.series, slot, target: state.target });
      } else if (res.reason) {
        say(world, res.reason, 1.4);
      }
    };

    /* 계열 선택 : Z 를 누른 뒤 처음 누른 Q/E/R 이 계열, 그 다음부터 E 는 3번째 능력 */
    const av = hud.available;
    if (!state.series) state.series = av[0];
    if (input.pressed('lawWeight') && av.includes('weight')) selectSeries(state, hud, 'weight', world);
    if (input.pressed('lawInertia') && av.includes('inertia')) selectSeries(state, hud, 'inertia', world);
    if (input.pressed('lawPhase')) {
      if (!state.chose && av.includes('phase')) selectSeries(state, hud, 'phase', world);
      else fire(2);
    }
    hud.series = state.series;

    if (input.pressed('fire')) fire(0);
    if (input.pressed('aim')) fire(1);
    if (input.pressed('dash')) fire(3);
  },
});

function selectSeries(state, hud, series, world) {
  state.chose = true;
  if (state.series === series) return;
  state.series = series;
  hud.series = series;
  world.events.emit('fx:series', { series });
}

function describeTarget(entity) {
  const law = entity.get('LawTarget');
  const body = entity.get('Rigidbody3D');
  const v = body?.velocity ?? { x: 0, y: 0, z: 0 };
  return {
    label: law?.label ?? entity.name,
    mass: body ? Math.round(body.mass * 10) / 10 : 0,
    speed: Math.round(Math.hypot(v.x, v.y, v.z) * 10) / 10,
    weight: law?.weight ?? 0,
    phased: !!law?.phased,
  };
}

/**
 * 커서가 가리키는 대상을 찾는다.
 * 정확히 맞히면 그 물체, 살짝 빗나가면 화면 중앙에 가까운 물체로 보정한다.
 * 벽 뒤의 물체는 잡히지 않는다 — 그건 위상 능력이 할 일이다.
 */
function aimRay(world, entity, props) {
  const physics = getPhysics3D(world);
  const cam = activeCamera3D(world);
  if (!physics || !cam?.transform) return null;

  const renderer = world.getResource?.(RENDERER_RESOURCE);
  const input = getInput(world);
  let origin, direction;

  if (renderer?.width && input?.mouse?.over) {
    const view = computeView3D(cam.camera, cam.transform, renderer.width, renderer.height);
    const ray = screenToRay(view, input.mouse.x, input.mouse.y);
    origin = ray.origin;
    direction = ray.direction;
  } else {
    // 마우스가 없을 때(헤드리스 실행, 커서가 화면 밖)는 카메라 정면
    origin = { ...cam.transform.position };
    const f = cam.transform.quaternion
      ? rotate(cam.transform.quaternion, { x: 0, y: 0, z: -1 })
      : { x: 0, y: 0, z: -1 };
    direction = f;
  }

  const hits = physics.raycastAll(origin, direction, {
    maxDistance: props.range,
    ignore: [entity.id],
  });
  let point = null;
  for (const hit of hits) {
    if (!point) point = hit.point;
    const law = hit.entity?.get('LawTarget');
    if (law?.grabbable) return { target: hit.entity, point: hit.point };
    // 잡을 수 없는 지형에 먼저 막히면 그 뒤는 보이지 않는다
    break;
  }

  /* 조준 보조 : 광선에 가장 가까운 대상 */
  let best = null;
  let bestDot = props.assistAngle;
  for (const [candidate, law] of world.each('LawTarget')) {
    if (!law.grabbable || candidate.id === entity.id) continue;
    const t = candidate.get('WorldTransform3D') ?? candidate.get('Transform3D');
    if (!t) continue;
    const dx = t.position.x - origin.x;
    const dy = t.position.y - origin.y;
    const dz = t.position.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > props.range || dist < 1e-3) continue;
    const dot = (dx * direction.x + dy * direction.y + dz * direction.z) / dist;
    if (dot > bestDot) { bestDot = dot; best = candidate; }
  }
  if (!point) {
    point = {
      x: origin.x + direction.x * 18,
      y: origin.y + direction.y * 18,
      z: origin.z + direction.z * 18,
    };
  }
  return { target: best, point };
}

function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

/* ── 카메라 ─────────────────────────────────────────────────────── */

export const LawCamera = defineBehavior({
  name: 'LawCamera',
  description:
    '3인칭 추적 카메라. 방향키로 궤도를 돌리고 휠로 거리 조절. ' +
    '마우스 좌·우 버튼은 능력이 쓰므로 카메라 조작에 쓰지 않는다.',
  requires: ['Transform3D', 'Camera3D'],
  props: {
    target: { type: 'entity', default: '', description: '따라갈 대상' },
    height: { type: 'number', default: 1.5 },
    distance: { type: 'number', default: 11 },
    minDistance: { type: 'number', default: 5 },
    maxDistance: { type: 'number', default: 22 },
    pitch: { type: 'number', default: 24 },
    yaw: { type: 'number', default: 0 },
    turnSpeed: { type: 'number', default: 110, description: '방향키 회전 속도 (도/초)' },
    halfLife: { type: 'number', default: 0.09 },
  },

  onStart({ state, props }) {
    state.yaw = props.yaw;
    state.pitch = props.pitch;
    state.distance = props.distance;
    state.pos = null;
  },

  onUpdate({ entity, props, state, world, dt }) {
    const input = getInput(world);
    const targetEntity = props.target ? world.findById(props.target) : world.findFirstByTag('player');
    if (!targetEntity?.alive) return;
    const tt = targetEntity.get('WorldTransform3D') ?? targetEntity.get('Transform3D');
    if (!tt) return;

    state.yaw -= input.axis('camX') * props.turnSpeed * dt;
    state.pitch = clamp(state.pitch - input.axis('camY') * props.turnSpeed * 0.7 * dt, -8, 72);
    if (input.mouse?.wheel) {
      state.distance = clamp(state.distance + input.mouse.wheel * 1.1, props.minDistance, props.maxDistance);
    }

    const yaw = state.yaw * (Math.PI / 180);
    const pitch = state.pitch * (Math.PI / 180);
    const focus = {
      x: tt.position.x,
      y: tt.position.y + props.height,
      z: tt.position.z,
    };

    // 벽 뚫림 방지 : 초점에서 카메라 자리까지 광선을 쏴서, 지형에 막히면 그 앞까지만 물러난다.
    // 없으면 좁은 방이나 아레나 가장자리에서 카메라가 벽 밖으로 나가 화면이 새까매진다.
    let distance = state.distance;
    const physics = getPhysics3D(world);
    if (physics) {
      const dir = {
        x: Math.sin(yaw) * Math.cos(pitch),
        y: Math.sin(pitch),
        z: Math.cos(yaw) * Math.cos(pitch),
      };
      const hits = physics.raycastAll(focus, dir, {
        maxDistance: state.distance + 0.6,
        ignore: [targetEntity.id, entity.id],
      });
      const blocker = hits.find((h) => (h.entity.get('Rigidbody3D')?.type ?? 'static') === 'static');
      if (blocker) distance = Math.max(1.6, blocker.distance - 0.6);
    }

    const horizontal = Math.cos(pitch) * distance;
    const desired = {
      x: focus.x + Math.sin(yaw) * horizontal,
      y: focus.y + Math.sin(pitch) * distance,
      z: focus.z + Math.cos(yaw) * horizontal,
    };

    const t = entity.require('Transform3D');
    if (!state.pos) state.pos = { ...desired };
    // 지수 감쇠 추적 : 프레임레이트가 달라도 같은 감각
    const k = 1 - Math.pow(0.5, dt / Math.max(props.halfLife, 1e-4));
    state.pos.x += (desired.x - state.pos.x) * k;
    state.pos.y += (desired.y - state.pos.y) * k;
    state.pos.z += (desired.z - state.pos.z) * k;
    t.position.x = state.pos.x;
    t.position.y = state.pos.y;
    t.position.z = state.pos.z;

    const focusY = tt.position.y + props.height * 0.7;
    const dx = t.position.x - focus.x;
    const dz = t.position.z - focus.z;
    const dy = t.position.y - focusY;
    t.rotation.y = Math.atan2(dx, dz) * (180 / Math.PI);
    t.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz)) * (180 / Math.PI);
    t.rotation.z = 0;
  },
});

export { SERIES, applyWeight };
