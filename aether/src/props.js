/**
 * 챔버를 이루는 장치들 — 압력판, 문, 부술 수 있는 것, 출구, 사출기.
 *
 * 전부 "충격량"과 "질량"이라는 두 숫자에만 반응한다.
 * 플레이어가 이해해야 하는 규칙이 적을수록 실험이 늘어난다.
 */

import { defineComponent, defineBehavior, getPhysics3D, instantiate } from '../engine/src/index.js';
import { impactOf, lawMemo } from './law.js';
import { hudState, say } from './player.js';

/* ── 압력판 ─────────────────────────────────────────────────────── */

export const PressurePlate = defineBehavior({
  name: 'PressurePlate',
  description:
    '위에 놓인 것의 질량이 기준을 넘으면 대상을 연다. 플레이어 혼자서는 절대 넘지 못하는 ' +
    '기준값을 주면, 그 자체가 "무엇을 무겁게 만들까"라는 질문이 된다.',
  requires: ['Transform3D'],
  props: {
    need: { type: 'number', default: 40, description: '필요 질량 (kg)' },
    target: { type: 'entity', default: '', description: '열 문' },
    radius: { type: 'number', default: 1.6 },
    event: { type: 'string', default: '' },
  },
  onStart({ state }) { state.on = false; state.load = 0; },
  onFixedUpdate({ entity, props, state, world }) {
    const physics = getPhysics3D(world);
    const t = entity.require('Transform3D');
    if (!physics) return;

    const hits = physics.overlapSphere(
      { x: t.position.x, y: t.position.y + props.radius * 0.8, z: t.position.z },
      props.radius,
      { ignore: [entity.id] },
    );
    let load = 0;
    for (const hit of hits) {
      const other = hit.entity ?? hit;
      const law = other.get?.('LawTarget');
      const body = other.get?.('Rigidbody3D');
      if (!body || !law || law.phased) continue;
      load = Math.max(load, body.mass);
    }
    state.load = load;
    const on = load >= props.need;
    if (on === state.on) return;

    state.on = on;
    const door = props.target ? world.findById(props.target) : null;
    if (door) door.__open = on;
    world.events.emit('plate:changed', { entity, on, load, need: props.need, target: props.target });
    if (on && props.event) world.events.emit(props.event, { entity });
  },
});

/* ── 문 ─────────────────────────────────────────────────────────── */

export const SlideDoor = defineBehavior({
  name: 'SlideDoor',
  description: '열리면 지정한 만큼 미끄러진다. 압력판이 entity 참조로 이 문을 가리킨다.',
  requires: ['Transform3D'],
  props: {
    openOffset: { type: 'vec3', default: [0, -4.2, 0], description: '열렸을 때의 상대 위치' },
    speed: { type: 'number', default: 3.2 },
    startOpen: { type: 'boolean', default: false },
  },
  onStart({ entity, state, props }) {
    const t = entity.require('Transform3D');
    state.closed = { x: t.position.x, y: t.position.y, z: t.position.z };
    state.p = props.startOpen ? 1 : 0;
    entity.__open = props.startOpen;
  },
  onFixedUpdate({ entity, state, props, dt }) {
    const want = entity.__open ? 1 : 0;
    if (state.p === want) return;
    const step = props.speed * dt;
    state.p = want > state.p ? Math.min(want, state.p + step) : Math.max(want, state.p - step);
    const t = entity.require('Transform3D');
    t.position.x = state.closed.x + props.openOffset.x * state.p;
    t.position.y = state.closed.y + props.openOffset.y * state.p;
    t.position.z = state.closed.z + props.openOffset.z * state.p;
  },
});

/* ── 부술 수 있는 것 ────────────────────────────────────────────── */

export const Breakable = defineComponent({
  name: 'Breakable',
  category: 'Aether',
  requires: ['Transform3D'],
  description: '정해진 충격량 이상을 한 번에 받으면 부서진다.',
  schema: {
    threshold: { type: 'number', default: 700, description: '필요 충격량 (kg·m/s)' },
    label: { type: 'string', default: '' },
    best: { type: 'number', default: 0, runtime: true, description: '지금까지 받은 최대 충격량' },
    broken: { type: 'boolean', default: false, runtime: true },
  },
});

