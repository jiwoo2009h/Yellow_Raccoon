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
  // 반올림하면 0이 되는 작은 음수가 '-0'으로 보이지 않게
  const r = Math.round(Number(v) * 10 ** d) / 10 ** d;
  return (r === 0 ? 0 : r).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
export function signed(v, digits = 1) {
  if (v === null || v === undefined) return '–';
  const s = fmt(v, digits);
  return v > 0 && s !== '0' ? '+' + s : s;
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
export const WEEKDAYS = WEEK;
/** 그 지역 날짜 'YYYY-MM-DD' (기록 시각은 시간대 없이 저장돼서 문자열 앞 10자리와 같아요) */
export function dayKey(s) {
  const d = parseDate(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fromDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
/** "10월 23일, 금요일" */
export function dateTitle(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일, ${WEEK[d.getDay()]}요일`;
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

/** 여러 개를 고르는 칩 (다시 누르면 해제). values: 처음에 고른 값들 */
export function multiChips(options, values, onChange, cls = 'chips in-card wrap') {
  const picked = new Set(values || []);
  return h('div', { class: cls, role: 'group' }, options.map(([v, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(picked.has(v)),
    onclick: (e) => {
      if (picked.has(v)) picked.delete(v); else picked.add(v);
      e.currentTarget.setAttribute('aria-pressed', String(picked.has(v)));
      onChange([...picked]);
    },
  }, label)));
}

/** 하나만 고르거나 아무것도 고르지 않을 수 있는 칩 (선택 입력용, 다시 누르면 해제) */
export function toggleChips(options, value, onChange, cls = 'chips in-card wrap') {
  let current = value ?? null;
  // 버튼을 다시 만들지 않고 눌림 상태만 바꿔서 키보드 포커스가 유지돼요
  const buttons = options.map(([v, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(v === current),
    onclick: () => {
      current = v === current ? null : v;
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === current)));
      onChange(current);
    },
  }, label));
  return h('div', { class: cls, role: 'group' }, buttons);
}

let uid = 0;
const LABELABLE = 'input, textarea, select';
/**
 * 입력칸 + 이름표. 입력칸이 하나면 <label> 로 감싸고,
 * 버튼 묶음(세그먼트·칩)처럼 입력칸이 아니면 <div role=group> 으로 감쌉니다.
 * (label 안에 버튼이 있으면 이름표 글자를 눌렀을 때 첫 버튼이 눌리는 문제가 있어요)
 */
export function field(label, control, hint) {
  const isInput = control instanceof Element && (control.matches(LABELABLE) || control.querySelectorAll(LABELABLE).length === 1);
  const hintEl = hint ? h('div', { class: 'field-hint' }, hint) : null;
  if (isInput) return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hintEl);
  const id = `fl-${++uid}`;
  return h('div', { class: 'field', role: 'group', 'aria-labelledby': id },
    h('span', { class: 'field-label', id }, label), control, hintEl);
}

/** 입력칸 옆에 오류 안내 표시 / 지우기 */
// 안내 문구는 입력칸(또는 최소~최대 한 줄) 바로 아래에 붙여요
const errorAnchor = (input) => input.closest('.range-row') || input.closest('.input-wrap') || input;
const errorKey = (input) => input.name || input.id || 'x';
function findError(input) {
  const anchor = errorAnchor(input);
  let el = anchor.nextElementSibling;
  while (el && el.classList.contains('field-error')) {
    if (el.dataset.for === errorKey(input)) return el;
    el = el.nextElementSibling;
  }
  return null;
}
export function markInvalid(input, message) {
  const wrap = input.closest('.input-wrap') || input;
  wrap.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
  let msg = findError(input);
  if (!msg) {
    msg = h('div', { class: 'field-error', role: 'alert', dataset: { for: errorKey(input) } });
    errorAnchor(input).after(msg);
  }
  msg.textContent = message;
  input.addEventListener('input', () => clearInvalid(input), { once: true });
}
export function clearInvalid(input) {
  const wrap = input.closest('.input-wrap') || input;
  wrap.classList.remove('invalid');
  input.removeAttribute('aria-invalid');
  findError(input)?.remove();
}

/** 숫자 칸에 숫자가 아닌 값이 들어 있으면 표시하고 false (브라우저는 이런 값을 빈 값으로 넘김) */
export function checkNumbers(root) {
  let first = null;
  root.querySelectorAll('input[type="number"]').forEach((el) => {
    if (el.validity && el.validity.badInput) {
      markInvalid(el, '숫자로 입력해 주세요');
      first = first || el;
    }
  });
  if (first) { first.focus(); return false; }
  return true;
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
  return h('div', { class: 'skeleton', 'aria-hidden': 'true', style: { height: height + 'px', marginTop: mt + 'px' } });
}

// ---------------------------------------------------------------- 오류 문구·중복 실행 방지
/** 사용자에게 보여 줄 오류 문구. 코드 오류("Cannot read properties…")는 일반 문구로 바꿉니다. */
export function friendlyError(err) {
  if (err && err.userFacing && err.message) return err.message;
  return '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}

/**
 * 버튼을 누른 동안 다시 누를 수 없게 잠그고 로딩 표시를 한 뒤 fn 을 실행합니다.
 * 오류는 토스트로 알려 주고 undefined 를 돌려줍니다.
 */
export async function withBusy(btn, fn, { quiet = false } = {}) {
  if (btn && (btn.disabled || btn.dataset.busy)) return undefined;
  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    return await fn();
  } catch (err) {
    if (err && err.status === 401) return undefined;
    if (!quiet) toast(friendlyError(err), { error: true });
    if (!(err && err.userFacing)) console.error(err);
    return undefined;
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
    }
  }
}

/** 실행 중에는 다시 부르지 않는 함수로 감쌉니다 (두 번 눌러도 한 번만 실행) */
export function exclusive(fn) {
  let running = false;
  return async (...args) => {
    if (running) return undefined;
    running = true;
    try { return await fn(...args); } finally { running = false; }
  };
}

// ---------------------------------------------------------------- 토스트
let toastTimer;
export function toast(message, { error = false } = {}) {
  const layer = document.getElementById('layer');
  layer.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h('div', { class: 'toast' + (error ? ' error' : ''), role: error ? 'alert' : 'status' },
    h('span', { class: 'toast-icon', html: error ? icons.warn : icons.checkCircle }), h('span', null, message));
  layer.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 240);
  }, error ? 4200 : 2600);
}

// ---------------------------------------------------------------- 바텀 시트 (넓은 화면에서는 가운데 대화상자)
const openSheets = [];
const wide = () => window.matchMedia && window.matchMedia('(min-width: 960px)').matches;

/** 화면을 옮길 때 열린 시트를 모두 '정상적으로' 닫습니다 (Promise 가 끝나고 리스너도 정리됨). */
export function closeAllSheets() {
  [...openSheets].forEach((s) => s.close(true));
}

export function sheet(build, { onClose, dismissible = true } = {}) {
  const layer = document.getElementById('layer');
  let closed = false;
  const opener = document.activeElement;
  const backdrop = h('div', { class: 'backdrop' });
  const titleId = `sheet-${++uid}`;
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }));
  if (dismissible) {
    panel.appendChild(h('button', { class: 'icon-btn sheet-close', type: 'button', 'aria-label': '닫기', html: icons.close, onclick: () => close() }));
  }
  backdrop.appendChild(panel);
  const entry = { close: (force) => close(force) };
  const close = (force = false) => new Promise((resolve) => {
    if (closed || (!dismissible && !force)) return resolve();
    closed = true;
    const i = openSheets.indexOf(entry);
    if (i >= 0) openSheets.splice(i, 1);
    backdrop.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    try { onClose?.(); } catch { /* 닫기 콜백 오류는 무시 */ }
    setTimeout(() => {
      backdrop.remove();
      // 시트를 연 버튼으로 초점을 돌려 키보드·스크린리더 사용자가 길을 잃지 않게
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
      resolve();
    }, 200);
  });
  // Esc 는 맨 위 시트만 닫기
  const onKey = (e) => { if (e.key === 'Escape' && openSheets[openSheets.length - 1] === entry) close(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);

  // 아래로 끌어서 닫기: 손잡이·제목에서 시작하거나, 맨 위로 스크롤된 상태에서 일반 영역을 끌 때만.
  // 사진 위 영역 편집기([data-no-swipe])·입력칸·슬라이더에서는 끌어도 닫히지 않아요.
  let startY = null;
  panel.addEventListener('touchstart', (e) => {
    startY = null;
    if (!dismissible || wide()) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const fromHead = t.closest('.sheet-handle, .sheet-title');
    const blocked = t.closest('[data-no-swipe], .calib, canvas, input, textarea, select, .chips');
    if (fromHead || (!blocked && panel.scrollTop <= 0)) startY = e.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const endDrag = (e) => {
    if (startY === null) return;
    const dy = (e.changedTouches?.[0]?.clientY ?? startY) - startY;
    startY = null;
    if (dy > 110) close(); else panel.style.transform = '';
  };
  panel.addEventListener('touchend', endDrag);
  panel.addEventListener('touchcancel', endDrag);

  const content = build(close);
  if (Array.isArray(content)) content.flat().forEach((c) => c && panel.appendChild(c));
  else if (content) panel.appendChild(content);
  const title = panel.querySelector('.sheet-title');
  if (title) { title.id = title.id || titleId; panel.setAttribute('aria-labelledby', title.id); }
  layer.appendChild(backdrop);
  openSheets.push(entry);
  setTimeout(() => {
    if (closed) return;
    const auto = panel.querySelector('[autofocus]');
    if (auto) auto.focus(); else panel.focus({ preventScroll: true });
  }, 320);
  return { close, panel };
}

/** 오래 걸리는 작업 동안 띄우는 진행 시트 (사용자가 닫을 수 없음) */
export function progressSheet(title, desc) {
  const descEl = h('p', { class: 'sheet-desc' }, desc || '');
  const s = sheet(() => [
    h('div', { class: 'progress-sheet' },
      h('div', { class: 'spinner small', 'aria-hidden': 'true' }),
      h('div', null, h('h2', { class: 'sheet-title' }, title), descEl)),
  ], { dismissible: false });
  return { update: (text) => { descEl.textContent = text; }, close: () => s.close(true) };
}

export function confirmSheet({ title, desc, ok = '확인', danger = false }) {
  // 바깥 탭·Esc·아래로 끌기로 닫아도 '취소'로 끝나도록 (예전에는 이 경우 Promise 가 영원히 끝나지 않았음)
  return new Promise((resolve) => {
    let answer = false;
    sheet((close) => [
      h('h2', { class: 'sheet-title' }, title),
      desc ? h('p', { class: 'sheet-desc' }, desc) : null,
      h('div', { class: 'btn-row actions' },
        h('button', { class: 'btn btn-secondary', onclick: () => close() }, '취소'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), autofocus: !danger, onclick: () => { answer = true; close(); } }, ok)),
    ], { onClose: () => resolve(answer) });
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
