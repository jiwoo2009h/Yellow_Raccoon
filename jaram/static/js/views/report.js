import { api } from '../api.js';
import { h, icons, fmt, signed, statusBadge, segmented, skeleton } from '../ui.js';
import { lineChart } from '../chart.js';

export async function reportView() {
  const screen = document.getElementById('screen');
  const head = h('div', { class: 'page-head' }, h('div', null,
    h('h1', { class: 'large-title' }, '리포트'),
    h('p', { class: 'subtitle' }, '식물별 생장을 한눈에 비교해요')));
  screen.append(head, skeleton(300, 16), skeleton(200));
  const [data, val] = await Promise.all([api.report(), api.validation().catch(() => null)]);
  const plants = data.plants;
  screen.replaceChildren(head);

  if (!plants.some((p) => p.points.length >= 2)) {
    screen.append(h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.chart }),
      h('h2', null, '아직 비교할 기록이 부족해요'),
      h('p', null, '식물마다 사진이 2장 이상 쌓이면 생장 곡선을 비교할 수 있어요.')));
    screen.append(exportCard());
    return;
  }

  // ------------------------------------------------------------ 상대 생장 곡선
  let metric = 'area';
  const chartBox = h('div', { style: { marginTop: '16px' } });
  const colorOf = (i) => `var(--series-${(i % 8) + 1})`;
  const draw = () => {
    const series = plants.map((p, i) => ({
      name: p.name,
      color: colorOf(i),
      points: p.points.map((pt) => ({ x: Math.round(pt.day * 10) / 10, y: metric === 'area' ? pt.area_pct : pt.height_pct })),
    }));
    chartBox.replaceChildren(lineChart({
      series,
      xTick: (x) => `${fmt(x, 0)}일`,
      tipTitle: (x) => `시작 후 ${fmt(x, 1)}일`,
      yFormat: (v) => `${signed(v, 0)}%`,
      yZero: true,
      height: 240,
      ariaLabel: `식물별 ${metric === 'area' ? '투영 면적' : '높이'} 변화율 비교 그래프`,
      tableHead: '경과일',
    }));
  };
  screen.append(h('h2', { class: 'section-title' }, '생장 곡선'),
    h('section', { class: 'card' },
      h('p', { class: 'card-sub', style: { marginBottom: '12px' } }, '첫 사진을 0%로 놓고 얼마나 커졌는지 비교해요. 크기가 다른 식물도 같은 기준으로 볼 수 있어요.'),
      segmented([['area', '투영 면적'], ['height', '높이']], metric, (v) => { metric = v; draw(); }),
      chartBox));
  draw();

  // ------------------------------------------------------------ 3D 부피 곡선
  if (plants.some((p) => (p.scans || []).length >= 2)) {
    screen.append(h('h2', { class: 'section-title' }, '3D 부피 곡선'),
      h('section', { class: 'card' },
        h('p', { class: 'card-sub', style: { marginBottom: '12px' } }, '여러 각도로 찍은 3D 측정의 부피를 첫 측정 대비 %로 비교해요. 잎이 앞뒤로 자라는 변화까지 반영돼요.'),
        lineChart({
          series: plants.map((p, i) => ({
            name: p.name, color: colorOf(i),
            points: (p.scans || []).map((sc) => ({ x: Math.round(sc.day * 10) / 10, y: sc.volume_pct })),
          })),
          xTick: (x) => `${fmt(x, 0)}일`,
          tipTitle: (x) => `첫 3D 측정 후 ${fmt(x, 1)}일`,
          yFormat: (v) => `${signed(v, 0)}%`,
          yZero: true,
          height: 220,
          ariaLabel: '식물별 3D 부피 변화율 비교 그래프',
          tableHead: '경과일',
        }),
        h('a', { class: 'btn btn-text', href: '/api/export_scans.csv', download: '', style: { marginTop: '4px' } }, '3D 측정 CSV 받기')));
  }

  // ------------------------------------------------------------ 식물별 요약
  screen.append(h('h2', { class: 'section-title' }, '식물별 요약'));
  screen.append(h('div', { class: 'list' }, plants.map((p, i) => {
    const total = p.summary?.total;
    const recent = p.summary?.recent?.area?.pct_per_day;
    return h('a', { class: 'list-item', href: `#/plant/${p.id}` },
      h('span', { style: { width: '14px', height: '3px', borderRadius: '2px', background: colorOf(i), flex: 'none' }, 'aria-hidden': 'true' }),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, p.name, h('span', { class: 'muted', style: { fontWeight: 500, fontSize: '14px' } }, ` · ${p.species_label}`)),
        h('div', { class: 'meta' },
          `사진 ${p.points.length}장`,
          total?.area_pct !== null && total?.area_pct !== undefined ? ` · 면적 ${signed(total.area_pct, 0)}%` : '',
          recent !== null && recent !== undefined ? ` · 최근 ${signed(recent)}%/일` : '')),
      statusBadge(p.status, p.status_label));
  })));

  // ------------------------------------------------------------ 추천 효과 검증
  if (val && val.summary.occurrences) {
    const v = val.summary;
    const pctText = (x) => (x === null || x === undefined ? '–' : `${fmt(x * 100, 0)}%`);
    screen.append(h('h2', { class: 'section-title' }, '추천 효과 검증'),
      h('a', { class: 'card card-link', href: '#/report/validation' },
        h('div', { class: 'grow' },
          h('div', { class: 'card-title', style: { margin: 0 } }, '추천을 따르면 나아졌을까요?'),
          h('p', { class: 'card-sub', style: { margin: '4px 0 0' } },
            `추천 ${v.occurrences}건 · 행동 추천 따른 비율 ${pctText(v.follow_rate)} · 관리 필요 → 회복 ${pctText(v.care_recovered)}`)),
        h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } })));
  }

  // ------------------------------------------------------------ 분석 정확도
  const acc = data.accuracy;
  screen.append(h('h2', { class: 'section-title' }, '영상 분석 정확도'));
  if (acc.height || acc.width) {
    const tile = (label, a) => h('div', { class: 'stat', style: { background: 'var(--surface-2)' } },
      h('div', { class: 'stat-label' }, `${label} 평균 오차`),
      a ? h('div', { class: 'stat-value' }, fmt(a.mae, 2), h('small', null, 'cm')) : h('div', { class: 'stat-value' }, '–'),
      a ? h('div', { class: 'stat-delta muted' }, `${fmt(a.mape, 1)}% · ${a.n}회 비교`) : null);
    screen.append(h('section', { class: 'card' },
      h('p', { class: 'card-sub', style: { marginBottom: '14px' } }, '자로 직접 잰 값과 사진 분석 값을 비교했어요. 오차가 크면 HSV 범위나 촬영 위치를 조정해 보세요.'),
      h('div', { class: 'stats' }, tile('높이', acc.height), tile('폭', acc.width)),
      h('details', { class: 'table-toggle' }, h('summary', null, '비교 기록 보기'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '식물'), h('th', null, '날짜'), h('th', { class: 'r' }, '높이(사진/자)'), h('th', { class: 'r' }, '폭(사진/자)'))),
          h('tbody', null, acc.items.map((it) => h('tr', null,
            h('td', null, it.plant), h('td', null, it.taken_at.slice(5, 10).replace('-', '.')),
            h('td', { class: 'r' }, `${fmt(it.height_image)} / ${fmt(it.height_manual)}`),
            h('td', { class: 'r' }, `${fmt(it.width_image)} / ${fmt(it.width_manual)}`)))))))));
  } else {
    screen.append(h('div', { class: 'card' }, h('p', { class: 'card-sub' },
      '사진을 찍은 날 자로 높이·폭을 직접 재서 입력하면, 영상 분석이 얼마나 정확한지 여기서 확인할 수 있어요. (크기 보정을 먼저 해 주세요)')));
  }

  screen.append(exportCard());
}

function exportCard() {
  return h('div', null,
    h('h2', { class: 'section-title' }, '데이터 내보내기'),
    h('section', { class: 'card' },
      h('p', { class: 'card-sub', style: { marginBottom: '16px' } },
        '날짜·식물 ID·높이·폭·투영 면적·생장률·온도·습도·토양 수분·조도·관리 행동이 한 표로 정리돼요. 엑셀이나 pandas로 바로 열 수 있어요.'),
      h('a', { class: 'btn btn-secondary btn-md', href: '/api/export.csv', download: '' },
        h('span', { html: icons.download, style: { display: 'contents' } }), 'CSV 파일 받기')));
}
