import { api } from '../api.js';
import {
  h, icons, topbar, statusBadge, fmt, signed, deltaEl, areaUnit, dateLong, dateShort, timeShort, daysText,
  segmented, chips, skeleton, toast, confirmSheet, parseDate, friendlyError, progressSheet, relDays, dayKey, fromDayKey,
} from '../ui.js';
import { lineChart, sparkline } from '../chart.js';
import { careSheet, envSheet, observeSheet, actionSheet, careIcon, signLabel, soilLabel } from '../sheets.js';
import { dayStrip, dayRange } from '../dayStrip.js';

// 급수 기록표 아래 종류별 한 줄 안내 (농촌진흥청·농사로 재배 자료)
const WATER_TIPS = {
  basil: '바질은 과습에 약해요. 흙 표면이 마른 걸 확인하고 흙 전체가 젖도록 준 뒤, 받침에 고인 물은 버려 주세요.',
  lettuce: '상추는 물이 부족하면 잎이 시들어요. 흙이 지나치게 마르지 않게 하되, 흙이 젖어 있을 때는 주지 마세요.',
  other: '정해진 날짜보다 흙 상태가 중요해요. 흙 표면이 마르면 흙 전체가 젖도록 주고, 받침에 고인 물은 버려 주세요.',
};
import { lazyViewer } from '../viewer3d.js';
import { volumeUnit } from './scanResult.js';

