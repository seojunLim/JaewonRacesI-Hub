/**
 * HUD와 검증 리포트 — 브라우저에서만 도는 부분.
 *
 * 게임 로직은 전부 씬과 비헤이비어에 있고, 여기서는 world.__hud 를 읽어
 * 화면에 그리기만 한다. 헤드리스 실행에는 이 파일이 로드되지 않는다.
 */

import { SERIES } from './law.js';
import { hudState } from './player.js';

const CHAMBERS = [
  { file: 'c1-awakening', name: '깨어남', tag: '1장', test: 'T5', brief: '폐허에서 눈을 뜬다. 떠 있는 바위가 반응한다.' },
  { file: 'c2-weight', name: '무게의 방', tag: '검증 1', test: 'T1 · T4', brief: '벽 하나. 넘는 방법은 최소 세 가지.' },
  { file: 'c3-inertia', name: '구르는 것들', tag: '검증 2', test: 'T2', brief: '이미 일어난 움직임을 증폭하고, 꺾는다.' },
  { file: 'c4-combination', name: '두 법칙', tag: '검증 3', test: 'T3', brief: '하나로는 부족하다. 두 개를 겹쳐야 한다.' },
  { file: 'c5-phase', name: '사라지는 것들', tag: '신규 능력', test: 'T3 · T4', brief: '벽은 더 이상 벽이 아니다.' },
  { file: 'c6-combat', name: '반응하는 것들', tag: '전투', test: 'T4', brief: '"어떻게 죽이지?" 보다 "무엇에 반응하지?"' },
  { file: 'c7-boss', name: '낙하를 잊은 자', tag: '보스', test: 'T3 · T5', brief: '몸의 일부가 떨어지는 법을 잊었다.' },
  { file: 'c8-sandbox', name: '자유 실험장', tag: '샌드박스', test: '전 항목', brief: '목표 없음. 10분 동안 무엇을 만들어내는가.' },
];

const TESTS = [
  ['T1', '무게 능력만으로 재미있는가'],
  ['T2', '관성 능력만으로 재미있는가'],
  ['T3', '두 능력을 조합했을 때 예상 못한 행동이 나오는가'],
  ['T4', '정답을 몰라도 실험하면서 해결할 수 있는가'],
  ['T5', '능력 발동 순간의 타격감이 충분히 강한가'],
];

const STORE = 'aetherZ3D';

function loadRecord() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null') || { chambers: {}, ratings: {}, note: '' }; }
  catch { return { chambers: {}, ratings: {}, note: '' }; }
}
function saveRecord(r) {
  try { localStorage.setItem(STORE, JSON.stringify(r)); } catch { /* 시크릿 모드 */ }
}

