// 날짜 축 선 그래프 (외부 라이브러리 없음)
// - x축: 날짜(시각), 왼쪽 y축 1개 + 오른쪽 y축 최대 2개 (예: 생장률 + 온도℃ + 습도%)
// - 점선 기준선, 강조 구간(빨간 배경), 누르거나 마우스를 올리면 세로선 + 값 툴팁

import { h, fmt } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

export function niceTicks(min, max, count = 3) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

/**
 * series: [{ name, color, points: [{ t(ms), y }], axis: 'left' | 'r1' | 'r2', dashed, unit, digits }]
 * axes:   { left: { unit, digits, zero }, r1: { unit, color, digits }, r2: { ... } }
 * refLine: { y, axis }   bands: [{ from(ms), to(ms) }]
 */
export function timeChart({ series, axes = {}, refLine, bands = [], height = 160, ariaLabel = '그래프', empty = '기록이 2개 이상 쌓이면 그래프가 그려져요.' }) {
  const root = h('div', { class: 'chart' });
  const valid = series.filter((sr) => sr.points.filter((p) => p.y !== null && p.y !== undefined).length);
  const leftPts = valid.filter((sr) => (sr.axis || 'left') === 'left').flatMap((sr) => sr.points);
  if (leftPts.length < 2) {
    root.appendChild(h('div', { class: 'chart-empty' }, empty));
    return root;
  }
  const rightIds = ['r1', 'r2'].filter((id) => valid.some((sr) => sr.axis === id));

  const W = 320;
  const padL = 30;
  const padR = rightIds.length ? 8 + rightIds.length * 28 : 10;
  const padT = 8;
  const padB = 22;
  const H = height;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allT = valid.flatMap((sr) => sr.points.map((p) => p.t));
  let t0 = Math.min(...allT);
  let t1 = Math.max(...allT);
  if (t1 - t0 < DAY) { t0 -= DAY / 2; t1 += DAY / 2; }
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * plotW;

  const scale = {};
  for (const id of ['left', ...rightIds]) {
    const ys = valid.filter((sr) => (sr.axis || 'left') === id).flatMap((sr) => sr.points.map((p) => p.y)).filter((v) => v !== null && v !== undefined);
    if (id === 'left' && refLine && (refLine.axis || 'left') === 'left') ys.push(refLine.y);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (axes[id]?.zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    const minSpan = axes[id]?.minSpan || 0; // 값이 거의 일정해도 축이 너무 좁아지지 않도록
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.06;
    // 0에서 시작하는 축은 0 아래로 늘리지 않음
    const ticks = niceTicks(axes[id]?.zero && lo >= 0 ? lo : lo - pad, hi + pad, 3);
    const a = ticks[0];
    const b = ticks[ticks.length - 1];
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    // 눈금 간격에 맞춰 소수 자리를 정해 같은 숫자가 겹쳐 보이지 않게
    const digits = Math.max(axes[id]?.digits ?? 1, step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
    scale[id] = { ticks, digits, y: (v) => padT + plotH - ((v - a) / (b - a || 1)) * plotH };
  }

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });
  // 강조 구간
  for (const band of bands) {
    const a = Math.max(t0, band.from);
    const b = Math.min(t1, band.to ?? t1);
    if (b > a) svg.appendChild(s('rect', { class: 'highlight', x: x(a), y: padT - 4, width: Math.max(2, x(b) - x(a)), height: plotH + 8, rx: 6 }));
  }
  // 눈금선 + 왼쪽 축
  const grid = s('g', { class: 'grid' });
  const L = scale.left;
  for (const v of L.ticks) {
    grid.appendChild(s('line', { x1: padL, x2: W - padR, y1: L.y(v), y2: L.y(v) }));
    svg.appendChild(s('text', { class: 'tick', x: padL - 6, y: L.y(v) + 3.5, 'text-anchor': 'end' }, fmt(v, L.digits)));
  }
  svg.prepend(grid);
  // 오른쪽 축
  rightIds.forEach((id, i) => {
    const R = scale[id];
    const ax = W - padR + 6 + i * 28;
    const cls = axes[id]?.cls ? `tick ${axes[id].cls}` : 'tick';
    for (const v of R.ticks) svg.appendChild(s('text', { class: cls, x: ax, y: R.y(v) + 3.5 }, fmt(v, R.digits)));
    svg.appendChild(s('text', { class: `${cls} axis-unit`, x: ax, y: H - 6 }, axes[id]?.unit || ''));
  });
  // x축 날짜 (최대 5개)
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    svg.appendChild(s('text', { class: 'tick', x: x(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, md(t)));
  }
  // 기준선
  if (refLine) {
    const R = scale[refLine.axis || 'left'];
    svg.appendChild(s('line', { class: 'ref-line', x1: padL, x2: W - padR, y1: R.y(refLine.y), y2: R.y(refLine.y) }));
  }
  // 선
  for (const sr of valid) {
    const R = scale[sr.axis || 'left'];
    const pts = sr.points.filter((p) => p.y !== null && p.y !== undefined).sort((a, b) => a.t - b.t);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${R.y(p.y).toFixed(1)}`).join('');
    svg.appendChild(s('path', { class: 'series-line' + (sr.dashed ? ' dashed' : ''), d, stroke: sr.color, 'stroke-width': sr.width || 2 }));
    if (pts.length <= 24 && !sr.noDots) {
      for (const p of pts) svg.appendChild(s('circle', { cx: x(p.t), cy: R.y(p.y), r: 2.2, fill: sr.color }));
    }
  }

  // 툴팁
  const cross = s('line', { class: 'crosshair', y1: padT, y2: padT + plotH, visibility: 'hidden' });
  svg.appendChild(cross);
  const wrap = h('div', { style: { position: 'relative' } }, svg);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  wrap.appendChild(tip);
  root.appendChild(wrap);

  const times = [...new Set(valid.flatMap((sr) => sr.points.map((p) => p.t)))].sort((a, b) => a - b);
  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const t = t0 + ((px - padL) / plotW) * (t1 - t0);
    let best = times[0];
    for (const v of times) if (Math.abs(v - t) < Math.abs(best - t)) best = v;
    cross.setAttribute('x1', x(best));
    cross.setAttribute('x2', x(best));
    cross.setAttribute('visibility', 'visible');
    const rows = [];
    for (const sr of valid) {
      let near = null;
      for (const p of sr.points) {
        if (p.y === null || p.y === undefined) continue;
        if (Math.abs(p.t - best) <= DAY / 2 && (!near || Math.abs(p.t - best) < Math.abs(near.t - best))) near = p;
      }
      if (near) {
        rows.push(h('div', { class: 'row' }, h('i', { class: 'key', style: { background: sr.color } }),
          h('span', { class: 'name' }, sr.name), h('span', { class: 'val' }, `${fmt(near.y, sr.digits ?? 1)}${sr.unit || ''}`)));
      }
    }
    const d = new Date(best);
    tip.replaceChildren(h('div', { class: 't' }, `${d.getMonth() + 1}월 ${d.getDate()}일`), ...rows);
    tip.hidden = false;
    const left = (x(best) / W) * box.width;
    tip.style.left = `${Math.min(Math.max(0, left - 60), box.width - 130)}px`;
    tip.style.top = '-8px';
    tip.style.transform = 'translateY(-100%)';
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
  return root;
}

/** 이동 평균 (null 값은 건너뜀) */
export function movingAverage(values, n = 3) {
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v !== null && v !== undefined);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}
