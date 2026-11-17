// ===================================================================
// 자람 디자인 만들기 — Figma 플러그인 본체
// DATA (위쪽, build.js 가 자동 생성) 를 읽어 화면을 오토레이아웃 프레임으로 만듭니다.
//   - 색상: '자람 색상 · 라이트' / '자람 색상 · 다크' 변수 묶음에 연결
//     (무료 요금제는 변수 모드를 1개만 쓸 수 있어서 테마별로 묶음을 나눔)
//   - 글꼴: Pretendard 가 설치돼 있으면 Pretendard, 없으면 Noto Sans KR
//   - 다시 실행하면 같은 페이지를 지우고 새로 만들며, 변수 값은 갱신됩니다.
// ===================================================================

const PAGE_NAME = '자람 · 오토레이아웃';
const THEMES = [
  { key: 'light', label: '라이트', mode: 'Light' },
  { key: 'dark', label: '다크', mode: 'Dark' },
];
const FAMILIES = ['Pretendard', 'Pretendard Variable', 'Noto Sans KR', 'Inter'];
const WEIGHT_NAMES = {
  100: ['thin', 'hairline'],
  200: ['extralight', 'extra light', 'ultralight'],
  300: ['light'],
  400: ['regular', 'normal', 'book'],
  500: ['medium'],
  600: ['semibold', 'semi bold', 'demibold', 'demi bold'],
  700: ['bold'],
  800: ['extrabold', 'extra bold', 'ultrabold'],
  900: ['black', 'heavy'],
};
const GAP_X = 80;
const GAP_Y = 160;

let FAMILY = 'Inter';
const STYLE_FOR = {};
let VARS = { light: {}, dark: {} };
const IMAGE_HASH = {};
const errors = [];

// ------------------------------------------------------------ 글꼴
function walk(node, fn) {
  fn(node);
  (node.children || []).forEach((c) => walk(c, fn));
  (node.fixedChildren || []).forEach((c) => walk(c, fn));
}

async function setupFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  const byFam = {};
  for (const f of fonts) (byFam[f.fontName.family] = byFam[f.fontName.family] || []).push(f.fontName.style);
  FAMILY = FAMILIES.find((f) => byFam[f]) || 'Inter';
  const weightOf = (style) => {
    const s = style.toLowerCase();
    for (const [w, names] of Object.entries(WEIGHT_NAMES)) if (names.includes(s)) return +w;
    return null;
  };
  const available = (byFam[FAMILY] || ['Regular', 'Bold']).map((s) => ({ s, w: weightOf(s) })).filter((x) => x.w);
  const used = new Set([400, 700]);
  DATA.screens.forEach((sc) => walk(sc.tree, (n) => (n.runs || []).forEach((r) => used.add(r.weight))));
  for (const w of used) {
    const best = available.slice().sort((a, b) => Math.abs(a.w - w) - Math.abs(b.w - w) || b.w - a.w)[0];
    STYLE_FOR[w] = best ? best.s : 'Regular';
  }
  const toLoad = new Set(Object.values(STYLE_FOR));
  await Promise.all([...toLoad].map((style) => figma.loadFontAsync({ family: FAMILY, style })));
  // 그래프 안의 글자(SVG)는 Inter 로 들어옴
  for (const style of ['Regular', 'Medium', 'Semi Bold', 'Bold']) {
    try { await figma.loadFontAsync({ family: 'Inter', style }); } catch (e) { /* 없는 굵기는 건너뜀 */ }
  }
}

// ------------------------------------------------------------ 색상 변수
async function setupVariables() {
  const existing = await figma.variables.getLocalVariableCollectionsAsync();
  const out = { light: {}, dark: {} };
  for (const th of THEMES) {
    const name = `자람 색상 · ${th.label}`;
    const col = existing.find((c) => c.name === name) || figma.variables.createVariableCollection(name);
    const modeId = col.modes[0].modeId;
    try { col.renameMode(modeId, th.mode); } catch (e) { /* 이름 변경 실패는 무시 */ }
    const current = await Promise.all(col.variableIds.map((id) => figma.variables.getVariableByIdAsync(id)));
    const byName = {};
    current.forEach((v) => { if (v) byName[v.name] = v; });
    for (const [tok, val] of Object.entries(DATA.tokens)) {
      const v = byName[tok] || figma.variables.createVariable(tok, col, 'COLOR');
      const a = th.key === 'light' ? val.l : val.d;
      v.setValueForMode(modeId, { r: a[0] / 255, g: a[1] / 255, b: a[2] / 255, a: a[3] });
      v.scopes = tok.startsWith('series') || tok.startsWith('chart') ? ['STROKE_COLOR', 'ALL_FILLS'] : ['ALL_FILLS', 'STROKE_COLOR', 'EFFECT_COLOR'];
      try { v.setVariableCodeSyntax('WEB', `var(--${tok})`); } catch (e) { /* 선택 기능 */ }
      out[th.key][tok] = v;
    }
  }
  return out;
}

