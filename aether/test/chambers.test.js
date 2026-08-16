/**
 * 챔버가 실제로 풀리는가 — 헤드리스로 증명한다.
 *
 * 프로토타입의 목적이 "이 설계가 재미있는가"를 검증하는 것이므로,
 * 테스트도 "이 능력 조합으로 이 문이 열리는가"를 그대로 묻는다.
 * 엔진이 결정론적이라 한 번 통과한 해법은 계속 통과한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProject } from '../engine/src/runtime/headless.js';
import { castLaw } from '../src/law.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, '');

const open = (scene) => loadProject(ROOT, { scene: `scenes/${scene}.json` });
const speed = (b) => Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);

/** 플레이어를 출구로 옮기고 클리어를 확인한다 (이동 자체는 별도 테스트에서 본다). */
function reachGoal(app) {
  const goal = app.find('출구');
  const p = app.find('여행자').get('Transform3D');
  const g = goal.get('Transform3D').position;
  p.position.x = g.x; p.position.y = g.y; p.position.z = g.z;
  app.run(10);
}

/* ── 1장 : 깨어남 ─────────────────────────────────────────────── */

test('c1: 떠 있는 바위를 무겁게 만들면 떨어져 압력판을 누르고 문이 열린다', async () => {
  const app = await open('c1-awakening');
  app.run(30);

  const rock = app.find('떠 있는 바위');
  const gate = app.find('문');
  const gateY0 = gate.get('Transform3D').position.y;

  assert.equal(rock.get('Rigidbody3D').mass, 6);
  castLaw(app.world, { series: 'weight', slot: 0, target: rock });
  assert.equal(rock.get('Rigidbody3D').mass, 48, '무게 증가는 질량을 8배로 만든다');

  app.run(120);
  assert.ok(rock.get('Transform3D').position.y < 2, `바위가 떨어져야 한다 (y=${rock.get('Transform3D').position.y})`);
  assert.ok(gate.get('Transform3D').position.y > gateY0 + 4, '문이 열려야 한다');

  let cleared = false;
  app.world.events.on('chamber:clear', () => { cleared = true; });
  reachGoal(app);
  assert.ok(cleared, '출구에 닿으면 챔버가 끝난다');
});

test('c1: 플레이어 혼자서는 압력판을 누를 수 없다', async () => {
  const app = await open('c1-awakening');
  app.run(20);
  const plate = app.find('압력판');
  const p = app.find('여행자').get('Transform3D');
  const t = plate.get('Transform3D').position;
  p.position.x = t.x; p.position.y = 1.4; p.position.z = t.z;
  app.run(60);
  const gate = app.find('문');
  assert.ok(gate.get('Transform3D').position.y < 3, '3kg 짜리 여행자로는 30kg 기준을 넘지 못한다');
});

/* ── 검증 1 : 무게 ────────────────────────────────────────────── */

test('c2 루트A: 가벼워진 상자는 떠오르고, 그 위에 올라탄 플레이어를 함께 올린다', async () => {
  const app = await open('c2-weight');
  app.run(30);

  const crate = app.find('상자');
  const player = app.find('여행자');
  const ct = crate.get('Transform3D');
  const pt = player.get('Transform3D');

  // 상자 위에 올라선 상태에서 무게를 지운다
  pt.position.x = ct.position.x;
  pt.position.y = ct.position.y + 1.8;
  pt.position.z = ct.position.z;
  app.run(20);
  const y0 = pt.position.y;

  castLaw(app.world, { series: 'weight', slot: 1, target: crate });
  app.run(180);

  assert.ok(ct.position.y > 4, `상자가 떠올라야 한다 (y=${ct.position.y.toFixed(2)})`);
  assert.ok(pt.position.y > y0 + 2.5,
    `플레이어가 상자를 타고 올라가야 한다 (${y0.toFixed(2)} → ${pt.position.y.toFixed(2)})`);
  assert.ok(pt.position.y > 5, '장벽(높이 5)보다 높이 올라갈 수 있어야 한다');
});

test('c2 루트B: 무거워진 바위를 압력판에 올리면 장벽의 문이 열린다', async () => {
  const app = await open('c2-weight');
  app.run(20);

  const rock = app.find('바위');
  const plate = app.find('압력판');
  const gate = app.find('문');
  const y0 = gate.get('Transform3D').position.y;

  const pt = plate.get('Transform3D').position;
  const rt = rock.get('Transform3D');
  rt.position.x = pt.x; rt.position.y = pt.y + 2; rt.position.z = pt.z;
  castLaw(app.world, { series: 'weight', slot: 0, target: rock });
  app.run(150);

  assert.ok(gate.get('Transform3D').position.y < y0 - 3, `문이 내려가 열려야 한다 (y=${gate.get('Transform3D').position.y.toFixed(2)})`);
});