export function startHud(game, { onLoadChamber }) {
  const el = (id) => document.getElementById(id);
  let record = loadRecord();
  let index = 0;

  /* ── 챔버 목록 ── */
  function buildMenu() {
    const list = el('chamberList');
    list.innerHTML = '';
    CHAMBERS.forEach((c, i) => {
      const done = record.chambers[c.file];
      const b = document.createElement('button');
      b.className = 'chamber' + (done ? ' done' : '');
      b.innerHTML = `
        <div class="ci">${i === 7 ? '∞' : i + 1}</div>
        <div class="cb">
          <div class="cn">${c.name}<span class="cc">${c.tag}</span></div>
          <div class="cd">${c.brief}</div>
          <div class="ct">검증 ${c.test}</div>
        </div>
        <div class="cs">${done ? `✓ ${done.best.toFixed(1)}s` : ''}</div>`;
      b.onclick = () => { hide('menu'); index = i; onLoadChamber(c.file); };
      list.appendChild(b);
    });
  }

  const show = (id) => el(id).classList.remove('hidden');
  const hide = (id) => el(id).classList.add('hidden');

  el('btnStart').onclick = () => { hide('menu'); index = 0; onLoadChamber(CHAMBERS[0].file); };
  el('btnSelect').onclick = () => { el('menuMain').classList.add('hidden'); el('menuSelect').classList.remove('hidden'); buildMenu(); };
  el('btnBack').onclick = () => { el('menuSelect').classList.add('hidden'); el('menuMain').classList.remove('hidden'); };
  el('btnReport').onclick = () => openReport();
  el('btnReport2').onclick = () => openReport();
  el('btnMenu').onclick = () => { show('menu'); el('menuMain').classList.remove('hidden'); el('menuSelect').classList.add('hidden'); };
  el('btnRestart').onclick = () => onLoadChamber(CHAMBERS[index].file);
  el('btnCloseReport').onclick = () => hide('report');
  el('btnNext').onclick = () => {
    hide('clearCard');
    if (index + 1 < CHAMBERS.length) { index++; onLoadChamber(CHAMBERS[index].file); }
    else openReport();
  };
  el('btnRetry').onclick = () => { hide('clearCard'); onLoadChamber(CHAMBERS[index].file); };
  el('btnToList').onclick = () => { hide('clearCard'); show('menu'); el('menuMain').classList.add('hidden'); el('menuSelect').classList.remove('hidden'); buildMenu(); };
  el('btnCopy').onclick = copyReport;
  el('btnReset').onclick = () => {
    if (!confirm('검증 기록을 모두 지웁니다.')) return;
    record = { chambers: {}, ratings: {}, note: '' };
    saveRecord(record);
    openReport();
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { show('menu'); el('menuMain').classList.remove('hidden'); }
    if (e.code === 'KeyH') cycleHint();
    if (e.code === 'Backspace') onLoadChamber(CHAMBERS[index].file);
  });

  /* ── 챔버 클리어 ── */
  let hintIndex = 0;
  function cycleHint() {
    const hud = currentHud();
    if (!hud?.hints?.length) return;
    const box = el('hintBox');
    box.textContent = '💡 ' + hud.hints[hintIndex % hud.hints.length];
    hintIndex++;
    box.classList.remove('hidden');
    clearTimeout(box.__t);
    box.__t = setTimeout(() => box.classList.add('hidden'), 8000);
  }

  function currentHud() {
    const world = game.world;
    return world ? hudState(world) : null;
  }

  function onChamberClear(payload) {
    const c = CHAMBERS[index];
    const prev = record.chambers[c.file];
    const time = payload.elapsed;
    record.chambers[c.file] = {
      best: prev ? Math.min(prev.best, time) : time,
      last: time,
      deaths: (prev?.deaths ?? 0) + payload.deaths,
      tries: (prev?.tries ?? 0) + 1,
      uses: mergeUses(prev?.uses ?? {}, payload.uses),
    };
    saveRecord(record);

    const uses = Object.entries(payload.uses).map(([k, n]) => {
      const series = SERIES[k.replace(/\d$/, '')];
      const slot = Number(k.slice(-1));
      return series ? `${series.name}·${series.acts[slot]} ×${n}` : `${k} ×${n}`;
    });
    el('clearBody').innerHTML = `
      <div class="row"><span>클리어 시간</span><b>${time.toFixed(1)}초</b></div>
      <div class="row"><span>사망</span><b>${payload.deaths}</b></div>
      <div class="row"><span>최대 충격량</span><b>${Math.round(currentHud()?.lastImpact ?? 0)}</b></div>
      <div class="row"><span>사용한 능력</span><b>${uses.length ? uses.join(', ') : '없음 — 능력 없이 통과했다'}</b></div>
      <p class="note">${CHAMBERS[index].test} · ${currentHud()?.test ?? ''}</p>`;
    el('btnNext').textContent = index + 1 < CHAMBERS.length ? '다음 챔버 →' : '검증 리포트 →';
    show('clearCard');
  }

  function mergeUses(a, b) {
    const out = { ...a };
    for (const k in b) out[k] = (out[k] || 0) + b[k];
    return out;
  }

  /* ── 리포트 ── */
  function totals() {
    const uses = {};
    let cleared = 0, time = 0, deaths = 0;
    for (const c of CHAMBERS) {
      const r = record.chambers[c.file];
      if (!r) continue;
      cleared++;
      time += r.last;
      deaths += r.deaths;
      for (const k in r.uses) uses[k] = (uses[k] || 0) + r.uses[k];
    }
    return { uses, cleared, time, deaths };
  }

  function openReport() {
    const { uses, cleared, time, deaths } = totals();
    const sum = (p) => Object.keys(uses).filter((k) => k.startsWith(p)).reduce((a, k) => a + uses[k], 0);
    const w = sum('weight'), i = sum('inertia'), p = sum('phase');
    const all = w + i + p;
    const bar = (label, v, color) => {
      const pct = all ? Math.round((v / all) * 100) : 0;
      return `<div class="mbar"><span>${label}</span><div class="mtrack"><i style="width:${pct}%;background:${color}"></i></div><b>${v}회 (${pct}%)</b></div>`;
    };
    const rows = CHAMBERS.map((c) => {
      const r = record.chambers[c.file];
      return `<tr><td>${c.name}</td><td>${r ? '✓' : '—'}</td><td>${r ? r.best.toFixed(1) + 's' : '—'}</td>
              <td>${r?.tries ?? 0}</td><td>${r?.deaths ?? 0}</td></tr>`;
    }).join('');
    const rates = TESTS.map(([k, t]) => `
      <div class="rate"><div class="rl"><b>${k}</b> ${t}</div>
      <div class="rr" data-k="${k}">${[1, 2, 3, 4, 5].map((n) =>
      `<button class="${record.ratings[k] === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div>`).join('');

    el('reportBody').innerHTML = `
      <div class="rsec">
        <h3>자동 계측</h3>
        <div class="rgrid">
          <div class="stat"><b>${cleared}/${CHAMBERS.length}</b><span>클리어한 챔버</span></div>
          <div class="stat"><b>${Math.round(time / 60)}분</b><span>클리어 소요 합계</span></div>
          <div class="stat"><b>${all}</b><span>능력 발동 횟수</span></div>
          <div class="stat"><b>${deaths}</b><span>사망</span></div>
        </div>
        ${bar('무게', w, SERIES.weight.color)}
        ${bar('관성', i, SERIES.inertia.color)}
        ${bar('위상', p, SERIES.phase.color)}
        <p class="hintline">세 계열의 사용 비율이 크게 치우친다면, 그 능력은 아직 "쓸 이유"가 부족하다는 뜻이다.</p>
      </div>
      <div class="rsec">
        <h3>챔버별 기록</h3>
        <table class="rtable"><thead><tr><th>챔버</th><th>클리어</th><th>최고</th><th>시도</th><th>사망</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
      <div class="rsec">
        <h3>직접 평가 (1~5)</h3>
        ${rates}
        <textarea id="valNote" placeholder="예상하지 못했던 플레이 / 짜증났던 부분 / Unity로 옮길 때 살려야 할 것">${record.note || ''}</textarea>
      </div>`;

    el('reportBody').querySelectorAll('.rr').forEach((row) => {
      row.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          record.ratings[row.dataset.k] = Number(b.dataset.v);
          saveRecord(record);
          row.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
        };
      });
    });
    const note = el('valNote');
    note.oninput = () => { record.note = note.value; saveRecord(record); };
    show('report');
  }

  function copyReport() {
    const { uses, cleared, deaths } = totals();
    let out = '# 《에테르 Z+》 3D 프로토타입 검증 리포트\n\n';
    out += `생성일: ${new Date().toLocaleString('ko-KR')}\n엔진: SJL Engine\n\n## 챔버\n\n`;
    out += '| 챔버 | 클리어 | 최고기록 | 시도 | 사망 |\n|---|---|---|---|---|\n';
    for (const c of CHAMBERS) {
      const r = record.chambers[c.file];
      out += `| ${c.name} | ${r ? 'O' : 'X'} | ${r ? r.best.toFixed(1) + 's' : '-'} | ${r?.tries ?? 0} | ${r?.deaths ?? 0} |\n`;
    }
    out += `\n총 ${cleared}/${CHAMBERS.length} 클리어, 사망 ${deaths}회\n\n## 능력 사용\n\n`;
    for (const k in uses) {
      const s = SERIES[k.replace(/\d$/, '')];
      const slot = Number(k.slice(-1));
      out += `- ${s ? `${s.name} / ${s.acts[slot]}` : k} : ${uses[k]}회\n`;
    }
    out += '\n## 5대 검증 항목\n\n';
    for (const [k, t] of TESTS) out += `- ${k} ${t} : ${record.ratings[k] ?? '-'} / 5\n`;
    out += `\n## 메모\n\n${record.note || '-'}\n`;

    navigator.clipboard?.writeText(out).then(
      () => toast('리포트가 클립보드에 복사되었습니다'),
      () => { const w = window.open('', '_blank'); if (w) w.document.write(`<pre>${out.replace(/</g, '&lt;')}</pre>`); },
    );
  }

  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t.__t);
    t.__t = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  /* ── 매 프레임 갱신 ── */
  const seriesRow = el('seriesRow');
  const actRow = el('actRow');

  function frame() {
    const hud = currentHud();
    if (hud) draw(hud);
    requestAnimationFrame(frame);
  }

  let lastSeries = null, lastAvail = '';
  function draw(hud) {
    el('chName').textContent = hud.chamber || '';
    el('chObj').textContent = hud.objective || '';
    el('hpFill').style.width = `${Math.max(0, (hud.hp / hud.maxHp) * 100)}%`;

    const avail = (hud.available || []).join(',');
    if (avail !== lastAvail || hud.series !== lastSeries) {
      lastAvail = avail; lastSeries = hud.series;
      seriesRow.innerHTML = (hud.available || []).map((k) => {
        const s = SERIES[k];
        return `<div class="sr ${hud.series === k ? 'on' : ''}" style="--c:${s.color}">
          <div class="sk">Z+${s.key}</div><div class="sn">${s.name}</div></div>`;
      }).join('');
      const s = SERIES[hud.series];
      actRow.innerHTML = s ? s.acts.map((a, i) => a === '—' ? '' :
        `<div class="ac" style="--c:${s.color}"><b>${['좌클릭', '우클릭', 'E', 'Shift'][i]}</b><span>${a}</span></div>`).join('') : '';
    }
    actRow.classList.toggle('show', !!hud.lawMode);
    el('crosshair').classList.toggle('active', !!hud.lawMode);
    document.body.classList.toggle('lawmode', !!hud.lawMode);

    const info = hud.targetInfo;
    const tgt = el('targetBox');
    if (hud.lawMode && info) {
      tgt.classList.remove('hidden');
      tgt.style.setProperty('--c', SERIES[hud.series]?.color ?? '#fff');
      tgt.innerHTML = `<b>${info.label}</b>
        <span>${info.mass}kg · ${info.speed}m/s</span>
        ${info.weight > 0 ? '<i class="w">무거움</i>' : ''}
        ${info.weight < 0 ? '<i class="l">가벼움</i>' : ''}
        ${info.phased ? '<i class="p">위상화</i>' : ''}`;
    } else tgt.classList.add('hidden');

    const tags = [];
    if (hud.stored) tags.push(`<div class="tag" style="--c:${SERIES.inertia.color}">관성 저장됨 ${hud.stored.toFixed(1)}</div>`);
    if (hud.marked) tags.push(`<div class="tag" style="--c:${SERIES.weight.color}">이동 대상 지정됨</div>`);
    if (hud.selfWeight) tags.push(`<div class="tag" style="--c:${SERIES.weight.color}">자기 무게 ↑</div>`);
    if (hud.selfInertia > 0) tags.push(`<div class="tag" style="--c:${SERIES.inertia.color}">자기 관성 ${hud.selfInertia.toFixed(1)}s</div>`);
    if (hud.bossHp >= 0) {
      tags.push(`<div class="tag" style="--c:${hud.bossVuln ? '#7dffb0' : '#ff4d6d'}">보스 ${Math.round(hud.bossHp * 100)}% · 방어 ${hud.bossArmor}</div>`);
    }
    el('statBox').innerHTML = `${tags.join('')}<div class="mono">${hud.elapsed.toFixed(1)}s · 최근 충격량 ${Math.round(hud.lastImpact)}</div>`;

    const msg = el('toast');
    if (hud.messageTimer > 0 && hud.message) {
      msg.textContent = hud.message;
      msg.classList.remove('hidden');
    } else if (!msg.__t) msg.classList.add('hidden');
  }

  requestAnimationFrame(frame);

  let unbind = null;
  return {
    bindWorld(world) {
      hintIndex = 0;
      unbind?.();                         // 챔버를 옮길 때 이전 구독을 끊는다
      unbind = world.events.on('chamber:clear', onChamberClear);
      setTimeout(cycleHint, 900);
    },
    buildMenu,
  };
}
