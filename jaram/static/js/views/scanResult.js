// 3D 측정 결과: 3D 미리보기 · 부피 · 높이/폭/깊이 · 지난 측정 대비 부피 변화

import { api } from '../api.js';
import { h, icons, topbar, fmt, signed, dateLong, daysText, skeleton, toast, confirmSheet } from '../ui.js';
import { lazyViewer } from '../viewer3d.js';
import { SCAN_STEPS, viewKey } from './scan.js';

export const volumeUnit = (unit) => (unit === 'cm' ? 'cm³' : 'px³');

export async function scanResultView({ id }) {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '3D 측정 결과' }), skeleton(320, 8), skeleton(160));
  const s = await api.scan(id);
  const unit = s.plant.unit;
  const cm = unit === 'cm';
  const lenDigits = cm ? 1 : 0;
  const back = () => { location.hash = `#/plant/${s.plant_id}`; };

  const remove = async () => {
    const ok = await confirmSheet({ title: '이 3D 측정을 지울까요?', desc: '사진과 3D 결과가 지워져요. 0° 사진으로 만든 일반 기록은 남아요.', ok: '지우기', danger: true });
    if (!ok) return;
    await api.deleteScan(s.id);
    toast('3D 측정을 지웠어요');
    back();
  };

  const top = topbar({
    title: `${s.plant.name} 3D 측정`,
    onBack: back,
    right: h('button', { class: 'icon-btn', 'aria-label': '3D 측정 삭제', html: icons.trash, onclick: remove }),
  });

  if (s.status !== 'done') {
    screen.replaceChildren(top, h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.cube }),
      h('h2', null, '아직 3D 계산 전이에요'),
      h('p', null, '사진을 더 찍거나 3D 계산하기를 눌러 주세요.'),
      h('a', { class: 'btn btn-primary', href: `#/plant/${s.plant_id}/scan` }, '3D 측정 다시 하기')));
    return;
  }

  const d = s.delta;
  const headline = d && d.volume_pct !== null && d.volume_pct !== undefined
    ? `지난 3D 측정(${daysText(d.days)} 전)보다 부피가 ${Math.abs(d.volume_pct) < 1 ? '거의 같아요' : d.volume_pct > 0 ? `${fmt(d.volume_pct)}% 늘었어요` : `${fmt(-d.volume_pct)}% 줄었어요`}`
    : '첫 3D 측정이에요. 다음 측정부터 부피 변화를 비교해요.';

  const stat = (label, value, u) => h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value === null || value === undefined ? '–' : fmt(value, lenDigits), value === null || value === undefined ? null : h('small', null, u)));

  const views = SCAN_STEPS.map((st) => {
    const v = s.views.find((x) => viewKey(x) === st.key);
    if (!v) return null;
    const topInfo = st.key === 'top' && s.detail.top;
    return h('figure', { class: 'view-chip' },
      h('img', { src: v.overlay_url, alt: `${st.title} 실루엣`, loading: 'lazy' }),
      h('figcaption', null, st.short, topInfo ? h('span', { class: 'muted' }, topInfo.used ? ` · 맞음 ${fmt(topInfo.fit * 100, 0)}%` : ' · 사용 안 함') : null));
  }).filter(Boolean);

  screen.replaceChildren(...[
    top,
    h('section', { class: 'card', style: { marginTop: '4px', padding: '12px' } },
      lazyViewer(s.points_url, { height: 320, label: `${s.plant.name} 3D 모양` }),
      h('div', { class: 'viewer-caption' },
        h('span', null, '끌어서 돌려 보세요'),
        s.method_label ? h('span', { class: 'tag' }, s.method_label) : null)),
    h('section', { class: 'card', style: { marginTop: '12px' } },
      h('p', { class: 'caption', style: { margin: '0 0 4px' } }, dateLong(s.taken_at)),
      h('div', { class: 'big-volume' }, fmt(s.volume, cm ? 1 : 0), h('small', null, volumeUnit(unit))),
      h('p', { class: 'status-body', style: { marginTop: '4px' } }, headline),
      d && d.volume_pct_per_day !== null && d.volume_pct_per_day !== undefined
        ? h('p', { class: 'caption', style: { margin: '6px 0 0' } }, `부피 생장률 ${signed(d.volume_pct_per_day)}%/일`, s.since_first ? ` · 첫 측정 대비 ${signed(s.since_first.volume_pct, 0)}% (${daysText(s.since_first.days)})` : '')
        : null,
      !cm ? h('a', { class: 'notice accent', href: `#/plant/${s.plant_id}/calibrate`, style: { marginTop: '12px' } },
        h('span', { html: icons.ruler, style: { display: 'contents' } }),
        h('span', { class: 'grow' }, '0° 사진의 자로 크기 보정을 하면 cm³ 단위로 볼 수 있어요.')) : null),
    h('h2', { class: 'section-title' }, '3D 크기'),
    h('div', { class: 'stats' },
      stat('높이', s.height, unit), stat('폭 (좌우)', s.width, unit), stat('깊이 (앞뒤)', s.depth, unit),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '위에서 본 면적'),
        h('div', { class: 'stat-value' }, fmt(s.top_area, lenDigits), h('small', null, cm ? 'cm²' : 'px²')))),
    s.warnings.length ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
      h('span', { html: icons.warn, style: { display: 'contents' } }), h('div', { class: 'grow' }, s.warnings.map((w) => h('div', null, w)))) : null,
    h('h2', { class: 'section-title' }, '사용한 사진', h('small', null, `${views.length}장`)),
    h('div', { class: 'views-strip' }, views),
    h('p', { class: 'caption', style: { margin: '16px 4px 0' } },
      '여러 방향의 실루엣이 모두 겹치는 공간을 3D 영역으로 계산해요(시각 헐). 잎 사이의 오목한 빈 곳까지 채워지므로 실제 부피보다 크게 나와요. 같은 방식으로 찍은 측정끼리 변화율을 비교해 주세요.'),
    h('div', { class: 'cta' }, h('button', { class: 'btn btn-primary', onclick: back }, '식물로 돌아가기')),
  ].filter(Boolean));
}