test('c2 루트C: 자기 무게로 내리찍으면 균열 바닥이 부서진다', async () => {
  const app = await open('c2-weight');
  app.run(20);

  const crack = app.find('균열 바닥');
  const player = app.find('여행자');
  const ct = crack.get('Transform3D').position;

  // 균열 바닥 위 높은 곳에서, 자기 무게를 켠 채 낙하
  const pt = player.get('Transform3D');
  pt.position.x = ct.x; pt.position.y = 9; pt.position.z = ct.z;
  castLaw(app.world, { series: 'weight', slot: 3, caster: player });
  assert.equal(player.get('Rigidbody3D').mass, 24, '자기 무게도 8배가 된다');

  let broken = false;
  app.world.events.on('wall:broken', ({ label }) => { if (label === '균열 바닥') broken = true; });
  app.run(90);
  assert.ok(broken, '무거워진 몸으로 내리찍으면 균열 바닥이 뚫린다');
});

/* ── 검증 2 : 관성 ────────────────────────────────────────────── */

test('c3: 사출된 바위는 그냥으로는 강화벽을 못 부수고, 증폭하면 부순다', async () => {
  async function trial(amplify) {
    const app = await open('c3-inertia');
    const wall = app.find('강화벽');
    let boulder = null;
    let broken = false;
    app.world.events.on('launcher:fired', ({ spawned }) => { if (!boulder) boulder = spawned; });
    app.world.events.on('wall:broken', () => { broken = true; });

    for (let i = 0; i < 60 * 8; i++) {
      app.run(1);
      if (amplify && boulder?.alive && !boulder.__done) {
        const z = boulder.get('Transform3D').position.z;
        if (z < 4) { boulder.__done = true; castLaw(app.world, { series: 'inertia', slot: 0, target: boulder }); }
      }
    }
    return { broken, best: wall.alive ? wall.get('Breakable').best : Infinity };
  }

  const plain = await trial(false);
  assert.equal(plain.broken, false, `증폭 없이는 부서지면 안 된다 (충격량 ${Math.round(plain.best)})`);
  assert.ok(plain.best > 400, '그래도 눈에 띄는 충격은 남아야 "조금 모자라다"를 읽을 수 있다');

  const amped = await trial(true);
  assert.equal(amped.broken, true, '증폭하면 부순다');
});

test('c3: 증폭은 이미 움직이는 것에만 걸린다', async () => {
  const app = await open('c3-inertia');
  app.run(20);
  const rock = app.find('바위');
  const still = castLaw(app.world, { series: 'inertia', slot: 0, target: rock });
  assert.equal(still.ok, false);
  assert.match(still.reason, /움직이지/);

  // 방향 변경은 멈춘 것도 밀어낸다
  const pushed = castLaw(app.world, {
    series: 'inertia', slot: 1, target: rock,
    aim: { x: rock.get('Transform3D').position.x, y: 1, z: -20 },
  });
  assert.equal(pushed.ok, true);
  assert.ok(speed(rock.get('Rigidbody3D')) > 10, '방향 변경은 최소 속도를 부여한다');

  const amped = castLaw(app.world, { series: 'inertia', slot: 0, target: rock });
  assert.equal(amped.ok, true, '움직이기 시작했으면 증폭할 수 있다');
});

/* ── 검증 3 : 조합 ────────────────────────────────────────────── */

test('c4: 초강화벽은 무게만으로도 관성만으로도 부서지지 않고, 둘을 겹쳐야 부서진다', async () => {
  async function trial({ heavy = false, amp = false }) {
    const app = await open('c4-combination');
    const wall = app.find('초강화벽');
    let boulder = null;
    let broken = false;
    app.world.events.on('launcher:fired', ({ spawned }) => { if (!boulder) boulder = spawned; });
    app.world.events.on('wall:broken', () => { broken = true; });

    for (let i = 0; i < 60 * 8; i++) {
      app.run(1);
      if (!boulder?.alive) continue;
      const z = boulder.get('Transform3D').position.z;
      if (heavy && !boulder.__h && z < 8) {
        boulder.__h = true;
        castLaw(app.world, { series: 'weight', slot: 0, target: boulder });
      }
      if (amp && !boulder.__a && z < 4) {
        boulder.__a = true;
        castLaw(app.world, { series: 'inertia', slot: 0, target: boulder });
      }
    }
    return { broken, best: wall.alive ? wall.get('Breakable').best : Infinity };
  }

  const none = await trial({});
  assert.equal(none.broken, false, '그냥은 안 된다');

  const ampOnly = await trial({ amp: true });
  assert.equal(ampOnly.broken, false, `증폭만으로는 모자라야 한다 (${Math.round(ampOnly.best)})`);

  const heavyOnly = await trial({ heavy: true });
  assert.equal(heavyOnly.broken, false, `무게만으로도 모자라야 한다 (${Math.round(heavyOnly.best)})`);

  const both = await trial({ heavy: true, amp: true });
  assert.equal(both.broken, true, '무게 + 관성이면 부순다');
});

