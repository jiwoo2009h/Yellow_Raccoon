// 생육 그래프: 같은 날짜 축에서 생육 변화(높이·폭·투영 면적, 면적 생장률)와 환경 변화(토양 수분 등)를 비교

import { api } from '../api.js';
import { h, icons, segmented, multiChips, fmt, withIcon, skeleton } from '../ui.js';
import { timeChart, movingAverage } from '../dchart.js';

const METRICS = [['height', '높이'], ['width', '폭'], ['area', '투영 면적']];
const ENVS = [
  ['soil', '토양 수분', '%', 0], ['temp', '온도', '℃', 1], ['humidity', '습도', '%', 0],
  ['lux', '조도', 'lux', 0], ['light_hours', '조명 시간', '시간', 1],
];
export const PLANT_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

const ms = (s) => new Date(s).getTime();
const mdLong = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };

/** 환경 값이 기준 아래로 내려가 지금까지 이어진 구간과 그때 생장률이 함께 떨어졌는지 찾습니다. */
function findInsight(plants, th) {
  const checks = [
    ['soil', 'soil_min', '토양 수분이', '%', 'drop', '토양 수분과 생장률이 함께 떨어졌어요'],
    ['lux', 'lux_min', '조도가', ' lux', 'sun', '조도와 생장률이 함께 떨어졌어요'],
  ];
  const order = { care: 0, observe: 1, good: 2, pending: 3 };
  for (const p of [...plants].sort((a, b) => order[a.status] - order[b.status])) {
    const t = th.species[p.species] || th.species.other;
    const rates = p.points.filter((x) => x.area_rate !== null && x.area_rate !== undefined);
    if (rates.length < 3) continue;
    for (const [key, minKey, label, unit, ic, title] of checks) {
      const vals = p.env.filter((e) => e[key] !== null && e[key] !== undefined);
      if (vals.length < 3) continue;
      let i = vals.length - 1;
      if (vals[i][key] >= t[minKey]) continue;
      while (i > 0 && vals[i - 1][key] < t[minKey]) i -= 1;
      const from = ms(vals[i].at);
      const before = rates.filter((r) => ms(r.taken_at) < from).slice(-3).map((r) => r.area_rate);
      const after = rates.filter((r) => ms(r.taken_at) >= from).map((r) => r.area_rate);
      if (!before.length || !after.length) continue;
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      if (avg(after) >= avg(before) * 0.7) continue; // 생장률이 함께 떨어지지 않았으면 넘어감
      return {
        plantId: p.id, key, from, icon: ic,
        title: `${p.name} · ${title}`,
        body: `${mdLong(from)} 이후 ${label} ${fmt(t[minKey], 0)}${unit} 아래로 내려가면서 생장률도 ${fmt(avg(before), 1)} → ${fmt(avg(after), 1)}%/일로 둔화됐어요. 동시에 변했다고 원인이라고 단정할 수는 없어요.`,
      };
    }
  }
  return null;
}

