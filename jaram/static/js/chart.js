// 가벼운 SVG 선 그래프 (외부 라이브러리 없음)
// - 선 2px, 끝점 8px + 배경색 테두리, 옅은 영역(10%), 가는 눈금선
// - 누르거나 마우스를 올리면 세로 기준선 + 모든 시리즈 값을 보여 주는 툴팁
// - 시리즈 2개 이상이면 범례 + (겹치지 않을 때) 선 끝 이름표, '표로 보기' 제공

import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/**
 * series: [{ name, color, points: [{ x, y }] }]
 * xTick(x) / tipTitle(x): x 값을 글자로
 * yFormat(y): y 값을 글자로 (눈금·툴팁·끝 라벨)
 */
export function lineChart({ series, xTick, tipTitle, yFormat, height = 200, yZero = false, area, ariaLabel, tableHead }) {
  const root = h('div', { class: 'chart' });
  const valid = series.filter((sr) => sr.points.length);
  if (!valid.length || valid.every((sr) => sr.points.length < 2)) {
    root.appendChild(h('div', { class: 'chart-empty' }, '기록이 2개 이상 쌓이면 그래프가 그려져요.'));
    return root;
  }
  const multi = series.length > 1;
  const showArea = area ?? !multi;
  if (multi) {
    root.appendChild(h('div', { class: 'legend' }, series.map((sr) =>
      h('span', null, h('i', { style: { background: sr.color } }), sr.name))));
  }
  const svgWrap = h('div', { style: { position: 'relative' } });
  root.appendChild(svgWrap);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  svgWrap.appendChild(tip);

  const allX = [...new Set(valid.flatMap((sr) => sr.points.map((p) => p.x)))].sort((a, b) => a - b);
  const ys = valid.flatMap((sr) => sr.points.map((p) => p.y)).filter((y) => y !== null && y !== undefined);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yZero) { yMin = Math.min(0, yMin); yMax = Math.max(0, yMax); }
  const pad = (yMax - yMin || Math.abs(yMax) || 1) * 0.08;
  const ticks = niceTicks(yMin - (yZero && yMin === 0 ? 0 : pad), yMax + pad);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x0 = allX[0];
  const x1 = allX[allX.length - 1] === x0 ? x0 + 1 : allX[allX.length - 1];

  let svg;
  let state = null;

  function render(width) {
    const tickLabels = ticks.map(yFormat);
    const left = Math.max(...tickLabels.map((t) => t.length)) * 6.6 + 10;
    const endLabelW = multi ? Math.min(64, Math.max(...series.map((sr) => sr.name.length)) * 12 + 14) : 52;
    const right = endLabelW;
    const top = 12;
    const bottom = 26;
    const W = Math.max(240, width);
    const H = height;
    const pw = W - left - right;
    const ph = H - top - bottom;
    const X = (x) => left + ((x - x0) / (x1 - x0)) * pw;
    const Y = (y) => top + (1 - (y - y0) / (y1 - y0)) * ph;

    svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: '0', 'aria-label': ariaLabel || '그래프' });
    const grid = s('g', { class: 'grid' });
    ticks.forEach((t, i) => {
      if (i > 0) grid.appendChild(s('line', { x1: left, x2: W - right + 8, y1: Y(t), y2: Y(t) }));
      svg.appendChild(s('text', { class: 'tick', x: left - 8, y: Y(t) + 4, 'text-anchor': 'end' }, tickLabels[i]));
    });
    svg.appendChild(grid);
    svg.appendChild(s('line', { class: 'baseline', x1: left, x2: W - right + 8, y1: Y(y0), y2: Y(y0) }));

    // x 눈금: 처음, 가운데, 끝 (겹치지 않게)
    const xt = allX.length <= 3 ? allX : [allX[0], allX[Math.floor((allX.length - 1) / 2)], allX[allX.length - 1]];
    xt.forEach((x, i) => {
      const anchor = i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle';
      svg.appendChild(s('text', { class: 'tick', x: X(x), y: H - 6, 'text-anchor': allX.length === 1 ? 'middle' : anchor }, xTick(x)));
    });

    const ends = [];
    valid.forEach((sr) => {
      const pts = sr.points.filter((p) => p.y !== null && p.y !== undefined);
      if (!pts.length) return;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      if (showArea && pts.length > 1) {
        const a = `${d}L${X(pts[pts.length - 1].x).toFixed(1)},${Y(y0)}L${X(pts[0].x).toFixed(1)},${Y(y0)}Z`;
        svg.appendChild(s('path', { class: 'area', d: a, style: `fill:${sr.color}` }));
      }
      svg.appendChild(s('path', { class: 'series-line', d, style: `stroke:${sr.color}` }));
      const last = pts[pts.length - 1];
      ends.push({ sr, x: X(last.x), y: Y(last.y), v: last.y });
    });
    ends.forEach((e) => svg.appendChild(s('circle', { class: 'end-dot', cx: e.x, cy: e.y, r: 4, style: `fill:${e.sr.color}` })));

    // 끝 라벨: 단일 시리즈는 값, 여러 시리즈는 이름 (서로 14px 이상 떨어질 때만)
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    const collide = sorted.some((e, i) => i > 0 && e.y - sorted[i - 1].y < 14);
    if (!multi || (series.length <= 4 && !collide)) {
      ends.forEach((e) => svg.appendChild(s('text', {
        class: 'end-label' + (multi ? ' name' : ''), x: e.x + 8, y: e.y + 4,
      }, multi ? e.sr.name : yFormat(e.v))));
    }

    const cross = s('line', { class: 'crosshair', y1: top, y2: top + ph, visibility: 'hidden' });
    svg.appendChild(cross);
    const hoverDots = valid.map((sr) => {
      const c = s('circle', { class: 'hover-dot', r: 5, visibility: 'hidden', style: `fill:${sr.color}` });
      svg.appendChild(c);
      return c;
    });
    const hit = s('rect', { x: left - 12, y: 0, width: pw + 24, height: H, fill: 'transparent' });
    svg.appendChild(hit);
    svgWrap.replaceChildren(svg, tip);
    state = { X, Y, cross, hoverDots, left, pw, W };
  }

  function nearestPoint(sr, x) {
    let best = null;
    for (const p of sr.points) {
      if (p.y === null || p.y === undefined) continue;
      if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    }
    return best;
  }

  function show(idx) {
    if (!state) return;
    const x = allX[Math.max(0, Math.min(allX.length - 1, idx))];
    current = allX.indexOf(x);
    const px = state.X(x);
    state.cross.setAttribute('x1', px);
    state.cross.setAttribute('x2', px);
    state.cross.setAttribute('visibility', 'visible');
    const gap = allX.length > 1 ? (x1 - x0) / (allX.length - 1) : 1;
    const rows = [];
    valid.forEach((sr, i) => {
      const p = nearestPoint(sr, x);
      const dot = state.hoverDots[i];
      if (p && Math.abs(p.x - x) <= gap * 0.75) {
        dot.setAttribute('cx', state.X(p.x));
        dot.setAttribute('cy', state.Y(p.y));
        dot.setAttribute('visibility', 'visible');
        rows.push({ sr, p });
      } else dot.setAttribute('visibility', 'hidden');
    });
    rows.sort((a, b) => b.p.y - a.p.y);
    tip.replaceChildren(
      h('div', { class: 't' }, tipTitle(x)),
      ...rows.map(({ sr, p }) => h('div', { class: 'row' },
        h('i', { class: 'key', style: { background: sr.color } }),
        h('span', { class: 'val' }, yFormat(p.y)),
        multi ? h('span', { class: 'name' }, sr.name) : null)));
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const scale = svg.getBoundingClientRect().width / state.W;
    let left = px * scale + 12;
    if (left + tw > svgWrap.clientWidth) left = px * scale - tw - 12;
    tip.style.left = Math.max(0, left) + 'px';
  }

  function hide() {
    if (!state) return;
    tip.hidden = true;
    state.cross.setAttribute('visibility', 'hidden');
    state.hoverDots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  }

  let current = -1;
  function onPointer(e) {
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / state.W;
    const vx = (e.clientX - rect.left) / scale;
    const xv = x0 + ((vx - state.left) / state.pw) * (x1 - x0);
    let best = 0;
    allX.forEach((x, i) => { if (Math.abs(x - xv) < Math.abs(allX[best] - xv)) best = i; });
    show(best);
  }

  const draw = () => {
    const w = svgWrap.clientWidth || root.clientWidth;
    if (!w) return;
    render(w);
    svg.addEventListener('pointermove', onPointer);
    svg.addEventListener('pointerdown', onPointer);
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        show(current < 0 ? allX.length - 1 : current + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') hide();
    });
  };
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = svgWrap.clientWidth;
    if (w && Math.abs(w - lastW) > 2) { lastW = w; draw(); }
  });
  ro.observe(svgWrap);

  // 표로 보기 (툴팁 없이도 모든 값 확인 가능)
  if (tableHead) {
    const det = h('details', { class: 'table-toggle' }, h('summary', null, '표로 보기'));
    const table = h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, tableHead), series.map((sr) => h('th', { class: 'r' }, sr.name)))),
      h('tbody', null, allX.map((x) => h('tr', null, h('td', null, tipTitle(x)), series.map((sr) => {
        const p = sr.points.find((q) => q.x === x);
        return h('td', { class: 'r' }, p && p.y !== null && p.y !== undefined ? yFormat(p.y) : '–');
      })))));
    det.appendChild(h('div', { class: 'table-wrap' }, table));
    root.appendChild(det);
  }
  return root;
}

/** 아주 작은 추세선 (환경 타일용) */
export function sparkline(values, color = 'var(--text-3)') {
  const vals = values.filter((v) => v !== null && v !== undefined);
  const svg = s('svg', { class: 'spark', viewBox: '0 0 100 28', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (vals.length < 2) return svg;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const X = (i) => 4 + (i / (vals.length - 1)) * 92;
  const Y = (v) => 24 - ((v - min) / span) * 20;
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  svg.appendChild(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return svg;
}
