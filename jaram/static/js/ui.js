// 화면을 만드는 작은 도우미들 (프레임워크 없이 순수 자바스크립트)

/**
 * DOM 요소 만들기. 문자열 자식은 textContent 로 넣어서 사용자가 입력한 글자가 HTML 로 해석되지 않습니다.
 * h('button', { class: 'btn', onclick: fn }, '저장')
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v; // 신뢰할 수 있는 고정 문자열(아이콘)에만 사용
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

// ---------------------------------------------------------------- 아이콘 (24px, 선 굵기 1.8)
const P = (d) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  home: P('<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'),
  chart: P('<path d="M4 19h16"/><path d="M7 15.5v-4"/><path d="M12 15.5V7"/><path d="M17 15.5v-6.5"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  camera: P('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>'),
  back: P('<path d="m15 5-7 7 7 7"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevron: P('<path d="m9 6 6 6-6 6"/>'),
  chevronDown: P('<path d="m6 9 6 6 6-6"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  more: P('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
  leaf: P('<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/>'),
  sprout: P('<path d="M12 20v-8"/><path d="M12 12c0-3.5-2.5-6-7-6 0 3.5 2.5 6 7 6z"/><path d="M12 14c0-3.5 2.5-6 7-6 0 3.5-2.5 6-7 6z"/>'),
  drop: P('<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  temp: P('<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 15.5V9"/>'),
  humidity: P('<path d="M7 16a5 5 0 0 0 10 0c0-3.5-5-9-5-9s-5 5.5-5 9z"/><path d="M10 16.5a2 2 0 0 0 2 2"/>'),
  soil: P('<path d="M3 17h18"/><path d="M5 20.5h14"/><path d="M12 17V9"/><path d="M12 11c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4zM12 10c0-2.5 1.5-4 4-4 0 2.5-1.5 4-4 4z"/>'),
  move: P('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  scissors: P('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 17M8 16.5 20 7"/>'),
  flask: P('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>'),
  note: P('<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8 13h8M8 17h5"/>'),
  ruler: P('<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>'),
  crop: P('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
  cube: P('<path d="M12 2.8 20 7v10l-8 4.2L4 17V7z"/><path d="M4 7l8 4.2L20 7M12 11.2V21"/>'),
  rotate: P('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  swap: P('<path d="m9 7-4 5 4 5"/><path d="m15 7 4 5-4 5"/>'),
  trash: P('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  warn: P('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  checkCircle: P('<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.7L16 9.5"/>'),
  eye: P('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  image: P('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8.5 8.5"/>'),
  flip: P('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><path d="M9 12.5a3 3 0 0 1 5.2-2M15 13.5a3 3 0 0 1-5.2 2"/><path d="M14.5 8.5v2h-2M9.5 17.5v-2h2"/>'),
  download: P('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
  refresh: P('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>'),
  moon: P('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  book: P('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>'),
  sliders: P('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  up: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5 10 8.5H2z" fill="currentColor"/></svg>',
  down: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 9.5 2 3.5h8z" fill="currentColor"/></svg>',
};

export function icon(name, cls) {
  const span = document.createElement('span');
  span.className = 'ico' + (cls ? ' ' + cls : '');
  span.style.display = 'contents';
  span.innerHTML = icons[name] || '';
  return span;
}

// ---------------------------------------------------------------- 숫자·날짜 형식
export function fmt(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 0 : abs >= 100 ? Math.min(digits, 1) : digits;
  return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
export function signed(v, digits = 1) {
  if (v === null || v === undefined) return '–';
  const s = fmt(v, digits);
  return v > 0 ? '+' + s : s;
}
export function areaUnit(unit) { return unit === 'cm' ? 'cm²' : 'px'; }

/** 증감 표시: 숫자 + 화살표 아이콘 + 색 (색만으로 의미를 전달하지 않도록 화살표를 함께 표시) */
export function deltaEl(v, { suffix = '', digits = 1, goodWhenUp = true } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return h('span', { class: 'delta flat' }, '–');
  const dir = Math.abs(v) < 1e-9 ? 'flat' : v > 0 ? 'up' : 'down';
  const good = dir === 'flat' ? 'flat' : (dir === 'up') === goodWhenUp ? 'up' : 'down';
  return h('span', { class: `delta ${good}` },
    dir === 'flat' ? null : h('span', { html: dir === 'up' ? icons.up : icons.down, style: { display: 'inline-flex' } }),
    fmt(Math.abs(v), digits) + suffix,
    h('span', { class: 'sr-only' }, dir === 'up' ? ' 증가' : dir === 'down' ? ' 감소' : ''));
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function parseDate(s) { return s instanceof Date ? s : new Date(s); }
export function dateLong(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}
export function dateShort(s) { const d = parseDate(s); return `${d.getMonth() + 1}.${d.getDate()}`; }
export function timeShort(s) {
  const d = parseDate(s);
  const hh = d.getHours();
  return `${hh < 12 ? '오전' : '오후'} ${((hh + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function dateTime(s) { return `${dateLong(s)} ${timeShort(s)}`; }
export function relDays(s) {
  const d = parseDate(s);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  return `${diff}일 전`;
}
export function daysText(days) {
  if (days === null || days === undefined) return '–';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}시간`;
  return `${fmt(days, days < 10 ? 1 : 0)}일`;
}
export function toLocalInput(s) {
  const d = parseDate(s || new Date());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function isToday(s) {
  const d = parseDate(s); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// ---------------------------------------------------------------- 상태 배지
const STATUS_ICON = { good: 'checkCircle', observe: 'eye', care: 'warn', pending: 'sprout', info: 'info' };
export function statusBadge(status, label) {
  return h('span', { class: `badge badge-${status}` }, h('span', { html: icons[STATUS_ICON[status]] || '', style: { display: 'inline-flex' } }), label);
}

// ---------------------------------------------------------------- 공통 화면 요소
export function topbar({ title = '', back = true, right = null, onBack } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', 'aria-label': '뒤로', html: icons.back, onclick: onBack || (() => goBack()) }) : h('span', { class: 'topbar-spacer' }),
    h('div', { class: 'topbar-title' }, title),
    right || h('span', { class: 'topbar-spacer' }));
}

export function goBack(fallback = '#/') {
  if (history.length > 1 && sessionStorage.getItem('jaram-nav') === '1') history.back();
  else location.hash = fallback;
}

export function segmented(options, value, onChange, cls = 'seg') {
  const wrap = h('div', { class: cls, role: 'group' });
  const render = (val) => {
    wrap.replaceChildren(...options.map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String(v === val),
      onclick: () => { if (v !== val) { render(v); onChange(v); } },
    }, label)));
  };
  render(value);
  return wrap;
}