const rgb01 = (a) => ({ r: a[0] / 255, g: a[1] / 255, b: a[2] / 255 });

function solid(color, theme) {
  if (!color) return null;
  if (color.tok && VARS[theme][color.tok]) {
    return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', VARS[theme][color.tok]);
  }
  const a = theme === 'light' ? color.l : (color.d || color.l);
  if (!a) return null;
  /** @type {SolidPaint} */
  const paint = { type: 'SOLID', color: rgb01(a), opacity: a[3] };
  return paint;
}

function gradientPaint(g, theme) {
  // CSS 각도(0 = 위쪽, 90 = 오른쪽) → Figma gradientTransform
  const rad = ((g.angle - 90) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[cos, sin, 0.5 - 0.5 * cos - 0.5 * sin], [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos]],
    gradientStops: g.stops.map((s) => {
      const a = theme === 'light' ? s.color.l : s.color.d;
      return { position: Math.max(0, Math.min(1, s.pos)), color: { r: a[0] / 255, g: a[1] / 255, b: a[2] / 255, a: a[3] } };
    }),
  };
}

// ------------------------------------------------------------ 크기 방식 (FILL / HUG / FIXED)
function isAutoLayout(node) {
  return node && node.type === 'FRAME' && node.layoutMode !== 'NONE';
}

function placeAbsolute(node, n) {
  node.layoutPositioning = 'ABSOLUTE';
  node.x = n.rel ? n.rel.x : 0;
  node.y = n.rel ? n.rel.y : 0;
  if (n.constraints) node.constraints = { horizontal: n.constraints.h, vertical: n.constraints.v };
}

function applySizing(node, n, parent) {
  if (!isAutoLayout(parent)) return;
  if (n.abs) {
    placeAbsolute(node, n);
    if (isAutoLayout(node)) {
      if (n.sizing && n.sizing.h === 'HUG') node.layoutSizingHorizontal = 'HUG';
      if (n.sizing && n.sizing.v === 'HUG') node.layoutSizingVertical = 'HUG';
    }
    return;
  }
  const s = n.sizing || { h: 'FIXED', v: 'FIXED' };
  const canHug = isAutoLayout(node) || node.type === 'TEXT';
  node.layoutSizingHorizontal = s.h === 'HUG' && !canHug ? 'FIXED' : s.h;
  node.layoutSizingVertical = s.v === 'HUG' && !canHug ? 'FIXED' : s.v;
}

// ------------------------------------------------------------ 노드 만들기
function buildNode(n, theme, parent) {
  if (n.t === 'frame') return buildFrame(n, theme, parent);
  if (n.t === 'text') return buildText(n, theme, parent);
  if (n.t === 'svg') return buildSvg(n, theme, parent);
  if (n.t === 'image') return buildImage(n, parent);
  if (n.t === 'spacer') return buildSpacer(n, parent);
  return null;
}

function styleFrame(f, n, theme) {
  const st = n.style || {};
  const fills = [];
  if (st.fill) { const p = solid(st.fill, theme); if (p) fills.push(p); }
  if (st.gradient) fills.push(gradientPaint(st.gradient, theme));
  f.fills = fills;
  f.clipsContent = !!st.clip;
  const [tl, tr, br, bl] = st.radius || [0, 0, 0, 0];
  f.topLeftRadius = tl; f.topRightRadius = tr; f.bottomRightRadius = br; f.bottomLeftRadius = bl;
  if (st.stroke) {
    const p = solid(st.stroke.color, theme);
    if (p) {
      f.strokes = [p];
      f.strokeAlign = 'INSIDE';
      const [t, r, b, l] = st.stroke.weights;
      if (t === r && r === b && b === l) f.strokeWeight = t;
      else { f.strokeTopWeight = t; f.strokeRightWeight = r; f.strokeBottomWeight = b; f.strokeLeftWeight = l; }
    }
  }
  const effects = [];
  if (st.blur) effects.push({ type: 'BACKGROUND_BLUR', blurType: 'NORMAL', radius: st.blur, visible: true });
  for (const sh of st.shadows || []) {
    const a = theme === 'light' ? sh.color.l : sh.color.d;
    effects.push({
      type: 'DROP_SHADOW', color: { r: a[0] / 255, g: a[1] / 255, b: a[2] / 255, a: a[3] },
      offset: { x: sh.x, y: sh.y }, radius: sh.blur, spread: sh.spread || 0, visible: true, blendMode: 'NORMAL',
    });
  }
  if (effects.length) f.effects = effects;
  if (st.opacity !== undefined) f.opacity = st.opacity;
}

