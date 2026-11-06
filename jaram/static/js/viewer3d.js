// 3D 미리보기: 시각 헐의 겉면 점들을 canvas 에 그립니다 (외부 라이브러리 없음).
// 끌어서 돌리기, 자동 회전, 깊이에 따른 명암, 라이트/다크 테마 색.

import { h } from './ui.js';

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgb(c) {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const r = c.match(/rgba?\(([^)]+)\)/);
  return r ? r[1].split(',').slice(0, 3).map((x) => +x) : [43, 196, 122];
}

/**
 * points: [[x, 높이, z], ...] (0° 사진 픽셀 단위). options: { height, autoRotate, label }
 */
export function pointCloudViewer(points, { height = 280, autoRotate = true, label = '3D 미리보기' } = {}) {
  const canvas = h('canvas', { role: 'img', 'aria-label': `${label}: 끌어서 돌려 볼 수 있어요`, tabindex: '0' });
  const wrap = h('div', { class: 'viewer3d', style: { height: `${height}px` } }, canvas);
  if (!points || !points.length) {
    wrap.append(h('div', { class: 'viewer3d-empty' }, '3D 데이터가 없어요'));
    return wrap;
  }
  // 가운데 정렬: 가로·깊이는 범위 중앙, 높이는 바닥 0
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  for (const [x, y, z] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    maxY = Math.max(maxY, y);
  }
  const cx0 = (minX + maxX) / 2;
  const cz0 = (minZ + maxZ) / 2;
  const pts = points.map(([x, y, z]) => [x - cx0, y, z - cz0]);
  const radius = Math.max(1, ...pts.map(([x, , z]) => Math.hypot(x, z)));

  let yaw = 0.6;
  let pitch = -0.38;
  let dragging = false;
  let last = null;
  let raf = 0;
  let w = 0;
  let hgt = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  function draw() {
    const ctx = canvas.getContext('2d');
    if (!ctx || !w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const s = Math.min((w * 0.42) / radius, (hgt * 0.72) / Math.max(1, maxY));
    const baseY = hgt * 0.84;
    const cx = w / 2;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = (x, y, z) => {
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      return [cx + x1 * s, baseY - y2 * s, z2];
    };
    // 바닥 원 (화분 위치)
    ctx.strokeStyle = cssColor('--chart-axis', '#ccc');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const [px, py] = proj(Math.cos(t) * radius * 1.05, 0, Math.sin(t) * radius * 1.05);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    const p2 = pts.map(([x, y, z]) => proj(x, y, z));
    const order = p2.map((_, i) => i).sort((a, b) => p2[a][2] - p2[b][2]);
    const [r, g, b] = hexToRgb(cssColor('--accent', '#0c8a4a'));
    const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
    const zr = radius + maxY;
    const size = Math.max(1.6, Math.min(3.2, s * 2.2));
    for (const i of order) {
      const [px, py, pz] = p2[i];
      const t = Math.max(0, Math.min(1, (pz / zr + 1) / 2)); // 0 = 멀리, 1 = 가까이
      const k = dark ? 0.45 + 0.55 * t : 0.55 + 0.45 * t;
      const mix = dark ? 0 : (1 - t) * 0.45;
      ctx.fillStyle = `rgb(${Math.round(r * k + 255 * mix)},${Math.round(g * k + 255 * mix)},${Math.round(b * k + 255 * mix)})`;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
  }

  function loop() {
    if (!canvas.isConnected) { cancelAnimationFrame(raf); return; }
    if (autoRotate && !dragging) { yaw += 0.006; draw(); }
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    w = wrap.clientWidth;
    hgt = wrap.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
    draw();
  }

  canvas.addEventListener('pointerdown', (e) => { dragging = true; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - last[0]) * 0.012;
    pitch = Math.max(-1.3, Math.min(0.2, pitch + (e.clientY - last[1]) * 0.006));
    last = [e.clientX, e.clientY];
    draw();
  });
  const end = () => { dragging = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { yaw -= 0.2; draw(); }
    if (e.key === 'ArrowRight') { yaw += 0.2; draw(); }
  });
  new ResizeObserver(resize).observe(wrap);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (autoRotate && !reduce) raf = requestAnimationFrame(loop);
  return wrap;
}

/** points_url 에서 점을 불러와 미리보기를 채움 */
export function lazyViewer(url, opts) {
  const holder = h('div', { class: 'viewer3d', style: { height: `${(opts && opts.height) || 280}px` } });
  if (!url) return holder;
  fetch(url).then((r) => r.json()).then((pts) => { holder.replaceWith(pointCloudViewer(pts, opts)); }).catch(() => {});
  return holder;
}
