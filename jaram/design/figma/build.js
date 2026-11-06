#!/usr/bin/env node
// 자람 화면 → Figma 플러그인 데이터 만들기
//
//   1) 앱 서버를 켭니다 (데모 데이터 권장)
//        python seed_demo.py && JARAM_DATA=data-demo python app.py --port 5000
//   2) 이 스크립트를 실행합니다 (Node 18+, Playwright 필요)
//        node design/figma/build.js http://127.0.0.1:5000
//   3) design/figma/plugin/ 폴더를 Figma 데스크톱 앱에서 플러그인으로 불러와 실행합니다.
//
// 화면마다 라이트·다크를 각각 읽어 와서 색을 CSS 변수(토큰)와 짝지은 뒤,
// DOM 배치를 Figma 오토레이아웃 속성(방향, 간격, 여백, FILL/HUG/FIXED)으로 바꿉니다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.argv[2] || 'http://127.0.0.1:5000').replace(/\/$/, '');
const OUT_DIR = path.join(__dirname, 'plugin');
const EXTRACT = fs.readFileSync(path.join(__dirname, 'extract.js'), 'utf8');
const FONT_FILE = process.env.PRETENDARD_WOFF2; // 선택: 오프라인에서 Pretendard 로 측정하고 싶을 때

const SCREENS = [
  { name: '01 홈', route: '/' },
  { name: '02 식물 상세', route: '/plant/2', open: '.why' },
  { name: '03 촬영', route: '/plant/2/capture' },
  { name: '04 분석 결과', route: '/m/LATEST?new=1' },
  { name: '05 크기 보정', route: '/plant/2/calibrate' },
  { name: '06 리포트', route: '/report' },
  { name: '07 설정', route: '/settings' },
  { name: '08 바질 기준', route: '/settings/species/basil' },
  { name: '09 추천 알고리즘', route: '/settings/algorithm' },
  { name: '10 식물 등록', route: '/plant/new' },
  { name: '11 식물 선택 시트', route: '/', action: 'picker', viewport: true },
  { name: '12 관리 기록 시트', route: '/plant/3', action: 'care', viewport: true },
  { name: '13 분석 영역 지정', route: '/plant/2/roi', viewport: true },
  { name: '14 3D 측정 촬영', route: '/plant/4/scan' },
  { name: '15 3D 측정 결과', route: '/scan/LATEST_SCAN' },
  { name: '16 기준 제안 시트', route: '/settings/species/basil', action: 'suggest', viewport: true },
  { name: '17 추천 효과 검증', route: '/report/validation' },
  // 로그인 화면을 띄우면 다른 화면으로 돌아가지 않으므로 맨 마지막에
  { name: '18 로그인', route: '/', action: 'login', viewport: true },
];

// ---------------------------------------------------------------- 1. 화면 읽기
async function extractAll() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    console.error('Playwright 가 필요해요: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  const plant2 = await fetch(`${BASE}/api/plants/2`).then((r) => r.json())
    .catch(() => { throw new Error(`서버(${BASE})에서 식물 2번을 찾을 수 없어요. 데모 데이터로 서버를 켜 주세요.`); });
  const latest = plant2.measurements.at(-1).id;
  const latestScan = (plant2.scans || []).at(-1)?.id ?? 1;
  const browser = await chromium.launch();
  const result = {};
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    if (FONT_FILE) {
      const font = fs.readFileSync(FONT_FILE);
      await page.route('https://cdn.jsdelivr.net/**', (r) => (r.request().url().endsWith('.css')
        ? r.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Pretendard Variable';font-weight:45 920;src:url('https://cdn.jsdelivr.net/f.woff2') format('woff2-variations');}" })
        : r.fulfill({ contentType: 'font/woff2', body: font })));
    }
    for (const s of SCREENS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/#${s.route.replace('LATEST_SCAN', latestScan).replace('LATEST', latest)}`);
      await page.waitForTimeout(1300);
      if (s.action === 'suggest') { await page.click('.suggest-entry'); await page.waitForSelector('.suggest-item'); await page.waitForTimeout(700); }
      if (s.action === 'picker') { await page.click('.tab-capture'); await page.waitForTimeout(900); }
      if (s.action === 'care') { await page.click('.cta .btn-secondary'); await page.waitForTimeout(900); }
      if (s.action === 'login') { await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaram:login-required'))); await page.waitForTimeout(600); }
      if (s.open) { await page.evaluate((sel) => document.querySelectorAll(sel).forEach((d) => { d.open = true; }), s.open); }
      if (!s.viewport) {
        const h = await page.evaluate(() => Math.max(844, document.documentElement.scrollHeight));
        await page.setViewportSize({ width: 390, height: Math.min(h, 8000) });
        await page.waitForTimeout(700);
      }
      // 화면 밖이라 늦게 불러오는(lazy) 사진도 모두 불러오기
      await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; }));
      await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      const data = await page.evaluate(`${EXTRACT}\n;extractTree(${JSON.stringify({ name: s.name, viewportOnly: !!s.viewport })})`);
      (result[s.name] ||= {})[theme] = data;
      process.stdout.write(`  ${theme} ${s.name} (${data.height}px)\n`);
    }
    await ctx.close();
  }
  await browser.close();
  return result;
}