export async function plantView({ id }) {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '' }), skeleton(420, 8), skeleton(140), skeleton(180));
  const [plant, settings] = await Promise.all([api.plant(id), api.settings()]);
  const ui = {
    photoMode: 'photo', compareBase: 'prev', compareMode: 'photo', metric: 'area',
    showTemp: false, showHum: false, waterDay: null, envDay: null,
  };
  render(plant);

  // 다른 화면으로 이동한 뒤에 늦게 도착한 결과로 다시 그리지 않도록 screen 이 아직 화면에 있는지 확인
  function rerender(p) { if (p && screen.isConnected) render(p); }

  async function reload() {
    try {
      const p = await api.plant(id);
      rerender(p);
    } catch (err) {
      if (screen.isConnected && err.status !== 401) toast(friendlyError(err), { error: true });
    }
  }

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
      // 넓은 화면에서는 사진 | 상태·추천을 나란히 (휴대폰에서는 위아래)
      content.push(h('div', { class: 'split' },
        hero(p, latest),
        h('div', { class: 'split-side' },
          p.recs && p.recs.length ? statusCard(p) : null,
          unit === 'px' ? h('a', { class: 'notice accent', href: `#/plant/${p.id}/calibrate`, style: { marginTop: '12px' } },
            h('span', { html: icons.ruler, style: { display: 'contents' } }),
            h('span', { class: 'grow' }, h('b', null, '자로 크기 보정하기'), h('br'), '사진 속 자를 두 번 탭하면 높이·폭을 cm 단위로 볼 수 있어요.'),
            h('span', { html: icons.chevron, style: { display: 'contents' } })) : null)));
      content.push(h('h2', { class: 'section-title' }, '생육 지표', h('small', null, `${dateShort(latest.taken_at)} 기준`)));
      content.push(statsGrid(p, latest));
      if (ms.length >= 2) {
        content.push(h('h2', { class: 'section-title' }, '사진 비교'));
        content.push(compareCard(p));
        content.push(h('h2', { class: 'section-title' }, '생장 그래프'));
        content.push(chartCard(p));
      }
      content.push(h('h2', { class: 'section-title' }, '잎 색',
        p.facts?.leaf_color?.compared ? h('small', null, `${relDays(p.facts.leaf_color.base_from)} 사진과 비교`) : null));
      content.push(leafColorCard(p));
    }
    content.push(h('h2', { class: 'section-title' }, '급수 기록',
      h('button', { class: 'section-link', onclick: async () => { const u = await careSheet(p, { kind: 'water' }); if (u) rerender(u); } }, '물 줬어요')));
    content.push(waterCard(p));
    content.push(h('h2', { class: 'section-title' }, '3D 생장', p.scans.length ? h('small', null, `${p.scans.length}회 측정`) : null));
    content.push(scanCard(p));
    content.push(h('h2', { class: 'section-title' }, '환경',
      h('button', { class: 'section-link', onclick: async () => { const u = await envSheet(p, lastEnv(p)); if (u) rerender(u); } }, '기록하기')));
    content.push(envCard(p, th));
    content.push(h('h2', { class: 'section-title' }, '기록', h('small', null, `사진 ${ms.length}장 · 관리 ${p.care_logs.length}회 · 상태 ${p.observations.length}회`)));
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
    const card = h('section', { class: 'card status-card', 'aria-label': '상태와 추천' },
      h('div', { class: 'status-head' }, statusBadge(p.status, p.status_label),
        h('span', { class: 'caption' }, p.facts?.growth_source === '3d' ? '3D 부피 기준 추천' : '규칙 기반 추천')),
      p.facts?.rules?.error ? h('a', { class: 'notice warn', href: '#/settings/rules', style: { marginTop: '12px' } },
        h('span', { html: icons.warn, style: { display: 'contents' } }),
        h('span', { class: 'grow' }, '저장한 추천 규칙을 읽지 못해서 기본 규칙으로 판단했어요. 눌러서 확인해 주세요.')) : null,
      recBlock(p, first, true),
      rest.map((r) => recBlock(p, r, false)),
      h('div', { class: 'status-foot' },
        p.facts?.signs?.length
          ? h('p', { class: 'caption' }, `최근 기록한 특이사항: ${p.facts.signs.map(signLabel).join(', ')}`)
          : h('p', { class: 'caption' }, '시듦·웃자람처럼 눈에 띄는 점이나 흙 상태를 기록하면 추천이 더 정확해져요.'),
        h('button', { class: 'btn btn-secondary btn-md', type: 'button', onclick: () => openObserve(p) },
          h('span', { html: icons.leaf, style: { display: 'contents' } }), '식물 상태 기록')));
    return card;
  }

  async function openObserve(p, at) {
    const u = await observeSheet(p, { at });
    if (u) rerender(u);
  }

  // 일자 슬라이드표에서 고른 날짜에 기록할 시각: 오늘이면 지금, 지난 날이면 그날 같은 시각
  function atFor(key) {
    if (key === dayKey(new Date())) return null;
    const d = fromDayKey(key);
    const now = new Date();
    d.setHours(now.getHours(), now.getMinutes());
    return d;
  }

  // 슬라이드표 기간: 첫 기록(또는 식물 등록일)부터 오늘(+ extraDays)까지, 최소 2주
  function stripDays(p, extraDays) {
    const stamps = [p.created_at, ...p.measurements.map((m) => m.taken_at), ...p.care_logs.map((c) => c.at),
      ...p.env_logs.map((e) => e.at)].filter(Boolean).map((x) => parseDate(x).getTime()).filter((t) => !Number.isNaN(t));
    const twoWeeks = new Date();
    twoWeeks.setDate(twoWeeks.getDate() - 13);
    const start = new Date(Math.min(twoWeeks.getTime(), ...stamps));
    const end = new Date();
    end.setDate(end.getDate() + extraDays);
    return dayRange(start, end);
  }

  function recBlock(p, r, primary) {
    return h('div', { class: 'rec' },
      primary ? h('h2', { class: 'status-title' }, r.title)
        : h('h3', { class: 'rec-title' }, statusBadge(r.level === 'info' ? 'info' : r.level, r.level === 'care' ? '관리' : r.level === 'observe' ? '관찰' : r.level === 'good' ? '정상' : '참고'), r.title),
      h('p', { class: 'status-body' }, r.body),
      (r.reasons && r.reasons.length) || r.rule ? h('details', { class: 'why' },
        h('summary', null, '왜 이렇게 판단했나요?', h('span', { html: icons.chevronDown, style: { display: 'contents' } })),
        h('ul', null, (r.reasons || []).map((x) => h('li', null, x)),
          r.rule ? h('li', { class: 'muted' }, h('a', { href: '#/settings/rules' }, `적용한 규칙: ${r.rule}`)) : null)) : null,
      r.action ? h('button', {
        class: 'btn btn-soft btn-md', style: { marginTop: '14px' },
        onclick: async () => { const u = await careSheet(p, { kind: r.action.kind, recCode: r.code }); if (u) rerender(u); },
      }, h('span', { html: icons[careIcon(r.action.kind)] || icons.sun, style: { display: 'contents' } }), r.action.label) : null);
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
    // 사진 기간 안의 환경 기록 (그래프 x 축과 같은 '첫 사진부터 며칠째')
    const last = dayOf(ms[ms.length - 1]);
    const envPoints = (k) => p.env_logs.filter((e) => e[k] !== null && e[k] !== undefined)
      .map((e) => ({ x: (parseDate(e.at).getTime() - t0) / 86400000, y: e[k] }))
      .filter((pt) => pt.x >= 0 && pt.x <= last);
    const tempPts = envPoints('temp');
    const humPts = envPoints('humidity');
    const toggle = (key, label, color, n) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(Boolean(ui[key]) && n > 0), disabled: n === 0,
      'aria-label': n ? label : `${label} (이 기간에 기록 없음)`,
      onclick: (e) => { ui[key] = !ui[key]; e.currentTarget.setAttribute('aria-pressed', String(ui[key])); draw(); },
    }, h('span', { class: 'swatch', style: { background: color } }), label, n ? null : h('span', { class: 'muted' }, '· 기록 없음'));
    const toggles = h('div', { class: 'chart-toggles', role: 'group', 'aria-label': '그래프에 온도·습도 함께 보기' },
      toggle('showTemp', '온도 표기', 'var(--temp-line)', tempPts.length),
      toggle('showHum', '습도 표기', 'var(--hum-line)', humPts.length));
    const draw = () => {
      const d = defs[ui.metric];
      const overlays = [];
      if (ui.showTemp && tempPts.length) overlays.push({ name: '온도', unit: '℃', color: 'var(--temp-line)', format: (v) => fmt(v, 1), points: tempPts });
      if (ui.showHum && humPts.length) overlays.push({ name: '습도', unit: '%', color: 'var(--hum-line)', format: (v) => fmt(v, 0), points: humPts });
      box.replaceChildren(lineChart({
        overlays,
        series: [{ name: d.label, color: 'var(--chart-line)', points: ms.map((m) => ({ x: dayOf(m), y: d.y(m) })) }],
        xTick: (x) => dateShort(dateOf(x)),
        tipTitle: (x) => dateLong(dateOf(x)),
        yFormat: d.f,
        yZero: d.zero,
        height: 200,
        ariaLabel: `${p.name} ${d.label} 변화 그래프`,
        tableHead: '날짜',
      }));
      note.textContent = [
        ui.metric === 'rate'
          ? '생장률 = (이번 면적 − 지난 면적) ÷ 지난 면적 ÷ 기간(일). 0%보다 낮으면 면적이 줄어든 거예요.'
          : u === 'px' ? '크기 보정 전이라 픽셀 단위예요. 같은 위치에서 찍은 사진끼리 비교해 주세요.' : '',
        overlays.length ? '온도·습도는 오른쪽 축 숫자로 읽어요. 선끼리 만나는 지점은 의미가 없어요.' : '',
      ].filter(Boolean).join(' ');
      note.hidden = !note.textContent;
    };
    card.append(segmented([['area', '면적'], ['height', '높이'], ['width', '폭'], ['rate', '생장률']], ui.metric, (v) => { ui.metric = v; draw(); }), toggles, box, note);
    draw();
    return card;
  }

  // ------------------------------------------------------------ 급수 기록표
  function waterCard(p) {
    const wf = p.facts?.water || { count: 0 };
    const today = dayKey(new Date());
    const soilByCare = new Map(p.observations.filter((o) => o.care_id).map((o) => [o.care_id, o.soil_state]));
    const byDay = new Map();
    p.care_logs.filter((c) => c.kind === 'water').forEach((c) => {
      const k = dayKey(c.at);
      const d = byDay.get(k) || { total: 0, withAmount: 0, logs: [] };
      d.logs.push(c);
      if (c.amount) { d.total += c.amount; d.withAmount += 1; }
      byDay.set(k, d);
    });
    // 흙 확인 권장일 (마지막 급수 + 물주기 확인 간격). 이미 지났으면 오늘에 표시
    let checkKey = wf.next_check_at ? dayKey(wf.next_check_at) : null;
    if (checkKey && checkKey < today) checkKey = today;
    if (checkKey && byDay.has(checkKey)) checkKey = null;

    const detail = h('div', { class: 'ds-detail' });
    const renderDay = (k) => {
      const d = byDay.get(k);
      const future = k > today;
      const rows = d ? d.logs.map((c) => h('button', {
        class: 'list-item', type: 'button', 'aria-label': `물 준 기록 지우기 (${timeShort(c.at)})`,
        onclick: () => removeLog('관리 기록', () => api.deleteCare(c.id)),
      },
      h('div', { class: 'list-icon water', html: icons.drop }),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, c.amount ? `물 ${fmt(c.amount, 0)}ml` : '물 줬어요'),
        h('div', { class: 'meta' }, [timeShort(c.at), soilByCare.get(c.id) ? `주기 전 흙 ${soilLabel(soilByCare.get(c.id))}` : null,
          c.rec_code ? '추천을 따라 한 관리' : null, c.note].filter(Boolean).join(' · '))),
      h('span', { class: 'row-action', html: icons.trash, title: '지우기' }))) : [];
      let empty = '이 날은 물 준 기록이 없어요.';
      if (k === checkKey) empty = '흙 확인 권장일이에요. 흙 표면을 만져 보고 말랐으면 물을 주세요.';
      else if (future) empty = '아직 오지 않은 날이에요.';
      detail.replaceChildren(
        rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'ds-empty' }, empty),
        future ? null : h('div', { class: 'ds-actions' }, h('button', {
          class: 'btn btn-soft btn-md', type: 'button',
          onclick: async () => { const u = await careSheet(p, { kind: 'water', at: atFor(k) }); if (u) rerender(u); },
        }, h('span', { html: icons.drop, style: { display: 'contents' } }), k === today ? '물 준 기록 추가' : '이 날 물 준 기록 추가')));
    };
    const strip = dayStrip({
      days: stripDays(p, 3),
      selected: ui.waterDay || today,
      label: '급수 기록표',
      cell: (k) => {
        const d = byDay.get(k);
        if (d) {
          return h('span', { class: 'water-dot' }, d.withAmount
            ? [fmt(d.total, 0), h('small', null, 'ml')]
            : h('span', { html: icons.drop, style: { display: 'contents' } }));
        }
        return k === checkKey ? h('span', { class: 'water-dot check' }, '확인') : null;
      },
      describe: (k) => {
        const d = byDay.get(k);
        if (d) return `물 ${d.logs.length}회${d.withAmount ? ` 총 ${fmt(d.total, 0)}ml` : ''}`;
        return k === checkKey ? '흙 확인 권장일' : '';
      },
      onSelect: (k) => { ui.waterDay = k; renderDay(k); },
    });

    const stat = (label, value, unit, sub) => h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, value, unit ? h('small', null, unit) : null),
      sub ? h('div', { class: 'stat-delta muted' }, sub) : null);
    const hasInterval = wf.interval_median !== null && wf.interval_median !== undefined;
    const summary = wf.count
      ? h('div', { class: 'water-stats' },
        stat('마지막 급수', relDays(wf.last_at), null, timeShort(wf.last_at)),
        stat('보통 간격', hasInterval ? fmt(wf.interval_median, 1) : '–', hasInterval ? '일' : null, hasInterval ? `최근 ${wf.intervals_n}번` : '2번째 기록부터'),
        stat('최근 7일', String(wf.count_7d || 0), '회', wf.amount_7d ? `총 ${fmt(wf.amount_7d, 0)}ml` : null))
      : h('div', { class: 'notice', style: { marginTop: '16px' } },
        h('span', { html: icons.info, style: { display: 'contents' } }),
        h('span', { class: 'grow' }, '물 준 날짜와 양을 기록하면 급수 기록표에 파란 동그라미로 표시하고, 물 부족·과습을 생장 기록과 함께 판단해요.'));
    return h('section', { class: 'card', 'aria-label': '급수 기록표' }, strip.el, detail, summary,
      h('p', { class: 'caption water-tip' }, WATER_TIPS[p.species] || WATER_TIPS.other));
  }

  // ------------------------------------------------------------ 잎 색
  // 사진마다 잎 안쪽의 대표색(조명 색을 맞춘 뒤)을 동그라미로 늘어놓고, 약 일주일 전 사진과 비교한 결과를 보여 줘요.
  function leafColorCard(p) {
    const lc = p.facts?.leaf_color;
    const colored = p.measurements.filter((m) => m.color && m.color.hue !== null && m.color.hue !== undefined);
    const missing = p.measurements.length - colored.length;
    const shown = colored.slice(-14);
    const lastId = shown.length ? shown[shown.length - 1].id : null;
    const swatches = shown.length ? h('div', { class: 'leaf-swatches', role: 'list', 'aria-label': '사진별 잎 색' },
      shown.map((m) => h('div', {
        class: 'leaf-swatch', role: 'listitem',
        'aria-label': `${dateShort(m.taken_at)} 잎 색상각 ${fmt(m.color.hue, 1)}도${m.color.yellow >= 1 ? `, 노란 쪽 ${fmt(m.color.yellow, 0)}%` : ''}`,
        title: `색상각 ${fmt(m.color.hue, 1)}° · 노란 쪽 ${fmt(m.color.yellow ?? 0, 1)}%`,
      },
      h('span', { class: `leaf-dot${m.id === lastId ? ' latest' : ''}`, style: { background: m.color.rgb || 'var(--surface-3)' } }),
      h('span', { class: 'leaf-date' }, dateShort(m.taken_at))))) : null;
    if (swatches) requestAnimationFrame(() => { swatches.scrollLeft = swatches.scrollWidth; });

    let badge;
    let text;
    if (!lc) {
      badge = statusBadge('info', '계산 전');
      text = '사진을 다시 분석하면 잎 색을 계산해요.';
    } else if (!lc.compared) {
      badge = statusBadge('info', '비교 전');
      text = '사진이 4장 이상 쌓이면 약 일주일 전 사진과 잎 색을 비교해요.';
    } else if (lc.yellowing) {
      badge = statusBadge('observe', '노란 쪽으로 변함');
      text = `색상각 ${fmt(lc.base_hue, 1)}° → ${fmt(lc.hue, 1)}°${lc.yellow_change >= 1 ? ` · 노란 잎 ${signed(lc.yellow_change, 1)}%p` : ''}`
        + (lc.where === 'low' ? ' · 주로 아래쪽 잎' : lc.where === 'high' ? ' · 주로 위쪽 새 잎' : '');
    } else if (lc.paling) {
      badge = statusBadge('observe', '옅어짐');
      text = `진하기 ${signed(lc.chroma_change_pct, 0)}% · 색상각 ${fmt(lc.base_hue, 1)}° → ${fmt(lc.hue, 1)}°`;
    } else if (lc.greening) {
      badge = statusBadge('good', '다시 진해짐');
      text = `색상각 ${fmt(lc.base_hue, 1)}° → ${fmt(lc.hue, 1)}°`;
    } else {
      badge = statusBadge('good', '변화 없음');
      text = `색상각 ${fmt(lc.base_hue, 1)}° → ${fmt(lc.hue, 1)}°`;
    }
    const stat = (label, value, unit, sub) => h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, value, unit ? h('small', null, unit) : null),
      sub ? h('div', { class: 'stat-delta muted' }, sub) : null);
    const stats = lc ? h('div', { class: 'leaf-stats' },
      stat('색상각', fmt(lc.hue, 1), '°', '낮을수록 노란 쪽'),
      stat('노란 쪽 잎', fmt(lc.yellow ?? 0, 1), '%', lc.compared ? `전 ${fmt(lc.base_yellow, 1)}%` : '잎 픽셀 중'),
      stat('진하기', fmt(lc.chroma ?? 0, 0), null,
        lc.chroma_change_pct !== null && lc.chroma_change_pct !== undefined ? `${signed(lc.chroma_change_pct, 0)}%` : '채도')) : null;
    const stale = lc?.compared && lc.stale ? h('p', { class: 'caption', style: { margin: '10px 0 0' } },
      `마지막 사진이 ${relDays(lc.taken_at)} 사진이라 지금 상태 추천에는 쓰지 않았어요. 새 사진을 찍으면 다시 판단해요.`) : null;
    const redo = missing > 0 ? h('div', { class: 'notice accent', style: { marginTop: '14px' } },
      h('span', { html: icons.info, style: { display: 'contents' } }),
      h('span', { class: 'grow' }, `잎 색이 아직 계산되지 않은 사진이 ${missing}장 있어요. 모든 사진을 다시 분석하면 새 인식 기준과 잎 색이 함께 적용돼요.`),
      h('button', { class: 'btn btn-soft btn-md', type: 'button', style: { flex: 'none' }, onclick: () => reanalyzeAll(p) }, '다시 분석')) : null;
    return h('section', { class: 'card', 'aria-label': '잎 색' },
      h('div', { class: 'leaf-head' }, badge, h('span', { class: 'leaf-text' }, text)),
      stale, swatches, stats, redo,
      h('p', { class: 'caption leaf-tip' }, '흰 배경판으로 조명 색을 맞춘 뒤 잎 안쪽 색만 비교해요. 동그라미는 밝기를 맞추고 색만 보여 줘요. 분석 사진에서 주황색으로 칠한 곳이 노란 쪽 잎이에요. 같은 조명·같은 배경에서 찍으면 더 정확해요.'));
  }

  // ------------------------------------------------------------ 3D 생장
  function scanCard(p) {
    const scans = p.scans;
    if (!scans.length) {
      return h('section', { class: 'card scan-empty' },
        h('div', { class: 'list-icon accent', html: icons.cube }),
        h('div', { class: 'grow' },
          h('h3', { class: 'card-title' }, '여러 각도로 찍어 부피를 재요'),
          h('p', { class: 'card-sub' }, '식물 둘레 4방향(+위)에서 찍으면 앞뒤로 자라는 잎까지 반영한 3D 부피를 계산해요. 일주일에 한 번 정도면 충분해요.'),
          h('a', { class: 'btn btn-soft btn-md', href: `#/plant/${p.id}/scan`, style: { marginTop: '12px' } },
            h('span', { html: icons.cube, style: { display: 'contents' } }), '3D 측정하기')));
    }
    const last = scans[scans.length - 1];
    const vu = volumeUnit(p.unit);
    const digits = p.unit === 'cm' ? 1 : 0;
    const d = last.delta;
    const t0 = parseDate(scans[0].taken_at).getTime();
    const card = h('section', { class: 'card' },
      h('div', { class: 'scan-head' },
        h('a', { class: 'scan-mini', href: `#/scan/${last.id}`, 'aria-label': '최근 3D 측정 자세히 보기' },
          lazyViewer(last.points_url, { height: 132, label: '최근 3D 모양', interactive: false })),
        h('div', { class: 'grow' },
          h('div', { class: 'stat-label' }, `최근 3D 부피 · ${dateShort(last.taken_at)}`),
          h('div', { class: 'stat-value' }, fmt(last.volume, digits), h('small', null, vu)),
          h('div', { class: 'stat-delta' }, d
            ? h('span', null, deltaEl(d.volume_pct, { suffix: '%' }), h('span', { class: 'muted' }, ` ${daysText(d.days)} 전 대비`))
            : h('span', { class: 'muted' }, '첫 3D 측정')),
          d && d.volume_pct_per_day !== null && d.volume_pct_per_day !== undefined
            ? h('div', { class: 'caption' }, `하루 평균 부피 생장률 ${signed(d.volume_pct_per_day)}%`) : null)),
      scans.length >= 2 ? h('div', { style: { marginTop: '16px' } }, lineChart({
        series: [{ name: '3D 부피', color: 'var(--chart-line)', points: scans.map((sc) => ({ x: (parseDate(sc.taken_at).getTime() - t0) / 86400000, y: sc.volume })) }],
        xTick: (x) => dateShort(new Date(t0 + x * 86400000)),
        tipTitle: (x) => dateLong(new Date(t0 + x * 86400000)),
        yFormat: (v) => fmt(v, digits) + (p.unit === 'cm' ? 'cm³' : ''),
        height: 160,
        ariaLabel: `${p.name} 3D 부피 변화 그래프`,
        tableHead: '날짜',
      })) : null,
      h('div', { class: 'list', style: { margin: '12px -20px 0', background: 'transparent' } },
        [...scans].reverse().slice(0, 4).map((sc) => h('a', { class: 'list-item', href: `#/scan/${sc.id}` },
          sc.thumb_url ? h('img', { class: 'tl-photo', src: sc.thumb_url, alt: '', loading: 'lazy' }) : h('div', { class: 'list-icon', html: icons.cube }),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, `${fmt(sc.volume, digits)} ${vu}`),
            h('div', { class: 'meta' }, dateLong(sc.taken_at), sc.delta && sc.delta.volume_pct !== null ? ' · ' : '', sc.delta && sc.delta.volume_pct !== null ? deltaEl(sc.delta.volume_pct, { suffix: '%' }) : '')),
          h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } })))),
      h('a', { class: 'btn btn-soft btn-md', href: `#/plant/${p.id}/scan`, style: { marginTop: '8px' } },
        h('span', { html: icons.cube, style: { display: 'contents' } }), '3D 측정하기'));
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
    const strip = envStrip(p);
    if (!p.env_logs.length) {
      return h('div', { class: 'card' }, strip,
        h('p', { class: 'card-sub', style: { margin: '16px 0 0' } }, '아직 환경 기록이 없어요. 생육 변화와 환경을 함께 보면 원인을 더 정확하게 찾을 수 있어요.'));
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
    return h('div', { class: 'card' }, strip, h('div', { class: 'env-grid', style: { marginTop: '16px' } }, tiles),
      h('p', { class: 'caption', style: { margin: '12px 0 0' } }, `${p.species_label} 기준값은 설정 > 추천 기준에서 바꿀 수 있어요.`));
  }

  // 날짜별 온습도 기록표: 그날 평균을 '온도/습도' 한 칸으로
  function envStrip(p) {
    const today = dayKey(new Date());
    const byDay = new Map();
    p.env_logs.forEach((e) => {
      const k = dayKey(e.at);
      byDay.set(k, [...(byDay.get(k) || []), e]);
    });
    const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
    const dayVals = (k) => {
      const logs = byDay.get(k) || [];
      const pick = (key) => logs.map((e) => e[key]).filter((v) => v !== null && v !== undefined);
      return { t: mean(pick('temp')), hu: mean(pick('humidity')) };
    };
    const detail = h('div', { class: 'ds-detail' });
    const renderDay = (k) => {
      const logs = [...(byDay.get(k) || [])].reverse();
      const rows = logs.map((e) => {
        const parts = [
          e.temp !== null ? `${fmt(e.temp)}℃` : null, e.humidity !== null ? `습도 ${fmt(e.humidity, 0)}%` : null,
          e.soil !== null ? `토양 ${fmt(e.soil, 0)}%` : null, e.lux !== null ? `${fmt(e.lux, 0)} lux` : null,
        ].filter(Boolean);
        const body = [h('div', { class: 'list-icon', html: icons.temp }),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, parts.slice(0, 2).join(' · ') || '환경 기록'),
            h('div', { class: 'meta' }, [timeShort(e.at), ...parts.slice(2), e.measurement_id ? '사진 기록과 함께' : null].filter(Boolean).join(' · ')))];
        return e.measurement_id
          ? h('a', { class: 'list-item', href: `#/m/${e.measurement_id}` }, body, h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } }))
          : h('button', { class: 'list-item', type: 'button', 'aria-label': `환경 기록 지우기 (${timeShort(e.at)})`, onclick: () => removeLog('환경 기록', () => api.deleteEnv(e.id)) },
            body, h('span', { class: 'row-action', html: icons.trash, title: '지우기' }));
      });
      detail.replaceChildren(
        rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'ds-empty' }, '이 날은 환경 기록이 없어요.'),
        h('div', { class: 'ds-actions' }, h('button', {
          class: 'btn btn-soft btn-md', type: 'button',
          onclick: async () => { const u = await envSheet(p, lastEnv(p), { at: atFor(k) }); if (u) rerender(u); },
        }, h('span', { html: icons.temp, style: { display: 'contents' } }), k === today ? '환경 기록하기' : '이 날 환경 기록하기')));
    };
    const strip = dayStrip({
      days: stripDays(p, 0),
      selected: ui.envDay || today,
      label: '날짜별 온습도 기록표',
      cell: (k) => {
        const { t, hu } = dayVals(k);
        if (t === null && hu === null) return null;
        return h('span', { class: 'env-cell' }, `${t === null ? '–' : Math.round(t)}/${hu === null ? '–' : Math.round(hu)}`, h('small', null, '℃/%'));
      },
      describe: (k) => {
        const { t, hu } = dayVals(k);
        return [t !== null ? `평균 온도 ${fmt(t)}℃` : null, hu !== null ? `평균 습도 ${fmt(hu, 0)}%` : null].filter(Boolean).join(', ');
      },
      onSelect: (k) => { ui.envDay = k; renderDay(k); },
    });
    return h('div', { 'aria-label': '날짜별 온습도 기록표' }, strip.el, detail);
  }

  // ------------------------------------------------------------ 기록 타임라인
  function timeline(p) {
    const items = [
      ...p.measurements.map((m) => ({ t: m.taken_at, type: 'm', m })),
      ...p.care_logs.map((c) => ({ t: c.at, type: 'c', c })),
      ...p.env_logs.filter((e) => !e.measurement_id).map((e) => ({ t: e.at, type: 'e', e })),
      ...p.observations.filter((o) => !o.care_id).map((o) => ({ t: o.at, type: 'o', o })),
    ].sort((a, b) => (a.t < b.t ? 1 : -1));
    const soilByCare = new Map(p.observations.filter((o) => o.care_id).map((o) => [o.care_id, o.soil_state]));
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
        return h('button', { class: 'list-item', type: 'button', 'aria-label': `${c.kind_label} 기록 지우기`, onclick: () => removeLog('관리 기록', () => api.deleteCare(c.id)) },
          h('div', { class: c.kind === 'water' ? 'list-icon water' : 'list-icon accent', html: icons[careIcon(c.kind)] }),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, c.kind_label + amount),
            h('div', { class: 'meta' }, timeShort(c.at), soilByCare.get(c.id) ? ` · 주기 전 흙 ${soilLabel(soilByCare.get(c.id))}` : '',
              c.rec_code ? ' · 추천을 따라 한 관리' : '', c.note ? ` · ${c.note}` : '')),
          h('span', { class: 'row-action', html: icons.trash, title: '지우기' }));
      }
      if (it.type === 'o') {
        const o = it.o;
        const title = o.signs.length ? o.signs.map(signLabel).join(' · ') : `흙 ${soilLabel(o.soil_state)}`;
        return h('button', { class: 'list-item', type: 'button', 'aria-label': '식물 상태 기록 지우기', onclick: () => removeLog('식물 상태 기록', () => api.deleteObservation(o.id)) },
          h('div', { class: o.signs.length ? 'list-icon observe' : 'list-icon', html: icons.leaf }),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, title),
            h('div', { class: 'meta' }, [timeShort(o.at), o.signs.length && o.soil_state ? `흙 ${soilLabel(o.soil_state)}` : null,
              o.measurement_id ? '사진 기록과 함께' : null, o.note].filter(Boolean).join(' · '))),
          h('span', { class: 'row-action', html: icons.trash, title: '지우기' }));
      }
      const e = it.e;
      const parts = [
        e.temp !== null ? `${fmt(e.temp)}℃` : null, e.humidity !== null ? `습도 ${fmt(e.humidity, 0)}%` : null,
        e.soil !== null ? `토양 ${fmt(e.soil, 0)}%` : null, e.lux !== null ? `${fmt(e.lux, 0)} lux` : null,
      ].filter(Boolean);
      return h('button', { class: 'list-item', type: 'button', 'aria-label': '환경 기록 지우기', onclick: () => removeLog('환경 기록', () => api.deleteEnv(e.id)) },
        h('div', { class: 'list-icon', html: icons.temp }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, '환경 기록'), h('div', { class: 'meta' }, `${timeShort(e.at)} · ${parts.join(' · ')}`)),
        h('span', { class: 'row-action', html: icons.trash, title: '지우기' }));
    };
    draw();
    return wrap;
  }

  let removing = false;
  async function removeLog(label, fn) {
    if (removing) return;
    removing = true;
    try {
      const ok = await confirmSheet({ title: `${label}을 지울까요?`, desc: '지운 기록은 되돌릴 수 없어요.', ok: '지우기', danger: true });
      if (!ok) return;
      await fn();
      toast('기록을 지웠어요');
      await reload();
    } catch (err) {
      toast(friendlyError(err), { error: true });
    } finally {
      removing = false;
    }
  }

  async function reanalyzeAll(p) {
    const ok = await confirmSheet({
      title: '모든 사진을 다시 분석할까요?',
      desc: `${p.name}의 사진 ${p.measurements.length}장을 지금 설정된 색상 범위로 다시 계산해요. 사진이 많으면 시간이 걸려요.`,
      ok: '다시 분석',
    });
    if (!ok) return;
    const prog = progressSheet('다시 분석하는 중이에요', `사진 ${p.measurements.length}장 · 화면을 닫지 말고 기다려 주세요`);
    try {
      const r = await api.reanalyze(p.id);
      toast(`${r.ok}장을 다시 분석했어요${r.failed ? ` (${r.failed}장 실패)` : ''}`);
    } catch (err) {
      toast(friendlyError(err), { error: true });
    } finally {
      prog.close();
    }
    await reload();
  }

  // ------------------------------------------------------------ 더보기
  function moreMenu(p) {
    actionSheet(p.name, [
      { icon: 'note', label: '이름·종류 수정', onClick: () => { location.hash = `#/plant/${p.id}/edit`; } },
      { icon: 'crop', label: '분석 영역 지정', desc: p.roi ? '지정됨 · 영역 밖 초록색은 분석에서 빠져요' : '옆 화분 잎이 함께 찍힐 때 사용', onClick: () => { location.hash = `#/plant/${p.id}/roi`; } },
      { icon: 'ruler', label: '크기 보정 (자)', desc: p.cm_per_px ? `보정됨 · 1cm = ${fmt(1 / p.cm_per_px, 1)}px` : '사진 속 자로 cm 단위 환산', onClick: () => { location.hash = `#/plant/${p.id}/calibrate`; } },
      { icon: 'leaf', label: '식물 상태 기록', desc: '시듦·웃자람 같은 특이사항과 흙 상태', onClick: () => openObserve(p) },
      { icon: 'temp', label: '환경 기록', onClick: async () => { const u = await envSheet(p, lastEnv(p)); if (u) rerender(u); } },
      { icon: 'refresh', label: '모든 사진 다시 분석', desc: '설정에서 색상(HSV) 범위를 바꿨을 때', onClick: () => reanalyzeAll(p) },
      { icon: 'trash', label: '식물 삭제', danger: true, onClick: async () => {
        const ok = await confirmSheet({ title: `${p.name}을(를) 삭제할까요?`, desc: '사진과 모든 기록이 함께 지워지고 되돌릴 수 없어요.', ok: '삭제', danger: true });
        if (!ok) return;
        const prog = progressSheet('삭제하는 중이에요');
        try {
          await api.deletePlant(p.id);
        } finally {
          prog.close();
        }
        toast('식물을 삭제했어요');
        location.replace('#/');
      } },
    ]);
  }
}
