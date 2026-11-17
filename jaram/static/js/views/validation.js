// 추천 효과 검증: 지난 기록으로 그때 나왔을 추천을 다시 계산하고,
// 추천을 따랐을 때와 따르지 않았을 때 다음 측정 결과를 비교합니다.

import { api } from '../api.js';
import { h, icons, topbar, fmt, signed, statusBadge, skeleton, dateShort } from '../ui.js';

const LEVEL_LABEL = { care: '관리 필요', observe: '관찰 필요' };
const ACTION_LABEL = { water: '물주기', light: '조명·위치 조정' };
const pct = (v) => (v === null || v === undefined ? '–' : `${fmt(v * 100, 0)}%`);
const num = (v, suffix = '', digits = 1) => (v === null || v === undefined ? '–' : `${signed(v, digits)}${suffix}`);

/** 따름/안 따름 두 무리의 평균을 0을 가운데 둔 막대로 비교 (값은 막대 옆 글자로도 표시) */
function compareBars(title, unit, rows) {
  const vals = rows.map((r) => r.value).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  const max = Math.max(...vals.map(Math.abs), 1e-9);
  return h('div', { class: 'cmp', role: 'group', 'aria-label': title },
    h('div', { class: 'cmp-title' }, title),
    rows.map((r) => {
      const has = r.value !== null && r.value !== undefined;
      const w = has ? (Math.abs(r.value) / max) * 50 : 0;
      const neg = has && r.value < 0;
      const valueText = has ? `${signed(r.value)}${unit}` : '–';
      return h('div', { class: 'cmp-row', title: `${r.label} ${r.n}건 · 평균 ${valueText}` },
        h('span', { class: 'cmp-label' }, r.label, h('small', null, ` ${r.n}건`)),
        h('span', { class: 'cmp-track', 'aria-hidden': 'true' },
          h('span', { class: 'cmp-zero' }),
          has ? h('span', { class: `cmp-bar ${r.cls}${neg ? ' neg' : ''}`, style: { left: `${neg ? 50 - w : 50}%`, width: `${Math.max(w, 0.8)}%` } }) : null),
        h('span', { class: 'cmp-val' }, valueText));
    }));
}

function codeCard(c) {
  const head = h('div', { class: 'vc-head' },
    h('div', { class: 'grow' },
      h('div', { class: 'card-title', style: { margin: 0 } }, c.title),
      h('div', { class: 'caption', style: { marginTop: '2px' } },
        `${c.count}번 나왔어요`,
        c.action ? ` · ${ACTION_LABEL[c.action] || '관리'} 따른 비율 ${pct(c.follow_rate)} (${c.followed}/${c.count})` : '')),
    statusBadge(c.level, LEVEL_LABEL[c.level] || c.level));

  if (!c.action) {
    const a = c.all;
    return h('section', { class: 'card vc' }, head,
      h('div', { class: 'vc-grid' },
        h('div', null, h('div', { class: 'stat-label' }, '다음 구간 생장률 변화'), h('div', { class: 'vc-num' }, num(a.rate_change, '%p'))),
        h('div', null, h('div', { class: 'stat-label' }, '다음 측정에서 해소'), h('div', { class: 'vc-num' }, pct(a.recovered)))),
      h('p', { class: 'caption', style: { margin: '10px 0 0' } }, '행동을 권하지 않는 관찰 추천이라 따름/안 따름은 나누지 않아요.'));
  }

  const yes = c.yes;
  const no = c.no;
  const row = (label, f) => h('tr', null, h('td', null, label), h('td', { class: 'r' }, f(yes)), h('td', { class: 'r' }, f(no)));
  return h('section', { class: 'card vc' }, head,
    compareBars('다음 구간 면적 생장률 변화 (평균)', '%p', [
      { label: '따름', n: yes.n, value: yes.rate_change, cls: 'yes' },
      { label: '안 따름', n: no.n, value: no.rate_change, cls: 'no' },
    ]),
    h('div', { class: 'table-wrap', style: { marginTop: '12px' } }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, '평균'), h('th', { class: 'r' }, `따름 ${yes.n}건`), h('th', { class: 'r' }, `안 따름 ${no.n}건`))),
      h('tbody', null,
        row('다음 구간 생장률', (g) => (g.rate_after === null || g.rate_after === undefined ? '–' : `${fmt(g.rate_after)}%/일`)),
        row('다음 측정에서 회복', (g) => pct(g.recovered)),
        row('토양 수분 변화', (g) => num(g.soil_change, '%p')),
        row('다음 3D 부피 생장률', (g) => (g.volume_rate_after === null || g.volume_rate_after === undefined ? '–' : `${fmt(g.volume_rate_after)}%/일`))))),
    yes.small || no.small ? h('div', { class: 'vc-note' },
      h('span', { class: 'tag' }, '표본 적음'), h('p', { class: 'caption' }, '한쪽이 3건 미만이라 차이를 일반화하기 어려워요.')) : null);
}