// ---------------------------------------------------------------- 2. 라이트·다크 짝짓기 → 토큰
const eq = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.02);

function makeColorResolver(tokensL, tokensD) {
  const names = Object.keys(tokensL).filter((n) => tokensD[n]);
  const prefer = (n) => (/^(series|chart|status)/.test(n) ? 1 : 0);
  names.sort((a, b) => prefer(a) - prefer(b));
  return (l, d) => {
    if (!l) return null;
    const tok = names.find((n) => eq(tokensL[n], l) && eq(tokensD[n], d));
    if (tok) return { tok };
    return { l, d: d || l };
  };
}

function merge(L, D, resolve) {
  // 같은 구조라고 가정하고 나란히 걸어 가며 색을 {tok} 또는 {l, d} 로 바꿈
  const sameShape = D && D.t === L.t && (D.children || []).length === (L.children || []).length;
  const d = sameShape ? D : null;
  const out = { ...L };
  if (L.style) {
    const s = { ...L.style };
    const ds = d && d.style ? d.style : {};
    if (s.fill) s.fill = resolve(s.fill, ds.fill);
    if (s.stroke) s.stroke = { ...s.stroke, color: resolve(s.stroke.color, ds.stroke && ds.stroke.color) };
    if (s.divider) s.divider = { ...s.divider, color: resolve(s.divider.color, ds.divider && ds.divider.color) };
    if (s.shadows) s.shadows = s.shadows.map((sh, i) => ({ ...sh, color: { l: sh.color, d: (ds.shadows && ds.shadows[i] && ds.shadows[i].color) || sh.color } }));
    if (s.gradient) s.gradient = { angle: s.gradient.angle, stops: s.gradient.stops.map((st, i) => ({ pos: st.pos, color: { l: st.color, d: (ds.gradient && ds.gradient.stops[i] && ds.gradient.stops[i].color) || st.color } })) };
    out.style = s;
  }
  if (L.runs) out.runs = L.runs.map((r, i) => ({ ...r, color: resolve(r.color, d && d.runs && d.runs[i] && d.runs[i].color) }));
  if (L.t === 'svg') { out.svg = { l: L.svg, d: (d && d.svg) || L.svg }; }
  if (L.children) out.children = L.children.map((c, i) => merge(c, d && d.children[i], resolve));
  if (L.fixedChildren) out.fixedChildren = L.fixedChildren.map((c, i) => merge(c, D && D.fixedChildren && D.fixedChildren[i], resolve));
  return out;
}

// ---------------------------------------------------------------- 3. 오토레이아웃 추론
const near = (a, b, t = 1.5) => Math.abs(a - b) <= t;
const R = (v) => Math.round(v * 10) / 10;

