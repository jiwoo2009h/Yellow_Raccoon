// 분석 영역 지정: 사진에서 이 식물이 있는 곳만 사각형으로 지정하면
// 영역 밖의 초록색(옆 화분 잎, 배경 소품)은 분석에서 빠집니다.

import { api } from '../api.js';
import { h, icons, topbar, toast, goBack, confirmSheet, fmt, dateShort } from '../ui.js';

const MIN = 0.06;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export async function roiView({ id }) {
  const screen = document.getElementById('screen');
  const plant = await api.plant(id);
  const ms = plant.measurements;
  if (!ms.length) {
    screen.replaceChildren(topbar({ title: '분석 영역' }), h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.crop }),
      h('h2', null, '먼저 사진을 찍어 주세요'),
      h('p', null, '사진이 있어야 분석할 영역을 지정할 수 있어요.'),
      h('a', { class: 'btn btn-primary', href: `#/plant/${id}/capture` }, '사진 찍기')));
    return;
  }
  const m = ms[ms.length - 1];
  let r = plant.roi ? [...plant.roi] : [0.08, 0.06, 0.92, 0.94];

  const handles = ['nw', 'ne', 'sw', 'se'].map((c) => h('span', { class: `roi-handle ${c}`, dataset: { c } }));
  const box = h('div', { class: 'roi-box' }, ...handles);
  const img = h('img', { src: m.photo_url, alt: '분석 영역을 지정할 사진', draggable: 'false' });
  const stage = h('div', { class: 'calib roi-stage' }, img, box);
  const readout = h('div', { class: 'caption', style: { marginTop: '8px' } });

  function draw() {
    box.style.left = `${r[0] * 100}%`;
    box.style.top = `${r[1] * 100}%`;
    box.style.width = `${(r[2] - r[0]) * 100}%`;
    box.style.height = `${(r[3] - r[1]) * 100}%`;
    readout.textContent = `영역: 가로 ${fmt((r[2] - r[0]) * 100, 0)}% × 세로 ${fmt((r[3] - r[1]) * 100, 0)}% · 바깥의 초록색은 분석에서 빠져요`;
  }

  const point = (e) => {
    const rect = stage.getBoundingClientRect();
    return [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)];
  };

  let mode = null;
  let start = null;
  let startR = null;
  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = point(e);
    const c = e.target.dataset && e.target.dataset.c;
    startR = [...r];
    start = p;
    if (c) mode = c;
    else if (p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3]) mode = 'move';
    else { mode = 'new'; r = [p[0], p[1], p[0], p[1]]; }
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const p = point(e);
    const [x0, y0, x1, y1] = startR;
    if (mode === 'move') {
      const w = x1 - x0, hgt = y1 - y0;
      const nx = clamp(x0 + p[0] - start[0], 0, 1 - w);
      const ny = clamp(y0 + p[1] - start[1], 0, 1 - hgt);
      r = [nx, ny, nx + w, ny + hgt];
    } else if (mode === 'new') {
      r = [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.max(start[0], p[0]), Math.max(start[1], p[1])];
    } else {
      r = [...startR];
      if (mode.includes('w')) r[0] = Math.min(p[0], r[2] - MIN);
      if (mode.includes('e')) r[2] = Math.max(p[0], r[0] + MIN);
      if (mode.includes('n')) r[1] = Math.min(p[1], r[3] - MIN);
      if (mode.includes('s')) r[3] = Math.max(p[1], r[1] + MIN);
    }
    draw();
  });
  const end = () => {
    if (mode === 'new' && (r[2] - r[0] < MIN || r[3] - r[1] < MIN)) r = startR; // 너무 작게 그리면 취소
    mode = null;
    draw();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  async function save(roi) {
    try {
      await api.updatePlant(id, { roi });
      const ok = await confirmSheet({
        title: '지금까지 찍은 사진도 다시 분석할까요?',
        desc: roi ? '새 영역으로 모든 사진의 높이·폭·면적을 다시 계산해요. 그래프와 추천도 함께 바뀌어요.' : '영역 제한 없이 모든 사진을 다시 계산해요.',
        ok: '다시 분석',
      });
      if (ok) {
        toast('다시 분석하는 중이에요…');
        const res = await api.reanalyze(id);
        toast(`${res.ok}장을 다시 분석했어요${res.failed ? ` (${res.failed}장은 영역 안에서 식물을 못 찾음)` : ''}`);
      } else toast(roi ? '분석 영역을 저장했어요' : '분석 영역을 해제했어요');
      goBack(`#/plant/${id}`);
    } catch (err) { toast(err.message, { error: true }); }
  }

  screen.replaceChildren(
    topbar({ title: '분석 영역' }),
    h('section', { class: 'card', style: { marginTop: '4px', marginBottom: '12px' } },
      h('h2', { class: 'card-title' }, '이 식물이 있는 곳만 지정하세요'),
      h('p', { class: 'card-sub', style: { margin: 0 } }, '사각형을 끌어 옮기거나 모서리로 크기를 바꾸세요. 빈 곳을 끌면 새로 그려요. 옆 화분 잎이나 초록색 소품이 섞일 때 쓰면 좋아요.')),
    stage,
    readout,
    h('p', { class: 'caption', style: { margin: '4px 4px 0' } }, `${dateShort(m.taken_at)} 사진 · 같은 위치에서 찍은 모든 사진에 같은 영역이 적용돼요.`),
    plant.roi ? h('button', { class: 'btn btn-text', style: { marginTop: '8px' }, onclick: () => save(null) }, '영역 해제') : null,
    h('div', { class: 'cta' }, h('button', { class: 'btn btn-primary', onclick: () => save(r.map((v) => Math.round(v * 10000) / 10000)) }, '영역 저장')));
  if (img.complete) draw(); else img.addEventListener('load', draw);
  draw();
}