function buildFrame(n, theme, parent) {
  const f = figma.createFrame();
  f.name = n.name;
  styleFrame(f, n, theme);
  const al = n.al || { mode: 'VERTICAL', main: 'MIN', cross: 'MIN', spacing: 0, pad: [0, 0, 0, 0] };
  f.layoutMode = al.mode;
  if (al.wrap && al.mode === 'HORIZONTAL') {
    f.layoutWrap = 'WRAP';
    f.counterAxisSpacing = al.crossSpacing || 0;
  }
  f.itemSpacing = al.spacing || 0;
  f.paddingTop = al.pad[0]; f.paddingRight = al.pad[1]; f.paddingBottom = al.pad[2]; f.paddingLeft = al.pad[3];
  f.primaryAxisAlignItems = al.main;
  f.counterAxisAlignItems = al.cross === 'BASELINE' && al.mode !== 'HORIZONTAL' ? 'MIN' : al.cross;
  f.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
  parent.appendChild(f);
  if (parent.type === 'PAGE') {
    f.primaryAxisSizingMode = 'FIXED';
    f.counterAxisSizingMode = 'FIXED';
  } else {
    applySizing(f, n, parent);
  }
  for (const c of n.children || []) {
    try { buildNode(c, theme, f); } catch (e) { errors.push(`${n.name} > ${c.name}: ${e.message}`); }
  }
  if (n.style && n.style.divider) {
    const line = figma.createRectangle();
    line.name = 'divider';
    const inset = n.style.divider.inset || 0;
    line.resize(Math.max(1, n.w - inset * 2), 1);
    const p = solid(n.style.divider.color, theme);
    line.fills = p ? [p] : [];
    f.appendChild(line);
    placeAbsolute(line, { rel: { x: inset, y: 0 }, constraints: { h: 'STRETCH', v: 'MIN' } });
  }
  return f;
}