function infer(node, parent) {
  if (node.t !== 'frame') return node;
  const lay = node.layout || { mode: 'V', main: 'MIN', cross: 'MIN', gap: 0 };
  let kids = node.children || [];
  const [cpT, cpR, cpB, cpL] = node.pad || [0, 0, 0, 0];

  // 블록 안에서 한 줄에 나란히 있는 내용(글자 + 배지 등) → 가로 줄바꿈 배치
  let mode = lay.mode;
  let wrap = !!lay.wrap;
  const flow0 = kids.filter((k) => !k.abs);
  if (lay.block && flow0.length > 1 && flow0.some((k, i) => i && k.y < flow0[i - 1].y + flow0[i - 1].h - 2 && k.x >= flow0[i - 1].x + flow0[i - 1].w - 2)) {
    mode = 'H'; wrap = true;
    lay.cross = 'CENTER';
  }

  // 부모 여백을 벗어나는 자식(음수 margin) → 절대 위치 + 같은 높이의 빈칸
  const contentL = node.x + cpL;
  const contentR = node.x + node.w - cpR;
  const next = [];
  for (const k of kids) {
    if (!k.abs && mode === 'V' && (k.x < contentL - 1.5 || k.x + k.w > contentR + 1.5)) {
      next.push({ t: 'spacer', name: `${k.name} 자리`, x: contentL, y: k.y, w: Math.max(1, contentR - contentL), h: k.h });
      next.push({ ...k, abs: true });
    } else next.push(k);
  }
  kids = next;
  // 세로 배치에서 margin: auto 로 가운데(또는 오른쪽)에 놓인 자식 → 정렬용 투명 래퍼로 감싸기
  if (mode === 'V' && (lay.cross || 'MIN') === 'MIN') {
    kids = kids.map((k) => {
      if (k.abs || k.t === 'spacer') return k;
      const left = k.x - contentL;
      const right = contentR - (k.x + k.w);
      if (left < 1 || k.w >= contentR - contentL - 1.5) return k;
      const centered = Math.abs(left - right) <= 1.5;
      const rightAligned = right < 1;
      if (!centered && !rightAligned) return k;
      return {
        t: 'frame', name: `${k.name} 정렬`, x: contentL, y: k.y, w: contentR - contentL, h: k.h, style: {}, pad: [0, 0, 0, 0],
        flexGrow: 0, layout: { mode: 'H', main: centered ? 'CENTER' : 'MAX', cross: 'MIN', gap: 0 }, children: [k], wrapper: true,
      };
    });
  }
  const flow = kids.filter((k) => !k.abs);

  // 한 줄짜리 그리드(입력칸 2개, 범위 입력 등) → 줄바꿈 없는 가로 배치, 큰 칸은 FILL
  let gridRowFill = false;
  if (lay.grid > 1 && kids.filter((k) => !k.abs).length <= lay.grid) { wrap = false; gridRowFill = true; }
  const H = mode === 'H';
  const al = {
    main: lay.main || 'MIN',
    cross: lay.cross === 'BASELINE' && !H ? 'MIN' : (lay.cross || 'MIN'),
  };

  // 여백: 주 방향은 실제 위치에서(바깥 margin 포함), 교차 방향은 CSS 값
  let pad = [cpT, cpR, cpB, cpL];
  if (flow.length && !wrap && al.main === 'MIN') {
    if (H) {
      pad[3] = R(Math.min(...flow.map((k) => k.x)) - node.x);
      pad[1] = R(node.x + node.w - Math.max(...flow.map((k) => k.x + k.w)));
    } else {
      pad[0] = R(Math.min(...flow.map((k) => k.y)) - node.y);
      pad[2] = R(node.y + node.h - Math.max(...flow.map((k) => k.y + k.h)));
    }
  }
  pad = pad.map((p) => Math.max(0, R(p)));

  // 간격: 모두 같으면 itemSpacing, 아니면 빈칸(spacer) 삽입
  let spacing = 0;
  let items = flow;
  if (flow.length > 1 && al.main !== 'SPACE_BETWEEN') {
    if (wrap && lay.grid) {
      spacing = lay.gap;
    } else {
      const gaps = flow.slice(1).map((k, i) => (H ? k.x - (flow[i].x + flow[i].w) : k.y - (flow[i].y + flow[i].h)));
      const uniform = gaps.every((g) => near(g, gaps[0], 1));
      if (uniform && gaps[0] >= 0) spacing = R(gaps[0]);
      else if (wrap) spacing = lay.block ? R(Math.max(0, Math.min(...gaps.filter((g) => g >= 0).concat([4])))) : R(lay.gap || 0);
      else {
        items = [];
        flow.forEach((k, i) => {
          items.push(k);
          const g = gaps[i];
          if (g !== undefined && g > 0.5) {
            items.push(H
              ? { t: 'spacer', name: 'spacer', x: k.x + k.w, y: k.y, w: R(g), h: 1 }
              : { t: 'spacer', name: 'spacer', x: k.x, y: k.y + k.h, w: 1, h: R(g) });
          }
        });
      }
    }
  }

  const contentW = node.w - pad[1] - pad[3];
  const contentH = node.h - pad[0] - pad[2];
  // 내용이 틀보다 크면 Figma 의 가운데 정렬은 위로 넘치게 되므로 시작 정렬로 (브라우저와 같게)
  if (al.main === 'CENTER' && flow.some((k) => (H ? k.w : k.h) > (H ? contentW : contentH) + 1)) al.main = 'MIN';

  // 자식 크기 방식 정하기 (절대 위치 자식은 흐름 자식 위에 쌓이도록 맨 뒤에)
  const out = [];
  for (const k0 of [...items, ...kids.filter((k) => k.abs)]) {
    const k = k0.t === 'frame' ? infer(k0, node) : { ...k0 };
    if (k.abs) {
      const left = k.x - node.x, top = k.y - node.y;
      const right = node.x + node.w - (k.x + k.w), bottom = node.y + node.h - (k.y + k.h);
      k.rel = { x: R(left), y: R(top) };
      k.constraints = {
        h: near(k.w, node.w, 2) ? 'STRETCH' : right < left - 1 ? 'MAX' : 'MIN',
        v: near(k.h, node.h, 2) ? 'STRETCH' : bottom < top - 1 ? 'MAX' : 'MIN',
      };
      k.sizing = { h: k.t === 'text' ? 'HUG' : 'FIXED', v: k.t === 'text' ? 'HUG' : 'FIXED' };
      if (k.t === 'frame' && k.hug && near(k.hug.w, k.w)) k.sizing.h = 'HUG';
      if (k.t === 'frame' && k.hug && near(k.hug.h, k.h)) k.sizing.v = 'HUG';
      if (k.t === 'text' && k.wrap) k.sizing.h = 'FIXED';
      out.push(k);
      continue;
    }
    let sh;
    let sv;
    if (k.t === 'spacer') {
      sh = H ? 'FIXED' : 'FIXED'; sv = 'FIXED';
      if (!H) { k.w = 1; } else { k.h = 1; }
    } else if (!H) {
      // 세로 배치
      if (k.w >= contentW - 1.5 && (k.t !== 'text' || k.block || k.wrap || k.align !== 'LEFT')) sh = 'FILL';
      else if (k.t === 'text') sh = k.wrap ? 'FIXED' : 'HUG';
      else if (k.t === 'frame') sh = k.hug && near(k.hug.w, k.w) ? 'HUG' : 'FIXED';
      else sh = 'FIXED';
      if (k.t === 'text') sv = 'HUG';
      else if (k.t === 'frame') sv = k.hug && near(k.hug.h, k.h) ? 'HUG' : 'FIXED';
      else sv = 'FIXED';
    } else {
      // 가로 배치
      const grow = (k.flexGrow > 0 && !wrap) || (gridRowFill && k.w >= 40);
      if (grow) sh = 'FILL';
      else if (k.t === 'text') sh = k.wrap ? 'FIXED' : 'HUG';
      else if (k.t === 'frame' && !lay.grid) sh = k.hug && near(k.hug.w, k.w) ? 'HUG' : 'FIXED';
      else sh = 'FIXED';
      if (lay.stretch && !wrap && k.t !== 'text' && near(k.h, contentH, 1.5) && k.alignSelf !== 'center') sv = 'FILL';
      else if (k.t === 'text') sv = 'HUG';
      else if (k.t === 'frame') sv = k.hug && near(k.hug.h, k.h) ? 'HUG' : 'FIXED';
      else sv = 'FIXED';
    }
    k.sizing = { h: sh, v: sv };
    out.push(k);
  }

  // 이 프레임이 내용에 맞춘(HUG) 크기라면 얼마일지 계산 (부모가 HUG/FIXED 판단에 사용)
  const fl = out.filter((k) => !k.abs);
  let hugW = pad[1] + pad[3];
  let hugH = pad[0] + pad[2];
  if (fl.length) {
    if (wrap) {
      hugW = node.w; // 줄바꿈 배치는 너비 고정으로 취급
      const rows = [];
      for (const k of fl) {
        const row = rows.find((r) => near(r.y, k.y, 3));
        if (row) row.h = Math.max(row.h, k.h); else rows.push({ y: k.y, h: k.h });
      }
      hugH += rows.reduce((a, r) => a + r.h, 0) + Math.max(0, rows.length - 1) * (lay.crossGap || 0);
    } else if (H) {
      hugW += fl.reduce((a, k) => a + k.w, 0) + spacing * (fl.length - 1);
      hugH += Math.max(...fl.map((k) => k.h));
    } else {
      hugH += fl.reduce((a, k) => a + k.h, 0) + spacing * (fl.length - 1);
      hugW += Math.max(...fl.map((k) => k.w));
    }
  } else {
    hugW = -1; hugH = -1; // 내용이 없으면 HUG 불가 → 고정
  }

  return {
    ...node,
    children: out,
    al: { mode: H ? 'HORIZONTAL' : 'VERTICAL', wrap, main: al.main, cross: al.cross === 'BASELINE' ? 'BASELINE' : al.cross, spacing, crossSpacing: wrap ? R(lay.crossGap || 0) : 0, pad },
    hug: { w: R(hugW), h: R(hugH) },
  };
}

