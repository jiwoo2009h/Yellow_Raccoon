// 홈 = 식물 생육 대시보드
// 1) 사이트 이름·소개  2) 품종(바질·상추)별 식물 목록 + 품종별 '추가' 버튼  3) 사진 찍기 바로가기  4) 최근 관리 기록

import { api } from '../api.js';
import {
  h, icons, statusBadge, skeleton, fmt, signed, recBox, withIcon, VARIETY_ORDER, variety, plantTitle,
  dateTimeShort, WEEKDAYS,
} from '../ui.js';

export const CARE_ICON = { water: 'drop', move: 'move', light: 'bulb', vent: 'wind', fertilize: 'flask', prune: 'scissors', other: 'note' };

function headerDate() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${WEEKDAYS[d.getDay()]}`;
}

function summaryCard(plants) {
  const n = { good: 0, observe: 0, care: 0 };
  plants.forEach((p) => { if (n[p.status] !== undefined) n[p.status] += 1; });
  let headline;
  if (!plants.length) headline = '식물을 등록하고 첫 사진을 찍어 보세요';
  else if (n.care) headline = `${plants.length}개 중 ${n.care}개가 관리 필요해요`;
  else if (n.observe) headline = `${plants.length}개 중 ${n.observe}개를 지켜봐 주세요`;
  else if (n.good === plants.length) headline = '모두 잘 자라고 있어요';
  else headline = '사진이 쌓이면 상태를 알려 드릴게요';
  const count = (label, color, v) => h('div', { class: 'count' },
    h('div', { class: 'label' }, h('i', { style: { background: color } }), label),
    h('div', { class: 'v num' }, String(v)));
  return h('section', { class: 'summary', 'aria-label': '오늘 확인할 식물' },
    h('div', { class: 'k' }, '오늘 확인할 식물'),
    h('div', { class: 'headline' }, headline),
    h('div', { class: 'counts' },
      count('정상', '#4ade80', n.good),
      count('관찰', '#fbbf24', n.observe),
      count('관리', '#f87171', n.care)));
}

function metric(label, value, unit, delta, deltaDigits = 1) {
  return h('div', null,
    h('div', { class: 'k' }, label),
    h('div', { class: 'v' }, value, unit ? h('small', null, unit) : null,
      delta !== undefined && delta !== null
        ? h('small', { class: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' }, signed(delta, deltaDigits)) : null));
}

export function plantCard(p) {
  const l = p.latest;
  const unit = p.unit === 'cm' ? 'cm' : 'px';
  const areaUnit = p.unit === 'cm' ? 'cm²' : 'px';
  const rate = p.facts?.area_rate;
  const meta = l
    ? `측정 ${p.count}회 · ${new Date(l.taken_at).getMonth() + 1}월 ${new Date(l.taken_at).getDate()}일 촬영`
    : '아직 사진이 없어요';
  return h('a', { class: 'plant-card', href: `#/plant/${p.id}` },
    h('div', { class: 'pc-head' },
      h('div', { class: 'pc-thumb' }, l
        ? h('img', { src: l.photo_url, alt: '', loading: 'lazy' })
        : h('span', { html: icons.leaf, style: { display: 'contents' } })),
      h('div', { class: 'grow' },
        h('div', { class: 'pc-name' }, plantTitle(p)),
        h('div', { class: 'pc-meta' }, meta)),
      statusBadge(p.status, p.status_label)),
    l ? h('div', { class: 'pc-metrics' },
      metric('높이', fmt(l.height, 1), unit, l.delta?.height),
      metric('투영 면적', fmt(l.area, l.area >= 100 ? 0 : 1), areaUnit, l.delta?.area, 0),
      h('div', null,
        h('div', { class: 'k' }, '생장률'),
        // 생장 둔화·정체로 판단되면 빨간색
        h('div', { class: 'v' + (rate === null || rate === undefined ? '' : (p.facts.slowing || p.facts.stagnant || rate < 0) ? ' down' : ' up') },
          rate === null || rate === undefined ? '–' : `${signed(rate, 1)}%`, h('small', { class: 'flat' }, '/일')))) : null,
    recBox(p.recs?.[0]));
}

