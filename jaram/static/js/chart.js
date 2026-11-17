// 가벼운 SVG 선 그래프 (외부 라이브러리 없음)
// - 선 2px, 끝점 8px + 배경색 테두리, 옅은 영역(10%), 가는 눈금선
// - 누르거나 마우스를 올리면 세로 기준선 + 모든 시리즈 값을 보여 주는 툴팁
// - 시리즈 2개 이상이면 범례 + (겹치지 않을 때) 선 끝 이름표, '표로 보기' 제공
// - overlays: 단위가 다른 값(온도·습도)을 오른쪽 축으로 겹쳐 그림 (생장 그래프의 '온도 표기'·'습도 표기')
//   축이 둘 이상이면 선이 만나는 위치는 의미가 없어서, 범례·축 단위·툴팁 값으로 항상 함께 읽게 해요.

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

/** 왼쪽 축 눈금 개수(n)에 맞춘 깔끔한 눈금: 오른쪽 축 숫자가 왼쪽 눈금선과 같은 높이에 오도록 */
function alignedTicks(min, max, n) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / Math.max(1, n - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) {
    const step = m * mag;
    const start = Math.floor(min / step) * step;
    if (start + step * (n - 1) >= max - 1e-9) return Array.from({ length: n }, (_, i) => +(start + i * step).toFixed(6));
  }
  return Array.from({ length: n }, (_, i) => min + ((max - min) * i) / (n - 1));
}

/**
 * series: [{ name, color, points: [{ x, y }] }]
 * xTick(x) / tipTitle(x): x 값을 글자로
 * yFormat(y): y 값을 글자로 (눈금·툴팁·끝 라벨)
 * overlays: [{ name, color, unit, format(v), points: [{ x, y }] }] - 오른쪽 축을 따로 갖는 겹쳐 그리기 (선택)
 */
