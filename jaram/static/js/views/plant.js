import { api } from '../api.js';
import {
  h, icons, topbar, statusBadge, fmt, signed, deltaEl, areaUnit, dateLong, dateShort, timeShort, daysText,
  segmented, chips, skeleton, toast, confirmSheet, parseDate,
} from '../ui.js';
import { lineChart, sparkline } from '../chart.js';
import { careSheet, envSheet, actionSheet, careIcon } from '../sheets.js';

export async function plantView({ id }) {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '' }), skeleton(420, 8), skeleton(140), skeleton(180));
  const [plant, settings] = await Promise.all([api.plant(id), api.settings()]);
  const ui = { photoMode: 'photo', compareBase: 'prev', compareMode: 'photo', metric: 'area' };
  render(plant);

  function rerender(p) { render(p); }

  async function reload() { render(await api.plant(id)); }

  function render(p) {
    const th = settings.thresholds.species[p.species] || settings.thresholds.species.other;
    const ms = p.measurements;
    const latest = ms[ms.length - 1];
    const unit = p.unit;
    const content = [];

    content.push(topbar({
      title: p.name,
      right: h('button', { class: 'icon-btn', 'aria-label': '더보기', html: icons.more, onclick: () => moreMenu(p) }),
    }));

    if (!latest) {
      content.push(h('div', { class: 'empty' },
        h('div', { class: 'art', html: icons.camera }),
        h('h2', null, '첫 사진을 찍어 주세요'),
        h('p', null, '첫 사진이 기준이 돼요. 화분 옆에 자를 세워 두고 매번 같은 위치에서 찍으면 cm 단위로 정확하게 비교할 수 있어요.')));
    } else {
      content.push(hero(p, latest));
      content.push(statusCard(p));
      if (unit === 'px') {
        content.push(h('a', { class: 'notice accent', href: `#/plant/${p.id}/calibrate`, style: { marginTop: '12px' } },
          h('span', { html: icons.ruler, style: { display: 'contents' } }),
          h('span', { class: 'grow' }, h('b', null, '자로 크기 보정하기'), h('br'), '사진 속 자를 두 번 탭하면 높이·폭을 cm 단위로 볼 수 있어요.'),
          h('span', { html: icons.chevron, style: { display: 'contents' } })));
      }
      content.push(h('h2', { class: 'section-title' }, '생육 지표', h('small', null, `${dateShort(latest.taken_at)} 기준`)));
      content.push(statsGrid(p, latest));
      if (ms.length >= 2) {
        content.push(h('h2', { class: 'section-title' }, '사진 비교'));
        content.push(compareCard(p));
        content.push(h('h2', { class: 'section-title' }, '생장 그래프'));
        content.push(chartCard(p));
      }
    }
    content.push(h('h2', { class: 'section-title' }, '환경',
      h('button', { class: 'section-link', onclick: async () => { const u = await envSheet(p, lastEnv(p)); if (u) rerender(u); } }, '기록하기')));
    content.push(envCard(p, th));
    content.push(h('h2', { class: 'section-title' }, '기록', h('small', null, `사진 ${ms.length}장 · 관리 ${p.care_logs.length}회`)));
    content.push(timeline(p));

    content.push(h('div', { class: 'cta' }, h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-secondary', style: { flex: '0 0 38%' }, onclick: async () => { const u = await careSheet(p); if (u) rerender(u); } }, '관리 기록'),
      h('a', { class: 'btn btn-primary', href: `#/plant/${p.id}/capture` }, h('span', { html: icons.camera, style: { display: 'contents' } }), '사진 찍기'))));

    screen.replaceChildren(...content);
  }

  // ------------------------------------------------------------ 큰 사진
  function hero(p, latest) {
    const img = h('img', { src: latest.photo_url, alt: `${p.name} 최근 사진` });
    const wrap = h('div', { class: 'hero' }, img,
      h('div', { class: 'hero-seg' }, segmented([['photo', '사진'], ['overlay', '분석']], ui.photoMode, (v) => {
        ui.photoMode = v;
        img.src = v === 'overlay' ? latest.overlay_url : latest.photo_url;
      }, 'glass-seg')),
      h('div', { class: 'hero-meta' }, `${p.count}번째 기록 · ${dateShort(latest.taken_at)}`));
    if (ui.photoMode === 'overlay') img.src = latest.overlay_url;
    return h('div', { style: { marginTop: '4px' } }, wrap);
  }

  // ------------------------------------------------------------ 상태·추천
  function statusCard(p) {
    const [first, ...rest] = p.recs;
    const card = h('section', { class: 'card status-card', style: { marginTop: '12px' }, 'aria-label': '상태와 추천' },
      h('div', { class: 'status-head' }, statusBadge(p.status, p.status_label),
        h('span', { class: 'caption' }, '규칙 기반 추천')),
      recBlock(p, first, true),
      rest.map((r) => recBlock(p, r, false)));
    return card;
  }

  function recBlock(p, r, primary) {
    return h('div', { class: 'rec' },
      primary ? h('h2', { class: 'status-title' }, r.title)
        : h('h3', { class: 'rec-title' }, statusBadge(r.level === 'info' ? 'info' : r.level, r.level === 'care' ? '관리' : r.level === 'observe' ? '관찰' : r.level === 'good' ? '정상' : '참고'), r.title),
      h('p', { class: 'status-body' }, r.body),
      r.reasons.length ? h('details', { class: 'why' },
        h('summary', null, '왜 이렇게 판단했나요?', h('span', { html: icons.chevronDown, style: { display: 'contents' } })),
        h('ul', null, r.reasons.map((x) => h('li', null, x)))) : null,
      r.action ? h('button', {
        class: 'btn btn-soft btn-md', style: { marginTop: '14px' },
        onclick: async () => { const u = await careSheet(p, { kind: r.action.kind, recCode: r.code }); if (u) rerender(u); },
      }, h('span', { html: r.action.kind === 'water' ? icons.drop : icons.sun, style: { display: 'contents' } }), r.action.label) : null);
  }

  // ------------------------------------------------------------ 지표
  function statsGrid(p, m) {
    const d = m.delta;
    const unit = p.unit;
    const rate = p.summary?.recent?.area?.pct_per_day;
    const prevRate = p.summary?.previous?.area?.pct_per_day;
    const stat = (label, value, u, deltaNode) => h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, value, h('small', null, u)),
      h('div', { class: 'stat-delta' }, deltaNode));
    const vsPrev = (v, digits, suffix) => d ? h('span', null, deltaEl(v, { digits, suffix }), h('span', { class: 'muted' }, ' 지난 기록 대비')) : h('span', { class: 'muted' }, '기준 사진');
    return h('div', { class: 'stats' },
      stat('높이', fmt(m.height, unit === 'cm' ? 1 : 0), unit, vsPrev(d?.height, unit === 'cm' ? 1 : 0, unit)),
      stat('폭', fmt(m.width, unit === 'cm' ? 1 : 0), unit, vsPrev(d?.width, unit === 'cm' ? 1 : 0, unit)),
      stat('투영 면적', fmt(m.area, unit === 'cm' ? 1 : 0), areaUnit(unit), vsPrev(d?.area_pct, 1, '%')),
      stat('생장률', rate === null || rate === undefined ? '–' : signed(rate), rate === null || rate === undefined ? '' : '%/일',
        prevRate !== null && prevRate !== undefined
          ? h('span', null, h('span', { class: 'muted' }, '이전 '), `${signed(prevRate)}%/일`)
          : h('span', { class: 'muted' }, '면적 기준 최근 생장률')));
  }

  // ------------------------------------------------------------ 비교
  function compareCard(p) {
    const ms = p.measurements;
    const latest = ms[ms.length - 1];
    const weekAgo = [...ms].reverse().find((m) => (parseDate(latest.taken_at) - parseDate(m.taken_at)) / 86400000 >= 6.5);
    const bases = [['prev', '지난 기록'], ['first', '첫 기록']];
    if (weekAgo && weekAgo.id !== ms[0].id && weekAgo.id !== ms[ms.length - 2].id) bases.splice(1, 0, ['week', '1주 전']);
    const card = h('section', { class: 'card' });
    const body = h('div');
    const draw = () => {
      const base = ui.compareBase === 'first' ? ms[0] : ui.compareBase === 'week' && weekAgo ? weekAgo : ms[ms.length - 2];
      body.replaceChildren(slider(base, latest, ui.compareMode), compareStats(p, base, latest));
    };
    card.append(
      chips(bases, ui.compareBase, (v) => { ui.compareBase = v; draw(); }, 'chips in-card'),
      h('div', { style: { height: '12px' } }),
      body,
      h('div', { style: { height: '12px' } }),
      segmented([['photo', '사진으로 보기'], ['overlay', '분석 영역으로 보기']], ui.compareMode, (v) => { ui.compareMode = v; draw(); }));
    draw();
    return card;
  }

  function slider(before, after, mode) {
    const src = (m) => (mode === 'overlay' ? m.overlay_url : m.photo_url);
    const el = h('div', { class: 'compare', style: { '--pos': '50%' }, role: 'slider', tabindex: '0', 'aria-label': '이전 사진과 최근 사진 비교', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50' },
      h('img', { src: src(before), alt: `${dateShort(before.taken_at)} 사진` }),
      h('img', { class: 'after', src: src(after), alt: `${dateShort(after.taken_at)} 사진` }),
      h('div', { class: 'handle' }, h('div', { class: 'knob', html: icons.swap })),
      h('span', { class: 'label l' }, dateShort(before.taken_at)),
      h('span', { class: 'label r' }, dateShort(after.taken_at)));
    let dragging = false;
    const set = (pct) => {
      pct = Math.max(0, Math.min(100, pct));
      el.style.setProperty('--pos', pct + '%');
      el.setAttribute('aria-valuenow', String(Math.round(pct)));
    };
    const fromEvent = (e) => { const r = el.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100); };
    el.addEventListener('pointerdown', (e) => { dragging = true; el.setPointerCapture(e.pointerId); fromEvent(e); });
    el.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
    el.addEventListener('keydown', (e) => {
      const now = Number(el.getAttribute('aria-valuenow'));
      if (e.key === 'ArrowLeft') set(now - 5);
      if (e.key === 'ArrowRight') set(now + 5);
    });
    return el;
  }

  function compareStats(p, a, b) {
    const days = (parseDate(b.taken_at) - parseDate(a.taken_at)) / 86400000;
    const pct = a.area ? (b.area / a.area - 1) * 100 : null;
    const digits = p.unit === 'cm' ? 1 : 0;
    return h('div', { class: 'compare-stats' },
      h('div', null, h('div', { class: 'k' }, '기간'), h('div', { class: 'v' }, daysText(days))),
      h('div', null, h('div', { class: 'k' }, '높이'), h('div', { class: 'v' }, deltaEl(b.height - a.height, { digits, suffix: p.unit }))),
      h('div', null, h('div', { class: 'k' }, '투영 면적'), h('div', { class: 'v' }, deltaEl(pct, { suffix: '%' }))));
  }

  // ------------------------------------------------------------ 그래프
  function chartCard(p) {
    const ms = p.measurements;
    const t0 = parseDate(ms[0].taken_at).getTime();
    const dayOf = (m) => (parseDate(m.taken_at).getTime() - t0) / 86400000;
    const dateOf = (x) => new Date(t0 + x * 86400000);
    const u = p.unit;
    const defs = {
      area: { label: '투영 면적', y: (m) => m.area, f: (v) => fmt(v, u === 'cm' ? 1 : 0) + (u === 'cm' ? 'cm²' : ''), zero: false },
      height: { label: '높이', y: (m) => m.height, f: (v) => fmt(v, u === 'cm' ? 1 : 0) + (u === 'cm' ? 'cm' : ''), zero: false },
      width: { label: '폭', y: (m) => m.width, f: (v) => fmt(v, u === 'cm' ? 1 : 0) + (u === 'cm' ? 'cm' : ''), zero: false },
      rate: { label: '생장률', y: (m) => m.delta?.area_pct_per_day ?? null, f: (v) => signed(v) + '%', zero: true },
    };
    const card = h('section', { class: 'card' });
    const box = h('div', { style: { marginTop: '16px' } });
    const note = h('p', { class: 'caption', style: { margin: '8px 0 0' } });
    const draw = () => {
      const d = defs[ui.metric];
      box.replaceChildren(lineChart({
        series: [{ name: d.label, color: 'var(--chart-line)', points: ms.map((m) => ({ x: dayOf(m), y: d.y(m) })) }],
        xTick: (x) => dateShort(dateOf(x)),
        tipTitle: (x) => dateLong(dateOf(x)),
        yFormat: d.f,
        yZero: d.zero,
        height: 200,
        ariaLabel: `${p.name} ${d.label} 변화 그래프`,
        tableHead: '날짜',
      }));
      note.textContent = ui.metric === 'rate'
        ? '생장률 = (이번 면적 − 지난 면적) ÷ 지난 면적 ÷ 기간(일). 0%보다 낮으면 면적이 줄어든 거예요.'
        : u === 'px' ? '크기 보정 전이라 픽셀 단위예요. 같은 위치에서 찍은 사진끼리 비교해 주세요.' : '';
      note.hidden = !note.textContent;
    };
    card.append(segmented([['area', '면적'], ['height', '높이'], ['width', '폭'], ['rate', '생장률']], ui.metric, (v) => { ui.metric = v; draw(); }), box, note);
    draw();
    return card;
  }

  // ------------------------------------------------------------ 환경
  function lastEnv(p) {
    const out = {};
    for (const k of ['temp', 'humidity', 'soil', 'lux']) {
      const e = [...p.env_logs].reverse().find((x) => x[k] !== null && x[k] !== undefined);
      if (e) out[k] = e[k];
    }
    return out;
  }

  function envCard(p, th) {
    const defs = [
      ['temp', '온도', '℃', 'temp', th.temp_min, th.temp_max, 1],
      ['humidity', '습도', '%', 'humidity', th.humidity_min, th.humidity_max, 0],
      ['soil', '토양 수분', '%', 'soil', th.soil_min, th.soil_max, 0],
      ['lux', '조도', 'lux', 'sun', th.lux_min, null, 0],
    ];
    if (!p.env_logs.length) {
      return h('div', { class: 'card' },
        h('p', { class: 'card-sub', style: { marginBottom: '14px' } }, '아직 환경 기록이 없어요. 생육 변화와 환경을 함께 보면 원인을 더 정확하게 찾을 수 있어요.'),
        h('button', { class: 'btn btn-secondary btn-md', onclick: async () => { const u = await envSheet(p); if (u) rerender(u); } }, '환경 기록하기'));
    }
    const tiles = defs.map(([k, label, unit, ic, lo, hi, digits]) => {
      const vals = p.env_logs.map((e) => e[k]).filter((v) => v !== null && v !== undefined);
      const last = vals[vals.length - 1];
      let range;
      if (last === undefined) range = h('div', { class: 'range muted' }, '기록 없음');
      else if (lo !== null && last < lo) range = h('div', { class: 'range out' }, `▼ 기준 ${fmt(lo, 0)}${unit === 'lux' ? '' : unit} 미만`);
      else if (hi !== null && last > hi) range = h('div', { class: 'range out' }, `▲ 기준 ${fmt(hi, 0)}${unit} 초과`);
      else range = h('div', { class: 'range in' }, '✓ 기준 범위 안');
      return h('div', { class: 'env-tile' },
        h('div', { class: 'k' }, h('span', { html: icons[ic], style: { display: 'contents' } }), label),
        h('div', { class: 'v' }, last === undefined ? '–' : fmt(last, digits), last === undefined ? null : h('small', null, unit)),
        range,
        sparkline(vals.slice(-10)));
    });
    return h('div', { class: 'card' }, h('div', { class: 'env-grid' }, tiles),
      h('p', { class: 'caption', style: { margin: '12px 0 0' } }, `${p.species_label} 기준값은 설정 > 추천 기준에서 바꿀 수 있어요.`));
  }

  // ------------------------------------------------------------ 기록 타임라인
  function timeline(p) {
    const items = [
      ...p.measurements.map((m) => ({ t: m.taken_at, type: 'm', m })),
      ...p.care_logs.map((c) => ({ t: c.at, type: 'c', c })),
      ...p.env_logs.filter((e) => !e.measurement_id).map((e) => ({ t: e.at, type: 'e', e })),
    ].sort((a, b) => (a.t < b.t ? 1 : -1));
    if (!items.length) return h('div', { class: 'card' }, h('p', { class: 'card-sub' }, '아직 기록이 없어요.'));
    const wrap = h('div');
    let limit = 12;
    const draw = () => {
      wrap.replaceChildren();
      let day = null;
      let list = null;
      items.slice(0, limit).forEach((it) => {
        const d = it.t.slice(0, 10);
        if (d !== day) {
          day = d;
          wrap.append(h('div', { class: 'timeline-day' }, dateLong(it.t)));
          list = h('div', { class: 'list' });
          wrap.append(list);
        }
        list.append(row(it));
      });
      if (items.length > limit) {
        wrap.append(h('button', { class: 'btn btn-text', style: { width: '100%', marginTop: '8px' }, onclick: () => { limit += 20; draw(); } }, `이전 기록 더 보기 (${items.length - limit})`));
      }
    };
    const row = (it) => {
      if (it.type === 'm') {
        const m = it.m;
        const pct = m.delta?.area_pct;
        return h('a', { class: 'list-item', href: `#/m/${m.id}` },
          h('img', { class: 'tl-photo', src: m.photo_url, alt: '', loading: 'lazy' }),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, '사진 기록'),
            h('div', { class: 'meta' }, timeShort(m.taken_at), ' · 면적 ', pct === null || pct === undefined ? '기준' : deltaEl(pct, { suffix: '%' }),
              m.env ? ` · ${[m.env.temp !== null ? fmt(m.env.temp) + '℃' : null, m.env.soil !== null ? '토양 ' + fmt(m.env.soil, 0) + '%' : null].filter(Boolean).join(' · ')}` : '')),
          h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } }));
      }
      if (it.type === 'c') {
        const c = it.c;
        const amount = c.amount ? ` ${fmt(c.amount, 0)}${c.kind === 'water' ? 'ml' : c.kind === 'light' ? '시간' : ''}` : '';
        return h('button', { class: 'list-item', type: 'button', onclick: () => removeLog('관리 기록', () => api.deleteCare(c.id)) },
          h('div', { class: 'list-icon accent', html: icons[careIcon(c.kind)] }),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, c.kind_label + amount),
            h('div', { class: 'meta' }, timeShort(c.at), c.rec_code ? ' · 추천을 따라 한 관리' : '', c.note ? ` · ${c.note}` : '')));
      }
      const e = it.e;
      const parts = [
        e.temp !== null ? `${fmt(e.temp)}℃` : null, e.humidity !== null ? `습도 ${fmt(e.humidity, 0)}%` : null,
        e.soil !== null ? `토양 ${fmt(e.soil, 0)}%` : null, e.lux !== null ? `${fmt(e.lux, 0)} lux` : null,
      ].filter(Boolean);
      return h('button', { class: 'list-item', type: 'button', onclick: () => removeLog('환경 기록', () => api.deleteEnv(e.id)) },
        h('div', { class: 'list-icon', html: icons.temp }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, '환경 기록'), h('div', { class: 'meta' }, `${timeShort(e.at)} · ${parts.join(' · ')}`)));
    };
    draw();
    return wrap;
  }

  async function removeLog(label, fn) {
    const ok = await confirmSheet({ title: `${label}을 지울까요?`, desc: '지운 기록은 되돌릴 수 없어요.', ok: '지우기', danger: true });
    if (!ok) return;
    await fn();
    toast('기록을 지웠어요');
    reload();
  }

  // ------------------------------------------------------------ 더보기
  function moreMenu(p) {
    actionSheet(p.name, [
      { icon: 'note', label: '이름·종류 수정', onClick: () => { location.hash = `#/plant/${p.id}/edit`; } },
      { icon: 'crop', label: '분석 영역 지정', desc: p.roi ? '지정됨 · 영역 밖 초록색은 분석에서 빠져요' : '옆 화분 잎이 함께 찍힐 때 사용', onClick: () => { location.hash = `#/plant/${p.id}/roi`; } },
      { icon: 'ruler', label: '크기 보정 (자)', desc: p.cm_per_px ? `보정됨 · 1cm = ${fmt(1 / p.cm_per_px, 1)}px` : '사진 속 자로 cm 단위 환산', onClick: () => { location.hash = `#/plant/${p.id}/calibrate`; } },
      { icon: 'temp', label: '환경 기록', onClick: async () => { const u = await envSheet(p, lastEnv(p)); if (u) rerender(u); } },
      { icon: 'refresh', label: '모든 사진 다시 분석', desc: '설정에서 색상(HSV) 범위를 바꿨을 때', onClick: async () => {
        toast('다시 분석하는 중이에요…');
        const r = await api.reanalyze(p.id);
        toast(`${r.ok}장을 다시 분석했어요${r.failed ? ` (${r.failed}장 실패)` : ''}`);
        reload();
      } },
      { icon: 'trash', label: '식물 삭제', danger: true, onClick: async () => {
        const ok = await confirmSheet({ title: `${p.name}을(를) 삭제할까요?`, desc: '사진과 모든 기록이 함께 지워지고 되돌릴 수 없어요.', ok: '삭제', danger: true });
        if (!ok) return;
        await api.deletePlant(p.id);
        toast('식물을 삭제했어요');
        location.hash = '#/';
      } },
    ]);
  }
}
