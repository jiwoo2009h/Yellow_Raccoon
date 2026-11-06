// 브라우저 안에서 실행되는 화면 구조 추출기 (build.js 가 Playwright 로 주입).
// 화면의 DOM 을 Figma 오토레이아웃 트리로 바꿉니다.
//   - flex / grid / 블록 흐름  → 가로·세로 오토레이아웃 (간격, 여백, 정렬, FILL·HUG·FIXED)
//   - position: absolute       → 오토레이아웃 안의 '절대 위치' 자식
//   - position: fixed          → 화면 프레임 맨 위층 (탭바·하단 버튼·시트)
//   - 글자                       → 텍스트 레이어 (굵기·크기·색상이 다른 부분은 범위 스타일)
//   - svg 아이콘·그래프          → 벡터, 사진 → 이미지 채우기
// 색상은 rgba 로 기록하고, build.js 가 라이트/다크 결과를 짝지어 CSS 변수(토큰)로 바꿉니다.

/* eslint-disable no-unused-vars */
async function extractTree(opts = {}) {
  const VIEW_H = window.innerHeight;
  const images = {};
  const round = (v) => Math.round(v * 100) / 100;
  const px = (v) => parseFloat(v) || 0;

  // ------------------------------------------------------------ 색상
  function rgba(c) {
    if (!c || c === 'transparent' || c === 'none') return null;
    let m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      const a = m[4] === undefined ? 1 : +m[4];
      return a <= 0.001 ? null : [+m[1], +m[2], +m[3], round(a)];
    }
    m = c.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (m) {
      const a = m[4] === undefined ? 1 : +m[4];
      const t = (x) => Math.round(Math.max(0, Math.min(1, +x)) * 255);
      return a <= 0.001 ? null : [t(m[1]), t(m[2]), t(m[3]), round(a)];
    }
    return null;
  }

  // 디자인 토큰(CSS 변수) 값 읽기
  function readTokens() {
    const names = new Set();
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        const scan = (rule) => {
          if (rule.style && /:root/.test(rule.selectorText || '')) {
            for (let i = 0; i < rule.style.length; i++) {
              const p = rule.style[i];
              if (p.startsWith('--')) names.add(p);
            }
          }
          if (rule.cssRules) for (const sub of rule.cssRules) scan(sub);
        };
        scan(r);
      }
    }
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const out = {};
    for (const n of names) {
      probe.style.color = '';
      probe.style.color = `var(${n})`;
      const v = getComputedStyle(probe).color;
      const raw = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      if (/^(#|rgb|color\()/.test(raw)) {
        const c = rgba(v);
        if (c) out[n.slice(2)] = c;
      }
    }
    probe.remove();
    return out;
  }

  function radii(cs, w, h) {
    const lim = Math.min(w, h) / 2;
    return ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map((k) => {
      const v = cs[k];
      const p = v.endsWith('%') ? (parseFloat(v) / 100) * Math.min(w, h) : px(v);
      return round(Math.min(p, lim));
    });
  }

  function shadows(cs) {
    if (!cs.boxShadow || cs.boxShadow === 'none') return { drop: [], insetStroke: null };
    const parts = cs.boxShadow.split(/,(?![^(]*\))/).map((s) => s.trim());
    const drop = [];
    let insetStroke = null;
    for (const p of parts) {
      const colorMatch = p.match(/(rgba?\([^)]*\)|color\([^)]*\))/);
      const color = colorMatch ? rgba(colorMatch[1]) : null;
      const nums = p.replace(colorMatch ? colorMatch[1] : '', '').match(/-?[\d.]+px/g) || [];
      const [ox, oy, blur, spread] = nums.map(px).concat([0, 0, 0, 0]);
      if (!color) continue;
      if (/inset/.test(p)) {
        if (!ox && !oy && !blur && spread) insetStroke = { color, w: spread };
      } else drop.push({ color, x: ox, y: oy, blur, spread });
    }
    return { drop, insetStroke };
  }

  function gradient(cs) {
    const bg = cs.backgroundImage;
    if (!bg || !bg.startsWith('linear-gradient')) return null;
    const inner = bg.slice(bg.indexOf('(') + 1, bg.lastIndexOf(')'));
    const parts = inner.split(/,(?![^(]*\))/).map((s) => s.trim());
    let angle = 180;
    if (/deg$/.test(parts[0])) angle = parseFloat(parts.shift());
    else if (/^to /.test(parts[0])) {
      const dir = parts.shift();
      angle = { 'to bottom': 180, 'to top': 0, 'to right': 90, 'to left': 270 }[dir] ?? 180;
    }
    const stops = parts.map((s, i) => {
      const cm = s.match(/(rgba?\([^)]*\)|color\([^)]*\))/);
      const pos = s.match(/([\d.]+)%\s*$/);
      return { color: cm ? rgba(cm[1]) || [0, 0, 0, 0] : [0, 0, 0, 0], pos: pos ? +pos[1] / 100 : i / Math.max(1, parts.length - 1) };
    });
    return { angle, stops };
  }

  // ------------------------------------------------------------ 숨김 판단
  function hidden(el, cs) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return true;
    if (el.classList && el.classList.contains('sr-only')) return true;
    if (el.hidden) return true;
    const closed = el.parentElement && el.parentElement.closest('details:not([open])');
    if (closed && !el.closest('summary') && el.tagName !== 'SUMMARY') return true;
    return false;
  }

  const nameOf = (el) => {
    const c = (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').trim().split(/\s+/)[0];
    return c || el.tagName.toLowerCase();
  };

  // ------------------------------------------------------------ 글자 (인라인 내용 → 텍스트 레이어)
  // 작은 화살표 아이콘(▲▼)은 글자로 바꿔서 한 덩어리 텍스트로 만듦
  function arrowGlyph(svg) {
    const r = svg.getBoundingClientRect();
    if (r.width > 14 || r.height > 14) return null;
    const d = (svg.querySelector('path') || {}).getAttribute ? svg.querySelector('path').getAttribute('d') || '' : '';
    if (/^M6 2\.5/.test(d)) return '▲';
    if (/^M6 9\.5/.test(d)) return '▼';
    return null;
  }
  function isPlainInline(el, nested = false) {
    const cs = getComputedStyle(el);
    if (el.tagName.toLowerCase() === 'svg') return !!arrowGlyph(el);
    // 인라인 요소 안쪽의 자식은 flex 항목이 되면서 display 가 block/flex 로 바뀌므로 허용
    const ok = nested ? ['inline', 'inline-flex', 'inline-block', 'contents', 'flex', 'block'] : ['inline', 'inline-flex', 'inline-block', 'contents'];
    if (!ok.includes(cs.display)) return false;
    if (rgba(cs.backgroundColor)) return false;
    if (px(cs.borderTopWidth) || px(cs.paddingLeft) || px(cs.paddingTop)) return false;
    if (cs.display !== 'inline' && cs.display !== 'contents' && (px(cs.marginLeft) || px(cs.marginTop))) return false;
    for (const c of el.childNodes) {
      if (c.nodeType === 1) {
        if (c.tagName === 'BR') continue;
        if (hidden(c, getComputedStyle(c))) continue;
        if (!isPlainInline(c, true)) return false;
      }
    }
    return !el.querySelector('img, input, textarea');
  }
  function inlineOnly(el) {
    let any = false;
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { if (c.textContent.trim()) any = true; continue; }
      if (c.nodeType !== 1) continue;
      const cs = getComputedStyle(c);
      if (hidden(c, cs)) continue;
      if (c.tagName === 'BR') continue;
      if (!isPlainInline(c)) return false;
      if (c.textContent.trim() || c.tagName.toLowerCase() === 'svg') any = true;
    }
    return any;
  }
  function styleRun(cs) {
    return {
      size: px(cs.fontSize),
      weight: +cs.fontWeight || 400,
      color: rgba(cs.color),
      ls: cs.letterSpacing === 'normal' ? 0 : round(px(cs.letterSpacing)),
      lh: cs.lineHeight === 'normal' ? round(px(cs.fontSize) * 1.5) : round(px(cs.lineHeight)),
    };
  }
  function collectRuns(el, runs) {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, ' ');
        if (t) runs.push({ text: t, ...styleRun(getComputedStyle(el)) });
      } else if (c.nodeType === 1) {
        const cs = getComputedStyle(c);
        if (hidden(c, cs)) continue;
        if (c.tagName === 'BR') runs.push({ text: '\n', ...styleRun(getComputedStyle(el)) });
        else if (c.tagName.toLowerCase() === 'svg') {
          const g = arrowGlyph(c);
          if (g) runs.push({ text: g, ...styleRun(cs), size: Math.max(8, Math.round(px(getComputedStyle(el).fontSize) * 0.7)) });
        } else collectRuns(c, runs);
      }
    }
    return runs;
  }
  function cleanRuns(runs) {
    // 공백 정리 (CSS white-space: normal 과 같게)
    let prevSpace = true;
    for (const r of runs) {
      let t = '';
      for (const ch of r.text) {
        if (ch === '\n') { t = t.replace(/ $/, ''); t += '\n'; prevSpace = true; continue; }
        if (ch === ' ') { if (!prevSpace) t += ' '; prevSpace = true; } else { t += ch; prevSpace = false; }
      }
      r.text = t;
    }
    for (let i = runs.length - 1; i >= 0; i--) {
      runs[i].text = runs[i].text.replace(/ +$/, '');
      if (runs[i].text) break;
    }
    return runs.filter((r) => r.text);
  }
  function lineCount(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set();
    for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4));
    return tops.size;
  }
  function textNode(el, runs, rect, cs) {
    const align = { center: 'CENTER', right: 'RIGHT', end: 'RIGHT' }[cs.textAlign] || 'LEFT';
    return {
      t: 'text', name: nameOf(el), x: rect.left, y: rect.top, w: rect.width, h: rect.height,
      runs, align, wrap: lineCount(el) > 1, flexGrow: +cs.flexGrow || 0,
    };
  }
  function textFromTextNode(tn, parentEl) {
    const t = tn.textContent.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const range = document.createRange();
    range.selectNodeContents(tn);
    const r = range.getBoundingClientRect();
    if (!r.width) return null;
    const cs = getComputedStyle(parentEl);
    const lines = new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top / 4))).size;
    return {
      t: 'text', name: t.slice(0, 24), x: r.left, y: r.top, w: r.width, h: r.height,
      runs: [{ text: t, ...styleRun(cs) }], align: 'LEFT', wrap: lines > 1, flexGrow: 0,
    };
  }

  // ------------------------------------------------------------ SVG
  function svgNode(el, r) {
    if (r.width < 1 || r.height < 1) return null;
    const clone = el.cloneNode(true);
    const src = [el, ...el.querySelectorAll('*')];
    const dst = [clone, ...clone.querySelectorAll('*')];
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight'];
    src.forEach((s, i) => {
      const d = dst[i];
      const cs = getComputedStyle(s);
      if (cs.visibility === 'hidden' || cs.display === 'none') { d.setAttribute('data-remove', '1'); return; }
      for (const p of props) {
        let v = cs.getPropertyValue(p);
        if (!v) continue;
        if ((p === 'fill' || p === 'stroke') && (v.startsWith('rgb') || v.startsWith('color('))) {
          const c = rgba(v);
          v = c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'none';
          if (c && c[3] < 1) d.setAttribute(`${p}-opacity`, c[3]);
        }
        d.setAttribute(p, v);
      }
      if (s.tagName === 'text') d.setAttribute('font-family', 'Inter');
      ['class', 'style', 'vector-effect', 'tabindex', 'role', 'aria-hidden', 'aria-label'].forEach((a) => d.removeAttribute(a));
    });
    clone.querySelectorAll('[data-remove]').forEach((x) => x.remove());
    clone.querySelectorAll('rect').forEach((x) => {
      const f = x.getAttribute('fill');
      if ((f === 'none' || f === 'transparent' || !f) && (!x.getAttribute('stroke') || x.getAttribute('stroke') === 'none')) x.remove();
    });
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${el.getAttribute('width') || r.width} ${el.getAttribute('height') || r.height}`);
    clone.setAttribute('width', round(r.width));
    clone.setAttribute('height', round(r.height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (el.getAttribute('preserveAspectRatio')) clone.setAttribute('preserveAspectRatio', el.getAttribute('preserveAspectRatio'));
    return { t: 'svg', name: nameOf(el) === 'svg' ? 'icon' : nameOf(el), x: r.left, y: r.top, w: r.width, h: r.height, svg: new XMLSerializer().serializeToString(clone) };
  }

  // ------------------------------------------------------------ 이미지
  function imageNode(el, cs, r) {
    if (!el.complete || !el.naturalWidth) return null;
    let x = r.left, y = r.top, w = r.width, h = r.height;
    const nw = el.naturalWidth, nh = el.naturalHeight;
    let sx = 0, sy = 0, sw = nw, sh = nh;
    if (cs.objectFit === 'cover') {
      const s = Math.max(w / nw, h / nh);
      sw = w / s; sh = h / s; sx = (nw - sw) / 2; sy = (nh - sh) / 2;
    }
    const ins = cs.clipPath.match(/inset\(([^)]*)\)/);
    if (ins) {
      const v = ins[1].split(/\s+/).map((p, i) => (p.endsWith('%') ? (parseFloat(p) / 100) * (i % 2 ? w : h) : px(p)));
      const [t, rr, b, l] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
      const kx = sw / w, ky = sh / h;
      sx += l * kx; sw -= (l + rr) * kx; sy += t * ky; sh -= (t + b) * ky;
      x += l; w -= l + rr; y += t; h -= t + b;
    }
    if (w <= 1 || h <= 1) return null;
    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    cv.getContext('2d').drawImage(el, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    const data = cv.toDataURL('image/jpeg', 0.82).split(',')[1];
    const key = `img${Object.keys(images).length + 1}`;
    images[key] = data;
    return { t: 'image', name: 'photo', x, y, w, h, img: key, radius: radii(cs, w, h) };
  }

  // 캔버스(3D 미리보기 등)는 지금 그려진 그림을 PNG 이미지로
  function canvasNode(el, cs, r) {
    if (r.width <= 1 || r.height <= 1 || !el.width || !el.height) return null;
    let data;
    try { data = el.toDataURL('image/png').split(',')[1]; } catch (e) { return null; }
    const key = `img${Object.keys(images).length + 1}`;
    images[key] = data;
    return { t: 'image', name: 'canvas', x: r.left, y: r.top, w: r.width, h: r.height, img: key, radius: radii(cs, r.width, r.height) };
  }

  // ------------------------------------------------------------ 박스 스타일
  function boxStyle(el, cs, r) {
    const st = {};
    const bg = rgba(cs.backgroundColor);
    if (bg) st.fill = bg;
    const g = gradient(cs);
    if (g) st.gradient = g;
    st.radius = radii(cs, r.width, r.height);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => ({ w: px(cs[`border${s}Width`]), c: rgba(cs[`border${s}Color`]) }));
    if (sides.some((s) => s.w > 0 && s.c)) {
      const main = sides.find((s) => s.w > 0 && s.c);
      st.stroke = { color: main.c, weights: sides.map((s) => (s.w > 0 && s.c ? s.w : 0)) };
    }
    const sh = shadows(cs);
    if (!st.stroke && sh.insetStroke) st.stroke = { color: sh.insetStroke.color, weights: [sh.insetStroke.w, sh.insetStroke.w, sh.insetStroke.w, sh.insetStroke.w] };
    if (sh.drop.length) st.shadows = sh.drop;
    const bf = (cs.backdropFilter || cs.webkitBackdropFilter || '').match(/blur\(([\d.]+)px\)/);
    if (bf) st.blur = +bf[1];
    if (+cs.opacity < 1) st.opacity = +cs.opacity;
    if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX) || ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowY)) st.clip = true;
    // 리스트 구분선 (::before)
    if (el.matches && el.matches('.list-item + .list-item')) {
      const c = rgba(getComputedStyle(el, '::before').borderTopColor);
      if (c) st.divider = { color: c, inset: 20 };
    }
    return st;
  }

  // ------------------------------------------------------------ 오토레이아웃 결정
  const ALIGN = { 'flex-start': 'MIN', start: 'MIN', normal: 'MIN', stretch: 'MIN', left: 'MIN', center: 'CENTER', 'flex-end': 'MAX', end: 'MAX', right: 'MAX', 'space-between': 'SPACE_BETWEEN', baseline: 'BASELINE', 'first baseline': 'BASELINE' };
  function layoutOf(cs, el) {
    const d = cs.display;
    if (d === 'flex' || d === 'inline-flex') {
      const H = cs.flexDirection.startsWith('row');
      return {
        mode: H ? 'H' : 'V', wrap: H && cs.flexWrap === 'wrap',
        main: ALIGN[cs.justifyContent] || 'MIN',
        cross: ALIGN[cs.alignItems] || 'MIN',
        stretch: cs.alignItems === 'normal' || cs.alignItems === 'stretch',
        gap: px(H ? cs.columnGap : cs.rowGap), crossGap: px(H ? cs.rowGap : cs.columnGap),
      };
    }
    if (d === 'grid' || d === 'inline-grid') {
      const cols = cs.gridTemplateColumns.split(/\s+(?![^(]*\))/).filter(Boolean).length;
      const center = cs.justifyItems === 'center' || cs.placeItems?.includes('center');
      const vcenter = cs.alignItems === 'center' || cs.alignContent === 'center';
      if (cols <= 1) {
        return { mode: 'V', wrap: false, main: vcenter ? 'CENTER' : 'MIN', cross: center ? 'CENTER' : 'MIN', stretch: !center, gap: px(cs.rowGap), crossGap: 0, grid: 1 };
      }
      return { mode: 'H', wrap: true, main: 'MIN', cross: vcenter ? 'CENTER' : 'MIN', stretch: false, gap: px(cs.columnGap), crossGap: px(cs.rowGap), grid: cols };
    }
    // 블록 흐름: 세로로 쌓임
    const center = cs.textAlign === 'center';
    return { mode: 'V', wrap: false, main: 'MIN', cross: center ? 'CENTER' : 'MIN', stretch: true, gap: 0, crossGap: 0, block: true };
  }

  // ------------------------------------------------------------ 변환
  const fixedLayer = [];

  function conv(el) {
    if (el.nodeType !== 1) return null;
    const cs = getComputedStyle(el);
    if (hidden(el, cs)) return null;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'VIDEO', 'TEMPLATE'].includes(el.tagName)) return null;
    if (cs.display === 'contents') return convChildren(el);
    const r = el.getBoundingClientRect();
    if (el.tagName.toLowerCase() === 'svg' || el.tagName === 'IMG' || el.tagName === 'CANVAS') {
      const leaf = el.tagName === 'IMG' ? imageNode(el, cs, r) : el.tagName === 'CANVAS' ? canvasNode(el, cs, r) : svgNode(el, r);
      if (leaf && cs.position === 'absolute') leaf.abs = true;
      return leaf;
    }
    if (r.width < 0.5 && r.height < 0.5) return null;
    if (cs.position === 'fixed') {
      const n = frameNode(el, cs, r);
      if (n) { n.fixed = { top: r.top <= 1, bottom: Math.abs(r.bottom - VIEW_H) <= 1, cover: r.top <= 1 && Math.abs(r.bottom - VIEW_H) <= 1 }; fixedLayer.push(n); }
      return null;
    }
    const n = frameNode(el, cs, r);
    if (n && cs.position === 'absolute') n.abs = true;
    return n;
  }

  function convChildren(el) {
    const out = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 3) {
        const t = textFromTextNode(c, el);
        if (t) out.push(t);
      } else {
        const n = conv(c);
        if (Array.isArray(n)) out.push(...n);
        else if (n) out.push(n);
      }
    }
    return out;
  }

  function frameNode(el, cs, r) {
    const st = boxStyle(el, cs, r);
    const pad = ['Top', 'Right', 'Bottom', 'Left'].map((s) => px(cs[`padding${s}`]) + px(cs[`border${s}Width`]));
    const base = { t: 'frame', name: nameOf(el), x: r.left, y: r.top, w: r.width, h: r.height, style: st, pad, flexGrow: +cs.flexGrow || 0, alignSelf: cs.alignSelf };

    // 입력칸
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.type === 'checkbox') {
        const acc = rgba(cs.accentColor) || rgba(cs.color);
        const check = el.checked ? [{
          t: 'svg', name: 'check', x: r.left + 3, y: r.top + 3, w: r.width - 6, h: r.height - 6,
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${round(r.width - 6)}" height="${round(r.height - 6)}" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        }] : [];
        return {
          ...base, name: 'checkbox', pad: [3, 3, 3, 3],
          style: { radius: [6, 6, 6, 6], fill: el.checked ? acc : null, stroke: el.checked ? null : { color: acc, weights: [2, 2, 2, 2] } },
          layout: { mode: 'H', main: 'CENTER', cross: 'CENTER', gap: 0 }, children: check,
        };
      }
      if (el.type === 'range' || el.type === 'file' || el.type === 'hidden') return null;
      const isPh = !el.value;
      const val = el.type === 'datetime-local' ? el.value.replace('T', ' ') : (el.value || el.placeholder || '');
      const tcs = isPh ? getComputedStyle(el, '::placeholder') : cs;
      const run = { text: val, ...styleRun(cs), color: rgba(tcs.color) || rgba(cs.color) };
      const textH = run.lh;
      const tx = { t: 'text', name: isPh ? 'placeholder' : 'value', x: r.left + pad[3], y: r.top + (el.tagName === 'TEXTAREA' ? pad[0] : (r.height - textH) / 2), w: Math.max(1, r.width - pad[1] - pad[3]), h: textH, runs: val ? [run] : [], align: 'LEFT', wrap: false, flexGrow: 0 };
      return { ...base, name: el.tagName === 'TEXTAREA' ? 'textarea' : 'input', layout: { mode: 'H', main: 'MIN', cross: el.tagName === 'TEXTAREA' ? 'MIN' : 'CENTER', gap: 0 }, children: val ? [tx] : [], fixedH: true };
    }

    // 인라인 내용만 있는 요소 → 텍스트 (박스 꾸밈이 없으면 텍스트 하나로)
    if (inlineOnly(el) && !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(cs.display)) {
      const runs = cleanRuns(collectRuns(el, []));
      if (!runs.length) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      const text = textNode(el, runs, { left: tr.left, top: tr.top, width: tr.width, height: tr.height }, cs);
      const decorated = st.fill || st.stroke || st.gradient || pad.some((p) => p > 0) || el.tagName === 'BUTTON' || el.tagName === 'A';
      if (!decorated && cs.position !== 'absolute' && cs.position !== 'fixed') {
        // 블록 요소면 너비를 그대로 차지 (가운데 정렬 글자 등)
        text.x = r.left; text.w = r.width; text.y = r.top; text.h = r.height;
        text.block = !['inline', 'inline-block'].includes(cs.display);
        return text;
      }
      const isButton = el.tagName === 'BUTTON';
      text.flexGrow = 0; // 늘어나기는 버튼(부모)의 속성이지 글자의 속성이 아님
      return {
        ...base,
        layout: { mode: 'H', main: isButton || cs.textAlign === 'center' ? 'CENTER' : 'MIN', cross: 'CENTER', gap: 0 },
        children: [text],
      };
    }

    const lay = layoutOf(cs, el);
    // 버튼은 브라우저가 내용을 세로 가운데 정렬함
    if (el.tagName === 'BUTTON' && lay.block) { lay.mode = 'H'; lay.main = cs.textAlign === 'left' ? 'MIN' : 'CENTER'; lay.cross = 'CENTER'; lay.block = false; }
    const children = convChildren(el);
    return { ...base, layout: lay, children };
  }

  const app = document.getElementById('app');
  const tree = conv(app);
  const layer = document.getElementById('layer');
  for (const c of layer.children) conv(c); // 시트·토스트는 fixed 로 수집됨
  tree.name = opts.name || 'screen';
  tree.fixedChildren = fixedLayer;
  return {
    tree,
    images,
    tokens: readTokens(),
    width: document.documentElement.clientWidth,
    height: opts.viewportOnly ? VIEW_H : Math.max(VIEW_H, document.documentElement.scrollHeight),
    viewH: VIEW_H,
  };
}