function buildText(n, theme, parent) {
  if (!n.runs || !n.runs.length) return null;
  const t = figma.createText();
  t.name = n.name;
  const first = n.runs[0];
  t.fontName = { family: FAMILY, style: STYLE_FOR[first.weight] || 'Regular' };
  t.characters = n.runs.map((r) => r.text).join('');
  let i = 0;
  for (const r of n.runs) {
    const j = i + r.text.length;
    if (j > i) {
      t.setRangeFontName(i, j, { family: FAMILY, style: STYLE_FOR[r.weight] || 'Regular' });
      t.setRangeFontSize(i, j, r.size);
      const p = solid(r.color, theme);
      if (p) t.setRangeFills(i, j, [p]);
      if (r.ls) t.setRangeLetterSpacing(i, j, { unit: 'PIXELS', value: r.ls });
      if (r.lh) t.setRangeLineHeight(i, j, { unit: 'PIXELS', value: r.lh });
    }
    i = j;
  }
  t.textAlignHorizontal = n.align || 'LEFT';
  parent.appendChild(t);
  const s = n.sizing || { h: 'HUG', v: 'HUG' };
  if (n.abs && isAutoLayout(parent)) {
    placeAbsolute(t, n);
    if (n.wrap) { t.resize(Math.max(1, n.w), Math.max(1, n.h)); t.textAutoResize = 'HEIGHT'; } else t.textAutoResize = 'WIDTH_AND_HEIGHT';
    return t;
  }
  if (s.h === 'FILL') {
    t.resize(Math.max(1, n.w), Math.max(1, n.h));
    t.textAutoResize = 'HEIGHT';
    if (isAutoLayout(parent)) t.layoutSizingHorizontal = 'FILL';
  } else if (s.h === 'FIXED') {
    t.resize(Math.max(1, n.w), Math.max(1, n.h));
    t.textAutoResize = 'HEIGHT';
  } else {
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  return t;
}

function buildSvg(n, theme, parent) {
  const src = typeof n.svg === 'string' ? n.svg : (theme === 'light' ? n.svg.l : n.svg.d);
  let node;
  try {
    node = figma.createNodeFromSvg(src);
  } catch (e) {
    errors.push(`SVG ${n.name}: ${e.message}`);
    node = figma.createFrame();
  }
  node.name = n.name;
  node.fills = [];
  node.clipsContent = false;
  if (Math.abs(node.width - n.w) > 0.5 || Math.abs(node.height - n.h) > 0.5) node.rescale(Math.max(0.01, n.w / Math.max(0.01, node.width)));
  parent.appendChild(node);
  applySizing(node, { ...n, sizing: { h: 'FIXED', v: 'FIXED' } }, parent);
  return node;
}

function buildImage(n, parent) {
  const r = figma.createRectangle();
  r.name = n.name || 'photo';
  r.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
  const hash = IMAGE_HASH[n.img];
  r.fills = hash ? [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FILL' }] : [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
  const [tl, tr, br, bl] = n.radius || [0, 0, 0, 0];
  r.topLeftRadius = tl; r.topRightRadius = tr; r.bottomRightRadius = br; r.bottomLeftRadius = bl;
  parent.appendChild(r);
  applySizing(r, { ...n, sizing: { h: 'FIXED', v: 'FIXED' } }, parent);
  return r;
}

function buildSpacer(n, parent) {
  const s = figma.createFrame();
  s.name = 'spacer';
  s.fills = [];
  s.resize(Math.max(0.01, n.w), Math.max(0.01, n.h));
  parent.appendChild(s);
  applySizing(s, { sizing: { h: 'FIXED', v: 'FIXED' } }, parent);
  return s;
}

function buildScreen(screen, theme, page, x, y) {
  const root = buildFrame({ ...screen.tree, name: `${screen.name} — ${theme === 'light' ? 'Light' : 'Dark'}`, w: screen.w, h: screen.h }, theme, page);
  root.x = x;
  root.y = y;
  root.clipsContent = true;
  // 스크롤되는 긴 화면은 높이를 내용에 맞춤(HUG): 글꼴이 달라 글자 높이가 바뀌어도 잘리지 않게.
  // 하단 탭바·버튼은 '아래 고정' 제약으로 항상 바닥에 붙어 있음.
  if (screen.h > (screen.tree.viewH || 844) + 1) root.primaryAxisSizingMode = 'AUTO';
  for (const fc of screen.tree.fixedChildren || []) {
    try {
      const node = buildNode(fc, theme, root);
      if (node && node.layoutPositioning !== 'ABSOLUTE') placeAbsolute(node, fc);
    } catch (e) { errors.push(`${screen.name} 고정 요소 ${fc.name}: ${e.message}`); }
  }
  return root;
}

// ------------------------------------------------------------ 실행
async function run() {
  figma.notify('자람 화면을 만드는 중이에요… (30초 정도 걸려요)', { timeout: 4000 });
  await setupFonts();
  VARS = await setupVariables();
  for (const [key, b64] of Object.entries(DATA.images)) {
    try { IMAGE_HASH[key] = figma.createImage(figma.base64Decode(b64)).hash; } catch (e) { errors.push(`이미지 ${key}: ${e.message}`); }
  }

  let page = figma.root.children.find((p) => p.name === PAGE_NAME);
  if (!page) { page = figma.createPage(); page.name = PAGE_NAME; }
  await figma.setCurrentPageAsync(page);
  for (const child of [...page.children]) child.remove();

  const made = [];
  let y = 0;
  for (const th of THEMES) {
    let x = 0;
    let rowH = 0;
    for (const screen of DATA.screens) {
      try {
        const f = buildScreen(screen, th.key, page, x, y);
        made.push(f);
        x += screen.w + GAP_X;
        rowH = Math.max(rowH, f.height);
      } catch (e) {
        errors.push(`${screen.name} (${th.label}): ${e.message}`);
      }
    }
    y += rowH + GAP_Y;
  }
  figma.viewport.scrollAndZoomIntoView(made);
  if (errors.length) console.error('자람 플러그인 경고', errors);
  figma.closePlugin(`완료: 화면 ${made.length}개 · 글꼴 ${FAMILY}${errors.length ? ` · 경고 ${errors.length}개(콘솔 참고)` : ''}`);
}

run().catch((e) => {
  console.error(e);
  figma.closePlugin(`오류: ${e.message}`);
});