function finalizeRoot(rootRaw, height, viewH) {
  const root = infer({ ...rootRaw, abs: false }, null);
  root.sizing = { h: 'FIXED', v: 'FIXED' };
  root.h = height;
  root.fixedChildren = (rootRaw.fixedChildren || []).map((f) => {
    const k = infer(f, root);
    k.abs = true;
    k.rel = { x: R(f.x - root.x), y: R(f.y - root.y) };
    k.constraints = {
      h: near(f.w, root.w, 2) ? 'STRETCH' : 'CENTER',
      v: f.fixed && f.fixed.cover ? 'STRETCH' : f.fixed && f.fixed.bottom ? 'MAX' : 'MIN',
    };
    k.sizing = { h: 'FIXED', v: k.hug && near(k.hug.h, k.h) && !(f.fixed && f.fixed.cover) ? 'HUG' : 'FIXED' };
    return k;
  });
  root.viewH = viewH;
  return root;
}

// ---------------------------------------------------------------- 4. 이미지 중복 제거 + 저장
function dedupeImages(screens, raw) {
  const images = {};
  const byHash = {};
  const remap = (node, imgs) => {
    if (node.t === 'image') {
      const b64 = imgs[node.img];
      const h = crypto.createHash('sha1').update(b64).digest('hex').slice(0, 12);
      if (!byHash[h]) { byHash[h] = `i${Object.keys(byHash).length + 1}`; images[byHash[h]] = b64; }
      node.img = byHash[h];
    }
    (node.children || []).forEach((c) => remap(c, imgs));
    (node.fixedChildren || []).forEach((c) => remap(c, imgs));
  };
  screens.forEach((s) => remap(s.tree, raw[s.name].light.images));
  return images;
}