export const BreakableWall = defineBehavior({
  name: 'BreakableWall',
  description:
    '충돌 직전 속도 × 질량이 기준을 넘으면 부서진다. 모자라면 얼마나 모자랐는지 알려준다 — ' +
    '"조금만 더 빠르면 되겠다"는 판단이 곧 다음 실험이 되기 때문이다.',
  requires: ['Transform3D', 'Breakable'],
  props: {},
  onCollisionEnter({ entity, world, other, normal }) {
    const info = entity.require('Breakable');
    if (info.broken) return;
    const impact = impactOf(other, entity, normal);
    if (impact <= 0) return;

    info.best = Math.max(info.best, impact);
    const hud = hudState(world);
    hud.lastImpact = Math.round(impact);

    if (impact >= info.threshold) {
      info.broken = true;
      world.events.emit('wall:broken', { entity, impact, label: info.label });
      world.events.emit('fx:break', { position: { ...entity.require('Transform3D').position }, impact });
      world.destroy(entity.id);
    } else if (impact > info.threshold * 0.25) {
      world.events.emit('fx:crack', { entity, impact, threshold: info.threshold });
      say(world, `${Math.round(impact)} / ${info.threshold} — 아직 부족하다`, 1.8);
    }
  },
});

/* ── 출구 ───────────────────────────────────────────────────────── */

export const ChamberGoal = defineBehavior({
  name: 'ChamberGoal',
  description: '플레이어가 닿으면 챔버를 클리어한다. needClear 면 적이 남아 있는 동안 잠긴다.',
  requires: ['Transform3D'],
  props: {
    radius: { type: 'number', default: 2 },
    needClear: { type: 'boolean', default: false, description: '적을 전부 처리해야 열린다' },
  },
  onStart({ state }) { state.done = false; },
  onFixedUpdate({ entity, props, state, world }) {
    if (state.done) return;
    const hud = hudState(world);
    const enemies = world.findByTag('enemy').filter((e) => e.alive).length
      + world.findByTag('boss').filter((e) => e.alive).length;
    hud.enemiesLeft = enemies;
    if (props.needClear && enemies > 0) return;

    const player = world.findFirstByTag('player');
    if (!player?.alive) return;
    const p = player.get('Transform3D');
    const t = entity.require('Transform3D');
    const d = Math.hypot(p.position.x - t.position.x, p.position.y - t.position.y, p.position.z - t.position.z);
    if (d > props.radius + 0.8) return;

    state.done = true;
    hud.cleared = true;
    world.events.emit('chamber:clear', { elapsed: hud.elapsed, uses: { ...hud.uses }, deaths: hud.deaths });
  },
});

/* ── 챔버 (진행 상태 · 계측) ────────────────────────────────────── */

export const Chamber = defineBehavior({
  name: 'Chamber',
  description:
    '챔버 하나의 정보와 계측을 들고 있다. 이 프로토타입의 목적이 검증이므로, ' +
    '경과 시간·능력 사용 횟수·사망 수를 여기서 세어 리포트로 넘긴다.',
  props: {
    title: { type: 'string', default: '' },
    objective: { type: 'string', default: '' },
    test: { type: 'string', default: '', description: '이 챔버가 겨냥하는 검증 항목' },
    abilities: { type: 'string', default: 'weight,phase,inertia', description: '사용 가능한 계열' },
    hint1: { type: 'string', default: '' },
    hint2: { type: 'string', default: '' },
    hint3: { type: 'string', default: '' },
    next: { type: 'string', default: '', description: '다음 씬 파일' },
  },
  onStart({ props, world }) {
    // 씬을 옮겨도 world 는 같은 객체이므로, 챔버 시작 시 장치 상태를 직접 비운다
    const memo = lawMemo(world);
    memo.stored = null;
    memo.transfer = null;
    memo.selfInertia = 0;

    const hud = hudState(world);
    hud.chamber = props.title;
    hud.objective = props.objective;
    hud.test = props.test;
    hud.available = props.abilities.split(',').map((s) => s.trim()).filter(Boolean);
    hud.hints = [props.hint1, props.hint2, props.hint3].filter(Boolean);
    hud.next = props.next;
    hud.elapsed = 0;
    hud.cleared = false;
    hud.uses = {};
    hud.deaths = 0;
    hud.lastImpact = 0;
    hud.stored = 0;
    hud.marked = false;
    hud.bossHp = -1;
    hud.message = '';
    hud.messageTimer = 0;
  },
  onFixedUpdate({ world, dt }) {
    const hud = hudState(world);
    if (!hud.cleared) hud.elapsed += dt;
  },
});

