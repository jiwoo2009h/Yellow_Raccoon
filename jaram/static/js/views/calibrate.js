// 크기 보정: 사진 속 자의 두 눈금을 찍고 실제 길이를 입력하면 1픽셀이 몇 cm 인지 계산합니다.
// (계획서 '파. 픽셀 크기와 실제 크기의 환산')

import { api } from '../api.js';
import { h, icons, topbar, field, numberInput, toast, fmt, goBack, confirmSheet, dateShort } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';

export async function calibrateView({ id }) {
  const screen = document.getElementById('screen');
  const plant = await api.plant(id);
  const ms = plant.measurements;
  if (!ms.length) {
    screen.replaceChildren(topbar({ title: '크기 보정' }), h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.ruler }),
      h('h2', null, '먼저 사진을 찍어 주세요'),
      h('p', null, '자가 함께 나온 사진이 있어야 보정할 수 있어요.'),
      h('a', { class: 'btn btn-primary', href: `#/plant/${id}/capture` }, '사진 찍기')));
    return;
  }
  const cal = plant.calibration;
  const m = ms.find((x) => x.id === cal?.measurement_id) || ms[ms.length - 1];
  const W = m.img_w;
  const H = m.img_h;
  const pts = cal ? [{ x: cal.x1, y: cal.y1 }, { x: cal.x2, y: cal.y2 }] : [];

  const img = h('img', { src: m.photo_url, alt: '보정할 사진', draggable: 'false' });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'marks');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const loupe = h('div', { class: 'loupe', hidden: true });
  const stage = h('div', { class: 'calib' }, img, svg, loupe);
  const step = h('p', { class: 'card-sub', style: { margin: 0 } });
  const readout = h('div', { class: 'caption', style: { marginTop: '8px' } });
  const lengthInput = numberInput({ name: 'length', unit: 'cm', value: cal?.length_cm ?? 10, placeholder: '10' });

  const scale = () => stage.getBoundingClientRect().width / W;

  function draw() {
    svg.replaceChildren();
    const r = 9 / Math.max(scale(), 0.01);
    if (pts.length === 2) {
      const line = document.createElementNS(NS, 'line');
      Object.entries({ x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y, stroke: '#ff3b30', 'stroke-width': 2.5 / scale(), 'stroke-linecap': 'round' })
        .forEach(([k, v]) => line.setAttribute(k, v));
      svg.appendChild(line);
    }
    pts.forEach((p) => {
      const c = document.createElementNS(NS, 'circle');
      Object.entries({ cx: p.x, cy: p.y, r, fill: '#ff3b30', stroke: '#fff', 'stroke-width': 3 / scale() }).forEach(([k, v]) => c.setAttribute(k, v));
      svg.appendChild(c);
    });
    step.textContent = pts.length === 0 ? '① 자의 한쪽 눈금(예: 0cm)을 탭하세요.'
      : pts.length === 1 ? '② 다른 쪽 눈금(예: 10cm)을 탭하세요.'
        : '점을 끌어서 눈금에 정확히 맞춘 뒤, 두 점 사이의 실제 길이를 입력하세요.';
    if (pts.length === 2) {
      const px = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const len = Number(lengthInput.querySelector('input').value);
      readout.textContent = len > 0 ? `두 점 사이 ${fmt(px, 0)}px → 1cm = ${fmt(px / len, 1)}px` : `두 점 사이 ${fmt(px, 0)}px`;
    } else readout.textContent = '';
    saveBtn.disabled = pts.length !== 2;
  }

  function toImage(e) {
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W, ((e.clientX - rect.left) / rect.width) * W)),
      y: Math.max(0, Math.min(H, ((e.clientY - rect.top) / rect.height) * H)),
    };
  }

  function showLoupe(p) {
    const s = scale();
    const zoom = 3;
    const size = 112;
    loupe.hidden = false;
    loupe.style.left = p.x * s + 'px';
    loupe.style.top = p.y * s + 'px';
    loupe.style.backgroundImage = `url("${m.photo_url}")`;
    loupe.style.backgroundSize = `${W * s * zoom}px ${H * s * zoom}px`;
    loupe.style.backgroundPosition = `${-(p.x * s * zoom - size / 2)}px ${-(p.y * s * zoom - size / 2)}px`;
  }

  let active = null;
  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = toImage(e);
    const near = pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) * scale() < 32);
    if (near >= 0) active = near;
    else if (pts.length < 2) { pts.push(p); active = pts.length - 1; }
    else {
      active = Math.hypot(pts[0].x - p.x, pts[0].y - p.y) < Math.hypot(pts[1].x - p.x, pts[1].y - p.y) ? 0 : 1;
      pts[active] = p;
    }
    stage.setPointerCapture(e.pointerId);
    showLoupe(pts[active]);
    draw();
  });
  stage.addEventListener('pointermove', (e) => {
    if (active === null) return;
    pts[active] = toImage(e);
    showLoupe(pts[active]);
    draw();
  });
  const end = () => { active = null; loupe.hidden = true; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  lengthInput.querySelector('input').addEventListener('input', draw);

  const saveBtn = h('button', {
    class: 'btn btn-primary', disabled: true,
    onclick: async () => {
      try {
        await api.updatePlant(id, { calibration: {
          x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y,
          length_cm: Number(lengthInput.querySelector('input').value), measurement_id: m.id,
        } });
        toast('크기 보정을 저장했어요. 이제 cm 단위로 보여요');
        goBack(`#/plant/${id}`);
      } catch (err) { toast(err.message, { error: true }); }
    },
  }, '보정 저장');

  screen.replaceChildren(
    topbar({ title: '크기 보정' }),
    h('section', { class: 'card', style: { marginTop: '4px', marginBottom: '12px' } },
      h('h2', { class: 'card-title' }, '사진 속 자로 cm 단위 맞추기'),
      step),
    stage,
    h('p', { class: 'caption', style: { margin: '8px 4px 0' } }, `${dateShort(m.taken_at)} 사진 · 같은 위치·거리에서 찍은 모든 사진에 같은 비율이 적용돼요.`),
    h('section', { class: 'card', style: { marginTop: '12px' } },
      field('두 점 사이의 실제 길이', lengthInput),
      readout,
      cal ? h('button', {
        class: 'btn btn-text', style: { marginTop: '8px' },
        onclick: async () => {
          const ok = await confirmSheet({ title: '보정을 해제할까요?', desc: '다시 픽셀 단위로 표시돼요.', ok: '해제' });
          if (!ok) return;
          await api.updatePlant(id, { calibration: null });
          toast('보정을 해제했어요');
          goBack(`#/plant/${id}`);
        },
      }, '보정 해제') : null),
    h('div', { class: 'cta' }, saveBtn));

  if (img.complete) draw(); else img.addEventListener('load', draw);
  const ro = new ResizeObserver(draw);
  ro.observe(stage);
  return { cleanup: () => ro.disconnect() };
}
