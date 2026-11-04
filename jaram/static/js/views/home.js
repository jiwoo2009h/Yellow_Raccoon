import { api } from '../api.js';
import { h, icons, statusBadge, relDays, isToday, skeleton, signed, dateLong } from '../ui.js';

const LEVEL_ORDER = { care: 3, observe: 2, good: 1, pending: 0, info: 0 };

function ring(done, total) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const ratio = total ? done / total : 0;
  const svg = `<svg class="ring" viewBox="0 0 56 56" aria-hidden="true">
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - ratio)}" transform="rotate(-90 28 28)"/>
    <text x="28" y="33" text-anchor="middle" font-size="14" font-weight="700" fill="var(--text-1)">${done}/${total}</text>
  </svg>`;
  return h('span', { html: svg, style: { display: 'contents' } });
}

function plantRow(p) {
  const latest = p.latest;
  const d = latest?.delta;
  let line;
  if (!latest) line = h('div', { class: 'desc' }, '아직 사진이 없어요 · 첫 사진을 찍어 주세요');
  else if (!d || d.area_pct === null || d.area_pct === undefined) line = h('div', { class: 'desc' }, `${relDays(latest.taken_at)} 촬영 · 기준 사진`);
  else {
    const cls = d.area_pct > 0.05 ? 'up' : d.area_pct < -0.05 ? 'down' : 'flat';
    line = h('div', { class: 'desc' },
      h('span', { class: `delta ${cls}` }, `면적 ${signed(d.area_pct)}%`), ` · ${relDays(latest.taken_at)}`);
  }
  return h('a', { class: 'list-item', href: `#/plant/${p.id}` },
    h('div', { class: 'thumb' }, latest
      ? h('img', { src: latest.photo_url, alt: '', loading: 'lazy' })
      : h('span', { html: icons.sprout, style: { display: 'contents' } })),
    h('div', { class: 'grow' },
      h('div', { class: 'title', style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name),
        p.code ? h('span', { class: 'tag' }, p.code) : null),
      line),
    statusBadge(p.status, p.status_label));
}

export async function homeView() {
  const screen = document.getElementById('screen');
  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('h1', { class: 'large-title' }, '자람'),
      h('p', { class: 'subtitle' }, dateLong(new Date()))),
    h('a', { class: 'icon-btn', href: '#/plant/new', 'aria-label': '식물 추가', html: icons.plus }));
  screen.append(head, skeleton(96, 16), skeleton(220, 32));

  const { plants } = await api.plants();
  screen.replaceChildren(head);

  if (!plants.length) {
    screen.append(h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.sprout }),
      h('h2', null, '첫 식물을 등록해 보세요'),
      h('p', null, '바질, 상추처럼 키우는 식물을 등록하고 사진을 찍으면 얼마나 자랐는지 비교해 드려요.'),
      h('a', { class: 'btn btn-primary', href: '#/plant/new' }, h('span', { html: icons.plus, style: { display: 'contents' } }), '식물 등록하기')));
    return;
  }

  // 오늘 촬영 현황
  const doneToday = plants.filter((p) => p.latest && isToday(p.latest.taken_at)).length;
  const care = plants.filter((p) => p.status === 'care').length;
  const observe = plants.filter((p) => p.status === 'observe').length;
  const left = plants.length - doneToday;
  const sub = [];
  if (care) sub.push(`관리가 필요한 식물 ${care}개`);
  if (observe) sub.push(`지켜볼 식물 ${observe}개`);
  screen.append(h('section', { class: 'card summary-card', 'aria-label': '오늘 촬영 현황' },
    ring(doneToday, plants.length),
    h('div', null,
      h('div', { class: 'big' }, left > 0 ? `오늘 ${left}개 식물을 더 찍으면 돼요` : '오늘 기록을 모두 마쳤어요'),
      h('div', { class: 'caption', style: { marginTop: '2px', fontSize: '14px' } }, sub.length ? sub.join(' · ') : '모든 식물이 잘 자라고 있어요'))));

  // 내 식물
  screen.append(h('h2', { class: 'section-title' }, '내 식물', h('small', null, `${plants.length}개`)));
  screen.append(h('div', { class: 'list' }, plants.map(plantRow)));

  // 추천 모아 보기
  const recs = plants
    .flatMap((p) => p.recs.filter((r) => r.level === 'care' || r.level === 'observe').map((r) => ({ p, r })))
    .sort((a, b) => LEVEL_ORDER[b.r.level] - LEVEL_ORDER[a.r.level]);
  if (recs.length) {
    screen.append(h('h2', { class: 'section-title' }, '해야 할 일'));
    screen.append(h('div', { class: 'list' }, recs.slice(0, 5).map(({ p, r }) =>
      h('a', { class: 'list-item', href: `#/plant/${p.id}` },
        h('div', { class: 'list-icon', style: r.level === 'care' ? { background: 'var(--care-bg)', color: 'var(--care-text)' } : { background: 'var(--observe-bg)', color: 'var(--observe-text)' },
          html: r.action?.kind === 'water' ? icons.drop : r.action?.kind === 'light' ? icons.sun : r.level === 'care' ? icons.warn : icons.eye }),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, r.title),
          h('div', { class: 'meta' }, `${p.name} · ${r.level === 'care' ? '관리 필요' : '관찰 필요'}`)),
        h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } })))));
  }
}