export async function validationView() {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '추천 효과 검증' }), skeleton(140, 8), skeleton(240));
  const rep = await api.validation();
  const s = rep.summary;
  const top = topbar({ title: '추천 효과 검증' });

  if (!s.occurrences) {
    screen.replaceChildren(top, h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.chart }),
      h('h2', null, '아직 검증할 추천이 없어요'),
      h('p', null, '사진과 환경·관리 기록이 쌓여 관찰·관리 추천이 나오면, 그 추천을 따랐을 때와 아닐 때를 비교해 드려요.')));
    return;
  }

  const tile = (label, value, sub) => h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-delta muted' }, sub) : null);

  const events = rep.events;
  screen.replaceChildren(
    top,
    h('section', { class: 'card', style: { marginTop: '4px' } },
      h('h2', { class: 'card-title' }, '추천을 따르면 정말 나아졌을까요?'),
      h('p', { class: 'card-sub', style: { margin: 0 } },
        `지금 기준값으로 지난 기록을 사진마다 다시 판단해, 그때 나왔을 추천과 그 뒤 결과를 비교했어요. 추천 뒤 ${s.follow_days}일 안에 맞는 관리를 기록했으면 '따름'으로 봐요.`)),
    h('div', { class: 'stats', style: { marginTop: '12px' } },
      tile('다시 판단한 시점', h('span', null, fmt(s.evaluations, 0), h('small', null, '회')), `식물 ${s.plants}개`),
      tile('관찰·관리 추천', h('span', null, fmt(s.occurrences, 0), h('small', null, '건')), `관리 필요 ${s.statuses.care}회 · 관찰 ${s.statuses.observe}회`),
      tile('행동 추천을 따른 비율', pct(s.follow_rate), `${s.followed}/${s.actionable}건`),
      tile('관리 필요 → 다음에 회복', pct(s.care_recovered), `${s.care_points}건 중`)),
    h('h2', { class: 'section-title' }, '추천 종류별'),
    h('div', { class: 'vc-list' }, rep.by_code.map(codeCard)),
    h('h2', { class: 'section-title' }, '추천 기록', h('small', null, `${events.length}건`)),
    h('section', { class: 'card' },
      h('details', { class: 'table-toggle' }, h('summary', null, '모든 추천 보기'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '날짜'), h('th', null, '식물'), h('th', null, '추천'), h('th', null, '따름'), h('th', { class: 'r' }, '생장률 전→후'))),
          h('tbody', null, events.slice().reverse().map((e) => h('tr', null,
            h('td', null, dateShort(e.at)), h('td', null, e.plant), h('td', null, e.title),
            h('td', null, e.followed === null ? '–' : e.followed ? '○' : '×'),
            h('td', { class: 'r' }, `${e.rate_before === null ? '–' : fmt(e.rate_before)} → ${e.rate_after === null ? '–' : fmt(e.rate_after)}`))))))),
      h('a', { class: 'btn btn-text', href: '/api/validation.csv', download: '', style: { marginTop: '8px' } }, '검증 결과 CSV 받기')),
    h('p', { class: 'caption', style: { margin: '16px 4px 0' } },
      '실험이 아니라 기록을 비교한 결과라서, 따른 경우와 안 따른 경우의 식물·시기가 달라 차이가 섞일 수 있어요. 원인을 확인하려면 같은 조건의 식물을 나눠 비교 실험을 해 보세요.'));
}