/* ── 위상 ─────────────────────────────────────────────────────── */

test('c5: 위상화한 바위를 밀어 넣어 밀폐실 안의 압력판을 누른다', async () => {
  const app = await open('c5-phase');
  app.run(30);

  const rock = app.find('바위');
  const gate = app.find('문');
  const y0 = gate.get('Transform3D').position.y;
  const rt = rock.get('Transform3D');

  // 밀폐실 바로 앞에 두고 위상화한 뒤 안쪽으로 밀어 넣는다
  rt.position.x = 0; rt.position.y = 1.2; rt.position.z = -6;
  app.run(10);

  castLaw(app.world, { series: 'phase', slot: 0, target: rock });
  assert.equal(rock.get('LawTarget').phaseTimer > 0, true);
  castLaw(app.world, { series: 'inertia', slot: 1, target: rock, aim: { x: 0, y: 1.2, z: -14 } });

  app.run(60);
  const inside = rt.position.z < -9.4 && rt.position.z > -18.6 && Math.abs(rt.position.x) < 4.6;
  assert.ok(inside, `위상화된 바위는 벽을 통과해 안에 들어가야 한다 (z=${rt.position.z.toFixed(2)})`);

  app.run(240);   // 위상 해제 → 실체화
  assert.equal(rock.get('LawTarget').phased, false, '3.5초 뒤에는 실체로 돌아온다');
  assert.ok(rt.position.z < -9.4 && rt.position.z > -18.6, '실체화 위치는 밀폐실 안이어야 한다');

  castLaw(app.world, { series: 'weight', slot: 0, target: rock });
  app.run(180);
  assert.ok(gate.get('Transform3D').position.y > y0 + 4,
    `안쪽 압력판이 눌려 문이 열려야 한다 (y=${gate.get('Transform3D').position.y.toFixed(2)})`);
});

test('c5: 위상화된 물체는 밀어도 밀리지 않는다 — 만질 수 없기 때문에', async () => {
  const app = await open('c5-phase');
  app.run(20);
  const rock = app.find('바위');
  const rt = rock.get('Transform3D');
  rt.position.x = 0; rt.position.y = 1.2; rt.position.z = -6;
  app.run(10);

  castLaw(app.world, { series: 'phase', slot: 0, target: rock });
  app.run(2);
  const collider = rock.get('SphereCollider');
  assert.equal(collider.enabled, false, '위상화 중에는 충돌체가 꺼진다');
});

/* ── 전투 ─────────────────────────────────────────────────────── */

test('c6: 방패는 근접 공격을 막고, 위상화하면 그대로 통과한다', async () => {
  const app = await open('c6-combat');
  app.run(30);

  const guard = app.find('방패병');
  const shield = app.find('방패');
  const hp0 = guard.get('Health').current;

  app.world.events.emit('enemy:damage', { entity: guard, amount: 20, source: 'melee' });
  assert.equal(guard.get('Health').current, hp0, '방패가 실체일 때 정면 근접 공격은 통하지 않는다');

  castLaw(app.world, { series: 'phase', slot: 0, target: shield });
  app.run(2);
  app.world.events.emit('enemy:damage', { entity: guard, amount: 20, source: 'melee' });
  assert.equal(guard.get('Health').current, hp0 - 20, '방패를 위상화하면 공격이 지나간다');
});

test('c6: 돌진체는 벽에 처박히면 스스로 무너진다', async () => {
  const app = await open('c6-combat');
  const charger = app.find('돌진체');
  const hp0 = charger.get('Health').current;

  // 벽을 향해 돌진하도록 플레이어를 벽 뒤쪽에 세운다
  const p = app.find('여행자').get('Transform3D');
  p.position.x = -16; p.position.y = 1.4; p.position.z = -8;

  let selfWrecked = false;
  app.world.events.on('fx:slam', () => { selfWrecked = true; });
  app.run(60 * 6);

  assert.ok(selfWrecked || charger.get('Health').current < hp0,
    '벽에 부딪힌 돌진체는 피해를 입는다');
});