async function main() {
  // 개발용: RAW_CACHE=파일경로 를 주면 추출 결과를 저장/재사용 (배치 추론만 고칠 때 빠르게)
  let raw;
  if (process.env.RAW_CACHE && fs.existsSync(process.env.RAW_CACHE)) raw = JSON.parse(fs.readFileSync(process.env.RAW_CACHE, 'utf8'));
  else {
    console.log(`화면 읽는 중: ${BASE}`);
    raw = await extractAll();
    if (process.env.RAW_CACHE) fs.writeFileSync(process.env.RAW_CACHE, JSON.stringify(raw));
  }
  const first = raw[SCREENS[0].name];
  const tokensL = first.light.tokens;
  const tokensD = first.dark.tokens;
  const resolve = makeColorResolver(tokensL, tokensD);
  const screens = SCREENS.map((s) => {
    const { light, dark } = raw[s.name];
    const merged = merge(light.tree, dark.tree, resolve);
    return { name: s.name, w: light.width, h: light.height, tree: finalizeRoot(merged, light.height, light.viewH) };
  });
  const images = dedupeImages(screens, raw);
  const usedTokens = new Set();
  const scan = (n) => {
    const t = (c) => c && c.tok && usedTokens.add(c.tok);
    if (n.style) { t(n.style.fill); t(n.style.stroke && n.style.stroke.color); t(n.style.divider && n.style.divider.color); }
    (n.runs || []).forEach((r) => t(r.color));
    (n.children || []).forEach(scan);
    (n.fixedChildren || []).forEach(scan);
  };
  screens.forEach((s) => scan(s.tree));
  const tokens = {};
  for (const n of Object.keys(tokensL)) if (tokensD[n]) tokens[n] = { l: tokensL[n], d: tokensD[n], used: usedTokens.has(n) };

  const data = { generatedAt: new Date().toISOString(), source: BASE, screens, tokens, images };
  const builder = fs.readFileSync(path.join(__dirname, 'builder.js'), 'utf8');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'code.js'), `// 자동 생성 파일 — design/figma/build.js 로 다시 만드세요.\nconst DATA = ${JSON.stringify(data)};\n\n${builder}`);
  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify({ ...data, images: Object.keys(images) }));
  const kb = Math.round(fs.statSync(path.join(OUT_DIR, 'code.js')).size / 1024);
  console.log(`완료: plugin/code.js (${kb}KB) — 화면 ${screens.length}개 × 라이트·다크, 토큰 ${Object.keys(tokens).length}개, 이미지 ${Object.keys(images).length}장`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { infer, merge, makeColorResolver };
