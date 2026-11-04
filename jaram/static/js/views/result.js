import { api } from '../api.js';
import {
  h, icons, topbar, fmt, deltaEl, areaUnit, dateTime, daysText, segmented, field, numberInput, skeleton, toast,
  confirmSheet, toLocalInput, formValues, timeShort, statusBadge, parseDate,
} from '../ui.js';

export async function resultView({ id }) {
  const screen = document.getElementById('screen');
  const isNew = new URLSearchParams(location.hash.split('?')[1] || '').get('new') === '1';
  screen.append(topbar({ title: '분석 결과' }), skeleton(420, 8), skeleton(160));
  const data = await api.measurement(id);
  const { measurement: m, previous: prev, plant } = data;
  const unit = plant.unit;
  const digits = unit === 'cm' ? 1 : 0;
  let mode = 'overlay';

  // ------------------------------------------------------------ 분석 이미지 + 높이·폭 표시
  const img = h('img', { src: m.overlay_url, alt: '식물 영역 분석 결과' });
  const [bx, by, bw, bh] = m.bbox || [0, 0, 0, 0];
  const box = h('div', {
    class: 'measure-box',
    style: { left: `${(bx / m.img_w) * 100}%`, top: `${(by / m.img_h) * 100}%`, width: `${(bw / m.img_w) * 100}%`, height: `${(bh / m.img_h) * 100}%` },
  },
  h('span', { class: 'mh' }, `높이 ${fmt(m.height, digits)}${unit}`),
  h('span', { class: 'mw' }, `폭 ${fmt(m.width, digits)}${unit}`));
  // 라벨이 사진 밖으로 나가면 상자 안쪽으로 옮김
  if (bx / m.img_w < 0.2) box.querySelector('.mh').style.cssText = 'left:8px;transform:translateY(-50%)';
  if (by / m.img_h < 0.06) box.querySelector('.mw').style.cssText = 'top:8px;transform:translateX(-50%)';
  const heroEl = h('div', { class: 'result-hero', style: { marginTop: '4px' } }, img, box,
    h('div', { style: { position: 'absolute', left: '12px', bottom: '12px' } },
      segmented([['overlay', '분석'], ['photo', '원본']], mode, (v) => {
        mode = v;
        img.src = v === 'overlay' ? m.overlay_url : m.photo_url;
        box.hidden = v !== 'overlay';
      }, 'glass-seg')));

  // ------------------------------------------------------------ 변화 요약
  let summary;
  if (prev) {
    const pct = m.delta?.area_pct;
    const days = m.delta?.days;
    const word = pct === null || pct === undefined ? '' : Math.abs(pct) < 1 ? '거의 같아요' : pct > 0 ? `${fmt(pct)}% 늘었어요` : `${fmt(-pct)}% 줄었어요`;
    summary = h('section', { class: 'card', style: { marginTop: '12px' } },
      h('p', { class: 'caption', style: { margin: '0 0 4px' } }, `지난 기록(${daysText(days)} 전)과 비교`),
      h('h2', { class: 'big-delta' }, `투영 면적이 ${word}`),
      h('div', { class: 'compare-stats', style: { marginTop: '18px' } },
        h('div', null, h('div', { class: 'k' }, '높이'), h('div', { class: 'v' }, fmt(m.height, digits), h('small', { class: 'muted', style: { fontSize: '13px' } }, unit)),
          h('div', { class: 'caption' }, deltaEl(m.delta?.height, { digits, suffix: unit }))),
        h('div', null, h('div', { class: 'k' }, '폭'), h('div', { class: 'v' }, fmt(m.width, digits), h('small', { class: 'muted', style: { fontSize: '13px' } }, unit)),
          h('div', { class: 'caption' }, deltaEl(m.delta?.width, { digits, suffix: unit }))),
        h('div', null, h('div', { class: 'k' }, '투영 면적'), h('div', { class: 'v' }, fmt(m.area, digits), h('small', { class: 'muted', style: { fontSize: '13px' } }, areaUnit(unit))),
          h('div', { class: 'caption' }, deltaEl(m.delta?.area_pct, { suffix: '%' })))),
      m.delta?.area_pct_per_day !== null && m.delta?.area_pct_per_day !== undefined
        ? h('p', { class: 'caption', style: { margin: '16px 0 0', textAlign: 'center' } }, `생장률 ${fmt(m.delta.area_pct_per_day)}%/일 = 면적 변화 ÷ ${daysText(days)}`)
        : null);
  } else {
    summary = h('section', { class: 'card', style: { marginTop: '12px' } },
      h('h2', { class: 'big-delta' }, '기준 사진을 저장했어요'),
      h('p', { class: 'status-body' }, '다음 촬영부터 이 사진과 비교해서 얼마나 자랐는지 알려드릴게요.'),
      h('div', { class: 'compare-stats', style: { marginTop: '16px' } },
        h('div', null, h('div', { class: 'k' }, '높이'), h('div', { class: 'v' }, `${fmt(m.height, digits)}${unit}`)),
        h('div', null, h('div', { class: 'k' }, '폭'), h('div', { class: 'v' }, `${fmt(m.width, digits)}${unit}`)),
        h('div', null, h('div', { class: 'k' }, '투영 면적'), h('div', { class: 'v' }, `${fmt(m.area, digits)}${areaUnit(unit)}`))));
  }

  const warnings = m.warnings?.length
    ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
      h('span', { html: icons.warn, style: { display: 'contents' } }),
      h('div', { class: 'grow' }, m.warnings.map((w) => h('div', null, w))))
    : null;

  // ------------------------------------------------------------ 환경·직접 측정 입력
  const env = m.env || {};
  const sug = !m.env && data.suggest_env ? data.suggest_env : null;
  const val = (k) => env[k] ?? (sug && k !== 'soil' ? sug[k] : null);
  const form = h('form', { class: 'card', style: { marginTop: '12px' }, onsubmit: (e) => { e.preventDefault(); save(); } },
    h('h2', { class: 'card-title' }, '환경 기록'),
    h('p', { class: 'card-sub', style: { marginBottom: '16px' } }, '생장 변화와 환경을 함께 보고 관리 방법을 추천해요. 모르는 값은 비워 두세요.'),
    sug ? h('div', { class: 'notice accent', style: { marginBottom: '16px' } },
      h('span', { html: icons.info, style: { display: 'contents' } }),
      h('span', { class: 'grow' }, `같은 챔버에서 ${timeShort(sug.at)}에 기록한 온도·습도·조도를 불러왔어요.`)) : null,
    h('div', { class: 'field-row' },
      field('온도', numberInput({ name: 'temp', unit: '℃', value: val('temp') })),
      field('습도', numberInput({ name: 'humidity', unit: '%', value: val('humidity') }))),
    h('div', { class: 'field-row' },
      field('토양 수분', numberInput({ name: 'soil', unit: '%', value: val('soil') })),
      field('조도', numberInput({ name: 'lux', unit: 'lux', value: val('lux') }))),
    h('h2', { class: 'card-title', style: { marginTop: '28px' } }, '직접 측정 (선택)'),
    h('p', { class: 'card-sub', style: { marginBottom: '16px' } }, '자로 잰 값을 넣으면 리포트에서 영상 분석의 오차를 확인할 수 있어요.'),
    h('div', { class: 'field-row' },
      field('높이', numberInput({ name: 'manual_height_cm', unit: 'cm', value: m.manual_height_cm })),
      field('폭', numberInput({ name: 'manual_width_cm', unit: 'cm', value: m.manual_width_cm }))),
    h('div', { class: 'field-row' },
      field('잎 수', numberInput({ name: 'leaf_count', unit: '장', value: m.leaf_count, step: 1 })),
      h('span')),
    h('div', { style: { height: '16px' } }),
    field('메모', h('input', { class: 'input', name: 'note', value: m.note ?? '', maxlength: 300, placeholder: '예: 새 잎 2장 나옴' })),
    h('div', { style: { height: '16px' } }),
    field('촬영 시각', h('input', { class: 'input', type: 'datetime-local', name: 'taken_at', value: toLocalInput(m.taken_at) })));

  async function save() {
    const v = formValues(form);
    const btn = screen.querySelector('.cta .btn-primary');
    if (btn) btn.disabled = true;
    try {
      await api.updateMeasurement(m.id, {
        env: { temp: v.temp, humidity: v.humidity, soil: v.soil, lux: v.lux },
        manual_height_cm: v.manual_height_cm,
        manual_width_cm: v.manual_width_cm,
        leaf_count: v.leaf_count,
        note: v.note,
        taken_at: v.taken_at,
      });
      toast(isNew ? '기록을 저장했어요' : '수정했어요');
      location.hash = `#/plant/${plant.id}`;
    } catch (err) {
      toast(err.message, { error: true });
      if (btn) btn.disabled = false;
    }
  }

  async function remove(andRetake) {
    if (!andRetake) {
      const ok = await confirmSheet({ title: '이 기록을 지울까요?', desc: '사진과 분석 결과가 함께 지워져요.', ok: '지우기', danger: true });
      if (!ok) return;
    }
    await api.deleteMeasurement(m.id);
    if (andRetake) location.replace(`#/plant/${plant.id}/capture`);
    else { toast('기록을 지웠어요'); location.hash = `#/plant/${plant.id}`; }
  }

  const status = h('div', { class: 'notice', style: { marginTop: '12px', alignItems: 'center' } },
    statusBadge(plant.status, plant.status_label),
    h('span', { class: 'grow' }, plant.headline || ''));

  screen.replaceChildren(...[
    topbar({
      title: isNew ? `${plant.name} 분석 결과` : dateTime(m.taken_at),
      onBack: () => { location.hash = `#/plant/${plant.id}`; },
      right: h('button', { class: 'icon-btn', 'aria-label': '기록 삭제', html: icons.trash, onclick: () => remove(false) }),
    }),
    heroEl, warnings, summary,
    isNew ? null : status,
    form,
    h('p', { class: 'footer-note' }, `${plant.name} · ${parseDate(m.taken_at).toLocaleDateString('ko-KR')} · ${data.index + 1}번째 기록`),
    h('div', { class: 'cta' }, isNew
      ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-secondary', style: { flex: '0 0 34%' }, onclick: () => remove(true) }, '다시 찍기'),
        h('button', { class: 'btn btn-primary', onclick: () => save() }, '저장하기'))
      : h('button', { class: 'btn btn-primary', onclick: () => save() }, '저장하기')),
  ].filter(Boolean));
}