test('c6: 날아온 큰 바위 한 방이 근접 공격 여러 번보다 훨씬 아프다', async () => {
  const app = await open('c6-combat');
  app.run(20);
  const charger = app.find('돌진체');
  const hp0 = charger.get('Health').current;

  app.world.events.emit('enemy:damage', { entity: charger, amount: 8, source: 'melee' });
  const afterMelee = hp0 - charger.get('Health').current;

  let impactDamage = 0;
  app.world.events.on('fx:enemyHit', ({ source, amount }) => {
    if (source === 'impact') impactDamage += amount;
  });

  const boulder = app.find('큰 바위');
  const bt = boulder.get('Transform3D');
  const ct = charger.get('Transform3D').position;
  bt.position.x = ct.x; bt.position.y = ct.y; bt.position.z = ct.z + 8;
  app.run(4);   // 한 스텝 굴러 충돌 직전 속도가 기록되게 둔다

  castLaw(app.world, {
    series: 'inertia', slot: 1, target: boulder,
    aim: { x: ct.x, y: ct.y, z: ct.z },
  });
  app.run(2);
  castLaw(app.world, { series: 'inertia', slot: 0, target: boulder });
  app.run(60);

  assert.ok(impactDamage > afterMelee * 3,
    `물체 충돌(${impactDamage.toFixed(1)})이 근접(${afterMelee.toFixed(1)})보다 훨씬 커야 한다`);
});

/* ── 보스 ─────────────────────────────────────────────────────── */

test('c7: 파편을 무겁게 만들면 궤도를 잃고, 전부 떨어지면 핵이 드러난다', async () => {
  const app = await open('c7-boss');
  app.run(60);

  const boss = app.find('낙하를 잊은 자');
  const debris = app.world.findByTag('debris').filter((d) => d.alive);
  assert.equal(debris.length, 3, '보스는 파편 3개를 궤도에 두고 시작한다');

  const hp0 = boss.get('Health').current;
  app.world.events.emit('enemy:damage', { entity: boss, amount: 20, source: 'melee' });
  const armoredLoss = hp0 - boss.get('Health').current;
  assert.ok(armoredLoss < 20 * 0.5, `법칙 방어 중에는 근접이 거의 안 통해야 한다 (${armoredLoss})`);

  for (const d of debris) castLaw(app.world, { series: 'weight', slot: 0, target: d });
  app.run(30);
  assert.equal(app.world.findByTag('debris').filter((d) => d.alive && d.__orbiting).length, 0,
    '무게가 걸린 파편은 전부 궤도를 잃는다');

  const hp1 = boss.get('Health').current;
  app.world.events.emit('enemy:damage', { entity: boss, amount: 20, source: 'impact' });
  assert.ok(hp1 - boss.get('Health').current > 30, '핵이 드러난 동안에는 피해가 두 배가 된다');
});

test('c7: 보스를 쓰러뜨리면 출구가 열리고 챔버가 끝난다', async () => {
  const app = await open('c7-boss');
  app.run(30);
  const boss = app.find('낙하를 잊은 자');

  let cleared = false;
  app.world.events.on('chamber:clear', () => { cleared = true; });

  // 320 피해를 나눠 넣는다 (페이즈 전환이 끼어들어도 결국 죽어야 한다)
  for (let i = 0; i < 60 && boss.alive; i++) {
    for (const d of app.world.findByTag('debris')) {
      if (d.alive && d.__orbiting) castLaw(app.world, { series: 'weight', slot: 0, target: d });
    }
    app.run(20);
    if (boss.alive) app.world.events.emit('enemy:damage', { entity: boss, amount: 40, source: 'impact' });
  }
  assert.equal(boss.alive, false, '보스가 죽어야 한다');

  app.run(10);
  const p = app.find('여행자').get('Transform3D');
  const g = app.find('출구').get('Transform3D').position;
  p.position.x = g.x; p.position.y = g.y; p.position.z = g.z;
  app.run(10);
  assert.ok(cleared, '보스가 죽으면 잠겨 있던 출구가 열린다');
});

/* ── 전 챔버 안정성 ───────────────────────────────────────────── */

test('모든 챔버는 아무 입력 없이 10초를 돌려도 조용히 안정된다', async () => {
  const scenes = [
    'c1-awakening', 'c2-weight', 'c3-inertia', 'c4-combination',
    'c5-phase', 'c6-combat', 'c7-boss', 'c8-sandbox',
  ];
  for (const name of scenes) {
    const app = await open(name);
    app.run(60 * 10);

    const player = app.find('여행자');
    const t = player.get('Transform3D').position;
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z),
      `${name}: 좌표가 발산하면 안 된다`);
    assert.ok(t.y > -20, `${name}: 플레이어가 바닥을 뚫고 떨어지면 안 된다 (y=${t.y.toFixed(2)})`);
    assert.equal(app.world.findByTag('player').length, 1, `${name}: 플레이어는 하나`);
  }
});