/* ── 사출기 ─────────────────────────────────────────────────────── */

export const Launcher = defineBehavior({
  name: 'Launcher',
  description:
    '주기적으로 물체를 쏘아 보낸다. 관성 능력은 "이미 일어난 움직임"에만 걸리므로, ' +
    '챔버에는 움직임을 만들어 주는 장치가 하나씩 필요하다.',
  requires: ['Transform3D'],
  props: {
    prefab: { type: 'string', default: 'Boulder' },
    interval: { type: 'number', default: 4 },
    speed: { type: 'number', default: 14 },
    direction: { type: 'vec3', default: [0, 0, -1] },
    offset: { type: 'vec3', default: [0, 0, -2] },
    maxAlive: { type: 'int', default: 3 },
    tag: { type: 'string', default: 'launched' },
  },
  onStart({ state, props }) { state.timer = props.interval * 0.35; state.spawned = []; },
  onFixedUpdate({ entity, props, state, world, dt }) {
    state.timer -= dt;
    if (state.timer > 0) return;
    state.timer = props.interval;

    state.spawned = state.spawned.filter((e) => e.alive);
    if (state.spawned.length >= props.maxAlive) {
      const oldest = state.spawned.shift();
      if (oldest?.alive) world.destroy(oldest.id);
    }

    const t = entity.require('Transform3D');
    const d = props.direction;
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const spawned = instantiate(world, {
      prefab: props.prefab,
      tags: [props.tag],
      components: {
        Transform3D: {
          position: [
            t.position.x + props.offset.x,
            t.position.y + props.offset.y,
            t.position.z + props.offset.z,
          ],
        },
        Rigidbody3D: {
          velocity: [
            (d.x / len) * props.speed,
            (d.y / len) * props.speed,
            (d.z / len) * props.speed,
          ],
        },
      },
    });
    state.spawned.push(spawned);
    world.events.emit('launcher:fired', { entity, spawned });
  },
});

/* ── 이상 현상 ──────────────────────────────────────────────────── */

export const Anomaly = defineBehavior({
  name: 'Anomaly',
  description:
    '떨어지는 법을 잊은 물체. 능력이 닿기 전까지 공중에 머문다 — ' +
    '세계가 고장 났다는 사실을 설명 없이 보여주는 장치.',
  requires: ['Transform3D', 'Rigidbody3D', 'LawTarget'],
  props: {
    bob: { type: 'number', default: 0.25, description: '위아래로 흔들리는 폭 (m)' },
    speed: { type: 'number', default: 1.1 },
  },
  onStart({ entity, state }) {
    const t = entity.require('Transform3D');
    state.baseY = t.position.y;
    state.phase = (entity.id % 7) * 0.9;
    entity.require('Rigidbody3D').gravityScale = 0;
    const law = entity.get('LawTarget');
    if (law) { law.baseGravity = 0; law.baseMass = entity.require('Rigidbody3D').mass; }
  },
  onFixedUpdate({ entity, state, props, dt }) {
    const law = entity.get('LawTarget');
    // 능력이 한 번이라도 닿으면 이상 현상은 풀린다
    if (law && (law.weight !== 0 || law.phased)) return;
    const body = entity.require('Rigidbody3D');
    if (body.gravityScale !== 0) return;
    state.phase += dt * props.speed;
    const t = entity.require('Transform3D');
    t.position.y = state.baseY + Math.sin(state.phase) * props.bob;
    body.velocity.x *= 0.9;
    body.velocity.y = 0;
    body.velocity.z *= 0.9;
  },
});