export function chips(options, value, onChange, cls = 'chips') {
  const wrap = h('div', { class: cls, role: 'group' });
  const render = (val) => {
    wrap.replaceChildren(...options.map(([v, label]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(v === val),
      onclick: () => { if (v !== val) { render(v); onChange(v); } },
    }, label)));
  };
  render(value);
  return wrap;
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('div', { class: 'field-hint' }, hint) : null);
}

export function numberInput({ name, value, unit, placeholder, step = 'any', min, max }) {
  return h('div', { class: 'input-wrap' },
    h('input', {
      class: 'input num', name, type: 'number', inputmode: 'decimal', step, min, max,
      value: value ?? '', placeholder: placeholder ?? '',
    }),
    unit ? h('span', { class: 'unit' }, unit) : null);
}

export function skeleton(height = 80, mt = 12) {
  return h('div', { class: 'skeleton', style: { height: height + 'px', marginTop: mt + 'px' } });
}

// ---------------------------------------------------------------- 토스트
let toastTimer;
export function toast(message, { error = false } = {}) {
  const layer = document.getElementById('layer');
  layer.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast' + (error ? ' error' : ''), role: 'status' },
    h('span', { html: error ? icons.warn : icons.checkCircle, style: { display: 'inline-flex' } }), message);
  layer.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

// ---------------------------------------------------------------- 바텀 시트
export function sheet(build) {
  const layer = document.getElementById('layer');
  let closed = false;
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-handle' }));
  backdrop.appendChild(panel);
  const close = () => new Promise((resolve) => {
    if (closed) return resolve();
    closed = true;
    backdrop.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { backdrop.remove(); resolve(); }, 190);
  });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  // 아래로 끌어서 닫기
  let startY = null;
  panel.addEventListener('touchstart', (e) => { if (panel.scrollTop <= 0) startY = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (dy > 110) close(); else panel.style.transform = '';
  });
  const content = build(close);
  if (Array.isArray(content)) content.forEach((c) => c && panel.appendChild(c));
  else if (content) panel.appendChild(content);
  layer.appendChild(backdrop);
  setTimeout(() => panel.querySelector('[autofocus]')?.focus(), 320);
  return { close, panel };
}

export function confirmSheet({ title, desc, ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet((close) => [
      h('h2', { class: 'sheet-title' }, title),
      desc ? h('p', { class: 'sheet-desc' }, desc) : null,
      h('div', { class: 'btn-row actions' },
        h('button', { class: 'btn btn-secondary', onclick: () => { answered = true; close(); resolve(false); } }, '취소'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { answered = true; close(); resolve(true); } }, ok)),
    ]);
    s.panel.parentElement.addEventListener('click', (e) => { if (e.target === s.panel.parentElement && !answered) resolve(false); });
  });
}

/** form 안의 input 값을 객체로 (빈 값은 null) */
export function formValues(root) {
  const out = {};
  root.querySelectorAll('input[name], textarea[name], select[name]').forEach((el) => {
    const v = el.value.trim();
    out[el.name] = v === '' ? null : el.type === 'number' ? Number(v) : v;
  });
  return out;
}