export async function graphView() {
  const screen = document.getElementById('screen');
  const head = h('header', null,
    h('h1', { class: 'large-title' }, '생육 그래프'),
    h('p', { class: 'subtitle' }, '같은 날짜 축에서 생육 변화와 환경 변화를 비교해요.'));
  screen.append(head, skeleton(33, 16), skeleton(45), skeleton(255, 16));

  const [report, { thresholds: th }] = await Promise.all([api.report(), api.settings()]);
  const plants = report.plants;
  if (!plants.some((p) => p.points.length)) {
    screen.replaceChildren(head, h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.graph }),
      h('h2', null, '아직 그릴 기록이 없어요'),
      h('p', null, '사진을 두 번 이상 찍으면 생장 그래프가 그려져요.'),
      h('a', { class: 'btn btn-primary', href: '#/photo' }, ...withIcon('camera', '사진 찍으러 가기'))));
    return;
  }
  const color = Object.fromEntries(plants.map((p, i) => [p.id, PLANT_COLORS[i % PLANT_COLORS.length]]));
  const insight = findInsight(plants, th);
  const state = { selected: new Set(plants.map((p) => p.id)), metric: 'area', env: insight?.key || 'soil' };

  const filter = multiChips(plants.map((p) => [p.id, p.name]), state.selected, (set) => { state.selected = set; draw(); });
  filter.style.marginTop = '16px';
  const metricSeg = segmented(METRICS, state.metric, (v) => { state.metric = v; draw(); });
  metricSeg.style.marginTop = '16px';
  const legend = h('div', { class: 'legend', style: { margin: '16px 0 0' } });
  const charts = h('div');

  const csv = h('a', { class: 'btn btn-secondary', href: '/api/export.csv', download: '', style: { marginTop: '16px' } }, ...withIcon('download', '통합 데이터 CSV 받기'));
  screen.replaceChildren(head, filter, metricSeg, legend, charts,
    ...[insight && h('section', { class: 'rec-box care', style: { marginTop: '16px', padding: '14px' } },
      h('span', { html: icons[insight.icon], style: { display: 'contents' } }),
      h('div', null, h('div', { class: 't' }, insight.title), h('div', { class: 'b' }, insight.body)))].filter(Boolean),
    csv, accuracyCard(report.accuracy));

  function draw() {
    const sel = plants.filter((p) => state.selected.has(p.id));
    legend.replaceChildren(...sel.map((p) => h('span', null, h('i', { style: { background: color[p.id] } }), p.name)));
    if (!sel.length) {
      charts.replaceChildren(h('div', { class: 'empty-inline' }, '위에서 식물을 하나 이상 골라 주세요.'));
      return;
    }
    const unitOf = (p) => (p.unit === 'cm' ? (state.metric === 'area' ? 'cm²' : 'cm') : 'px');
    const units = [...new Set(sel.map(unitOf))];
    const allPts = sel.flatMap((p) => p.points);
    const range = allPts.length ? `${mdLong(Math.min(...allPts.map((x) => ms(x.taken_at))))} – ${mdLong(Math.max(...allPts.map((x) => ms(x.taken_at))))}` : '';
    const metricLabel = METRICS.find(([k]) => k === state.metric)[1];

    const valueChart = timeChart({
      ariaLabel: `${metricLabel} 그래프`,
      axes: { left: { digits: state.metric === 'area' ? 0 : 1, zero: true } },
      series: sel.map((p) => ({ name: p.name, color: color[p.id], unit: unitOf(p), digits: 1, points: p.points.map((x) => ({ t: ms(x.taken_at), y: x[state.metric] })) })),
    });

    const stag = (th.species[sel[0].species] || th.species.other).stagnation_rate;
    const rateChart = timeChart({
      ariaLabel: '면적 생장률 그래프',
      axes: { left: { digits: 0 } },
      refLine: { y: stag },
      series: sel.map((p) => {
        const ma = movingAverage(p.points.map((x) => x.area_rate), 3);
        return { name: p.name, color: color[p.id], unit: '%/일', digits: 1, points: p.points.map((x, i) => ({ t: ms(x.taken_at), y: ma[i] })).filter((x) => x.y !== null) };
      }),
    });

    const envSel = h('select', { class: 'mini-select', 'aria-label': '환경 지표 고르기' },
      ENVS.map(([k, label]) => h('option', { value: k, selected: k === state.env }, label)));
    envSel.addEventListener('change', () => { state.env = envSel.value; draw(); });
    const [, envLabel, envUnit, envDigits] = ENVS.find(([k]) => k === state.env);
    const envChart = timeChart({
      ariaLabel: `${envLabel} 그래프`,
      axes: { left: { digits: envDigits, zero: state.env !== 'temp' } },
      bands: insight && insight.key === state.env && state.selected.has(insight.plantId) ? [{ from: insight.from - 12 * 3600000 }] : [],
      empty: `${envLabel} 기록이 2개 이상 쌓이면 그래프가 그려져요.`,
      series: sel.map((p) => ({ name: p.name, color: color[p.id], unit: envUnit === 'lux' ? ' lux' : envUnit, digits: envDigits, points: p.env.filter((e) => e[state.env] !== null && e[state.env] !== undefined).map((e) => ({ t: ms(e.at), y: e[state.env] })) })),
    });

    charts.replaceChildren(
      h('section', { class: 'card chart-card', style: { marginTop: '16px' } },
        h('div', { class: 'card-head' }, h('div', null,
          h('h2', { class: 'card-title' }, metricLabel),
          h('p', { class: 'card-sub' }, `${units.join(', ')} · ${range}, ${allPts.length}회 측정`))),
        valueChart),
      h('section', { class: 'card chart-card' },
        h('div', { class: 'card-head' }, h('div', null,
          h('h2', { class: 'card-title' }, '면적 생장률'),
          h('p', { class: 'card-sub' }, `%/일 · 3회 이동평균 · 점선 = 둔화 기준 ${fmt(stag, 1)}%/일`))),
        rateChart),
      h('section', { class: 'card chart-card' },
        h('div', { class: 'card-head' },
          h('div', null, h('h2', { class: 'card-title' }, envLabel), h('p', { class: 'card-sub' }, `${envUnit} · 환경 지표`)),
          envSel),
        envChart));
  }
  draw();
}

function accuracyCard(acc) {
  if (!acc || (!acc.height && !acc.width)) {
    return h('section', { class: 'card', style: { marginTop: '16px' } },
      h('h2', { class: 'card-title' }, '영상 분석 정확도'),
      h('p', { class: 'card-sub' }, '사진 분석 화면에서 자로 직접 잰 높이·폭을 입력하면 영상 분석값과의 차이(평균 오차)를 보여 드려요.'));
  }
  const row = (label, a) => (a ? h('tr', null, h('td', null, label), h('td', { class: 'r' }, `${a.n}회`),
    h('td', { class: 'r' }, `${fmt(a.mae, 2)} cm`), h('td', { class: 'r' }, `${fmt(a.mape, 1)}%`)) : null);
  return h('section', { class: 'card', style: { marginTop: '16px' } },
    h('h2', { class: 'card-title' }, '영상 분석 정확도'),
    h('p', { class: 'card-sub' }, '자로 직접 잰 값과 영상 분석값의 차이예요. 작을수록 정확해요.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, '지표'), h('th', { class: 'r' }, '비교'), h('th', { class: 'r' }, '평균 오차'), h('th', { class: 'r' }, '오차율'))),
      h('tbody', null, row('높이', acc.height), row('폭', acc.width)))));
}