export function careRow(c, { showPlant = true, onDelete } = {}) {
  const what = `${c.kind_label}${c.amount ? ` ${fmt(c.amount, 0)} mL` : ''}${c.note ? ` (${c.note})` : ''}`;
  return h('div', { class: 'care-row' },
    h('div', { class: 'list-icon accent', html: icons[CARE_ICON[c.kind] || 'note'] }),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, showPlant ? `${c.plant_name} · ${what}` : what),
      h('div', { class: 's' }, dateTimeShort(c.at))),
    c.rec_code ? h('span', { class: 'tag' }, '추천 반영') : null,
    onDelete ? h('button', { class: 'icon-btn del', type: 'button', 'aria-label': '기록 지우기', html: icons.trash, onclick: onDelete }) : null);
}

export async function homeView() {
  const screen = document.getElementById('screen');
  const head = h('header', { class: 'page-head' },
    h('div', null,
      h('p', { class: 'eyebrow' }, '자람 · 바티칸 시국 과학과제연구'),
      h('h1', { class: 'large-title' }, '식물 생육 대시보드'),
      h('p', { class: 'intro' }, '바질·상추 사진을 OpenCV로 분석해 생장을 기록하고, 온습도·물주기 기록과 함께 오늘 할 관리를 추천해요.')),
    h('span', { class: 'date-pill' }, ...withIcon('clock', headerDate())));
  screen.append(head, skeleton(150, 16), skeleton(50), skeleton(250, 24));

  const [{ plants }, care] = await Promise.all([api.plants(), api.careList(3).catch(() => ({ items: [] }))]);

  const groups = VARIETY_ORDER
    .filter((sp) => sp !== 'other' || plants.some((p) => p.species === 'other'))
    .map((sp) => {
      const list = plants.filter((p) => p.species === sp);
      return h('section', { 'aria-label': variety(sp) },
        h('div', { class: 'group-head' },
          h('span', { html: icons.leaf, style: { display: 'contents' } }),
          h('span', { class: 'variety' }, variety(sp)),
          h('span', { class: 'count' }, `${list.length}개`),
          h('span', { class: 'spacer' }),
          h('a', { class: 'btn-add ghost', href: `#/plant/new?species=${sp}`, 'aria-label': `${variety(sp)} 추가` }, ...withIcon('plus', '추가'))),
        list.length
          ? list.map(plantCard)
          : h('a', { class: 'plant-card empty-inline', href: `#/plant/new?species=${sp}` }, `아직 등록한 ${variety(sp)}가 없어요 · 눌러서 추가하기`));
    });

  const careItems = care.items || [];
  screen.replaceChildren(
    head,
    h('div', { style: { marginTop: '16px' } }, summaryCard(plants)),
    h('a', { class: 'btn btn-primary', href: '#/photo', style: { marginTop: '16px' } }, ...withIcon('camera', '오늘 사진 찍고 분석하기')),
    h('h2', { class: 'section-title' }, '식물별 상태',
      h('a', { class: 'btn-add', href: '#/plant/new' }, ...withIcon('plus', '식물 추가'))),
    ...groups,
    h('h2', { class: 'section-title' }, '최근 관리 기록', h('a', { class: 'section-link', href: '#/record?tab=care' }, '전체 보기')),
    h('section', { class: 'card list-card' },
      careItems.length ? careItems.map((c) => careRow(c))
        : h('div', { class: 'empty-inline' }, '아직 관리 기록이 없어요. 기록 탭에서 물주기·위치 변경 등을 남겨 보세요.')),
    h('p', { class: 'disclaimer' }, '추천은 진단이 아니라 관리 결정을 돕는 참고 정보입니다. 기준값은 설정에서 바꿀 수 있어요.'));
}