export function lineChart({ series, xTick, tipTitle, yFormat, height = 200, yZero = false, area, ariaLabel, tableHead, overlays = [] }) {
  const root = h('div', { class: 'chart' });
  const valid = series.filter((sr) => sr.points.length);
  if (!valid.length || valid.every((sr) => sr.points.length < 2)) {
    root.appendChild(h('div', { class: 'chart-empty' }, '기록이 2개 이상 쌓이면 그래프가 그려져요.'));
    return root;
  }
  const multi = series.length > 1;
  const showArea = area ?? !multi;
  const svgWrap = h('div', { style: { position: 'relative' } });
  root.appendChild(svgWrap);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  svgWrap.appendChild(tip);

  const allX = [...new Set(valid.flatMap((sr) => sr.points.map((p) => p.x)))].sort((a, b) => a - b);
  const ys = valid.flatMap((sr) => sr.points.map((p) => p.y)).filter((y) => y !== null && y !== undefined && Number.isFinite(y));
  if (!ys.length) {
    root.replaceChildren(h('div', { class: 'chart-empty' }, '아직 그래프로 그릴 값이 없어요.'));
    return root;
  }
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yZero) { yMin = Math.min(0, yMin); yMax = Math.max(0, yMax); }
  const pad = (yMax - yMin || Math.abs(yMax) || 1) * 0.08;
  const ticks = niceTicks(yMin - (yZero && yMin === 0 ? 0 : pad), yMax + pad);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x0 = allX[0];
  const x1 = allX[allX.length - 1] === x0 ? x0 + 1 : allX[allX.length - 1];

  // 겹쳐 그리기: 그래프 기간 안의 값만, 각자 오른쪽 축 (왼쪽 눈금선과 같은 높이에 숫자)
  const ov = overlays.map((o) => {
    const pts = o.points.filter((p) => p.y !== null && p.y !== undefined && Number.isFinite(p.y) && p.x >= x0 && p.x <= x1)
      .sort((a, b) => a.x - b.x);
    if (!pts.length) return null;
    const vs = pts.map((p) => p.y);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const padO = (hi - lo || Math.abs(hi) || 1) * 0.08;
    const t = alignedTicks(lo - padO, hi + padO, ticks.length);
    return { ...o, pts, t0: t[0], t1: t[t.length - 1], ticks: t };
  }).filter(Boolean);
  if (multi || ov.length) {
    root.insertBefore(h('div', { class: 'legend' },
      series.map((sr) => h('span', null, h('i', { style: { background: sr.color } }), sr.name)),
      ov.map((o) => h('span', null, h('i', { class: 'dot', style: { background: o.color } }), `${o.name} (${o.unit}, 오른쪽 축)`))), svgWrap);
  }
  // 툴팁·표에서 x 와 같은 날로 볼 거리 (사진 사이 간격의 3/4, 최소 반나절)
  const sameDay = Math.max(0.5, allX.length > 1 ? ((x1 - x0) / (allX.length - 1)) * 0.75 : 0.5);
  const nearestOv = (o, x) => {
    let best = null;
    for (const p of o.pts) if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best && Math.abs(best.x - x) <= sameDay ? best : null;
  };

  let svg;
  let state = null;

  function render(width) {
    const tickLabels = ticks.map(yFormat);
    const left = Math.max(...tickLabels.map((t) => t.length)) * 6.6 + 10;
    const endLabelW = multi ? Math.min(64, Math.max(...series.map((sr) => sr.name.length)) * 12 + 14) : 52;
    // 오른쪽 축이 있으면 선 끝 라벨 대신 축 숫자를 둬요 (휴대폰에서 그래프 폭을 지키려고)
    const ovLabels = ov.map((o) => o.ticks.map((v) => o.format(v)));
    const axisW = ovLabels.map((labels) => Math.max(26, Math.max(...labels.map((t) => t.length)) * 6.6 + 12));
    const right = ov.length ? axisW.reduce((a, b) => a + b, 0) + 4 : endLabelW;
    const top = ov.length ? 26 : 12;
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

    // 오른쪽 축: 단위 + 같은 높이의 눈금 숫자, 그리고 선
    let axisX = left + pw + 10;
    const ovY = ov.map((o) => (v) => top + (1 - (v - o.t0) / (o.t1 - o.t0)) * ph);
    ov.forEach((o, i) => {
      svg.appendChild(s('line', { class: 'axis-key', x1: axisX, x2: axisX + 10, y1: top - 14, y2: top - 14, style: `stroke:${o.color}` }));
      svg.appendChild(s('text', { class: 'tick unit', x: axisX + 13, y: top - 10 }, o.unit));
      ticks.forEach((t, j) => svg.appendChild(s('text', { class: 'tick', x: axisX, y: Y(t) + 4 }, ovLabels[i][j])));
      axisX += axisW[i];
      const d = o.pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.x).toFixed(1)},${ovY[i](p.y).toFixed(1)}`).join('');
      if (o.pts.length > 1) svg.appendChild(s('path', { class: 'series-line overlay', d, style: `stroke:${o.color}` }));
      o.pts.forEach((p) => svg.appendChild(s('circle', { class: 'ov-dot', cx: X(p.x), cy: ovY[i](p.y), r: 3.5, style: `fill:${o.color}` })));
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
    if (!ov.length && (!multi || (series.length <= 4 && !collide))) {
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
    const ovDots = ov.map((o) => {
      const c = s('circle', { class: 'hover-dot', r: 5, visibility: 'hidden', style: `fill:${o.color}` });
      svg.appendChild(c);
      return c;
    });
    const hit = s('rect', { x: left - 12, y: 0, width: pw + 24, height: H, fill: 'transparent' });
    svg.appendChild(hit);
    svgWrap.replaceChildren(svg, tip);
    state = { X, Y, cross, hoverDots, ovDots, ovY, left, pw, W };
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
    const ovRows = [];
    ov.forEach((o, i) => {
      const p = nearestOv(o, x);
      const dot = state.ovDots[i];
      if (p) {
        dot.setAttribute('cx', state.X(p.x));
        dot.setAttribute('cy', state.ovY[i](p.y));
        dot.setAttribute('visibility', 'visible');
        ovRows.push(h('div', { class: 'row' }, h('i', { class: 'key', style: { background: o.color } }),
          h('span', { class: 'val' }, o.format(p.y) + o.unit), h('span', { class: 'name' }, o.name)));
      } else dot.setAttribute('visibility', 'hidden');
    });
    tip.replaceChildren(
      h('div', { class: 't' }, tipTitle(x)),
      ...rows.map(({ sr, p }) => h('div', { class: 'row' },
        h('i', { class: 'key', style: { background: sr.color } }),
        h('span', { class: 'val' }, yFormat(p.y)),
        multi || ov.length ? h('span', { class: 'name' }, sr.name) : null)),
      ...ovRows);
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
    state.ovDots.forEach((d) => d.setAttribute('visibility', 'hidden'));
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

  // 손가락으로 볼 때는 손을 뗀 뒤에도 툴팁을 잠시 남겨 둠 (바로 사라지면 값을 읽을 수 없음)
  let hideTimer = 0;
  const onLeave = (e) => {
    clearTimeout(hideTimer);
    if (e.pointerType === 'mouse') hide();
    else hideTimer = setTimeout(hide, 2500);
  };
  const onMove = (e) => { clearTimeout(hideTimer); onPointer(e); };

  const draw = () => {
    const w = svgWrap.clientWidth || root.clientWidth;
    if (!w) return;
    render(w);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerdown', onMove);
    svg.addEventListener('pointerleave', onLeave);
    svg.addEventListener('pointercancel', onLeave);
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        show(current < 0 ? allX.length - 1 : current + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Escape') hide();
    });
  };
  let lastW = 0;
  // 다음 프레임에 다시 그려서 'ResizeObserver loop' 경고를 막고, 화면을 떠나면 관찰을 멈춤
  let pending = 0;
  const ro = new ResizeObserver(() => {
    if (!svgWrap.isConnected && lastW) { ro.disconnect(); return; }
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const w = svgWrap.clientWidth;
      if (w && Math.abs(w - lastW) > 2) { lastW = w; draw(); }
    });
  });
  ro.observe(svgWrap);

  // 표로 보기 (툴팁 없이도 모든 값 확인 가능)
  if (tableHead) {
    const det = h('details', { class: 'table-toggle' }, h('summary', null, '표로 보기'));
    const table = h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, tableHead), series.map((sr) => h('th', { class: 'r' }, sr.name)),
        ov.map((o) => h('th', { class: 'r' }, `${o.name}(${o.unit})`)))),
      h('tbody', null, allX.map((x) => h('tr', null, h('td', null, tipTitle(x)), series.map((sr) => {
        const p = sr.points.find((q) => q.x === x);
        return h('td', { class: 'r' }, p && p.y !== null && p.y !== undefined ? yFormat(p.y) : '–');
      }), ov.map((o) => {
        const p = nearestOv(o, x);
        return h('td', { class: 'r' }, p ? o.format(p.y) : '–');
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
