// 일자 슬라이드표: 날짜 칸을 가로로 넘기고, 가운데 ▼ 아래 칸이 선택돼요. (급수 기록표 · 온습도 기록표)
// - 손가락으로 넘기면 가운데 칸이 바로 선택되고(위 제목이 바뀜), 스크롤이 멈추면 onSelect 로 알려요.
// - 칸을 누르면 그 칸이 가운데로 와요. 키보드 ←/→, Home/End 로도 움직여요.

import { h, dateTitle, dayKey, fromDayKey, WEEKDAYS } from './ui.js';

/** start~end 날짜 키 목록 (넘치면 최근 maxDays 일만) */
export function dayRange(start, end, maxDays = 366) {
  const keys = [];
  const d = fromDayKey(dayKey(start));
  const last = fromDayKey(dayKey(end));
  while (d <= last) {
    keys.push(dayKey(d));
    d.setDate(d.getDate() + 1);
  }
  return keys.slice(-maxDays);
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * days       : 날짜 키('YYYY-MM-DD') 배열 (오래된 날 → 최근)
 * selected   : 처음 고를 날짜 키 (없으면 오늘, 오늘도 없으면 마지막 날)
 * cell(key)  : 칸 안에 넣을 요소 (없으면 null)
 * describe(key): 화면 읽기 프로그램용 설명 (예: '물 150ml')
 * onSelect(key): 선택이 정해질 때마다 (처음 한 번 + 스크롤이 멈추거나 칸을 누를 때). 만들 때 바로 한 번 불러요.
 */
export function dayStrip({ days, selected, cell, describe, onSelect, label = '날짜' }) {
  const today = dayKey(new Date());
  let index = days.indexOf(selected);
  if (index < 0) index = days.indexOf(today);
  if (index < 0) index = days.length - 1;

  const title = h('h3', { class: 'ds-title' });
  const todayBadge = h('span', { class: 'ds-today' }, '오늘');
  const buttons = days.map((key, i) => {
    const d = fromDayKey(key);
    const extra = describe ? describe(key) : '';
    return h('button', {
      type: 'button',
      class: 'ds-day' + (key === today ? ' is-today' : '') + (key > today ? ' is-future' : ''),
      'aria-pressed': 'false',
      tabindex: '-1',
      'aria-label': `${dateTitle(d)}${key === today ? ' 오늘' : ''}${extra ? `, ${extra}` : ''}`,
      onclick: () => select(i, { scroll: true, commit: true }),
    },
    h('span', { class: 'ds-wd', 'aria-hidden': 'true' }, WEEKDAYS[d.getDay()]),
    h('span', { class: 'ds-pill' }, cell(key)),
    h('span', { class: 'ds-date', 'aria-hidden': 'true' }, d.getDate() === 1 ? `${d.getMonth() + 1}/1` : String(d.getDate())));
  });
  const scroller = h('div', { class: 'ds-scroller', role: 'group', 'aria-label': `${label} · 왼쪽·오른쪽 화살표로 날짜 이동` }, buttons);
  const root = h('div', { class: 'day-strip' },
    h('div', { class: 'ds-head', 'aria-live': 'polite' }, title, todayBadge),
    h('div', { class: 'ds-marker', 'aria-hidden': 'true' }),
    scroller);

  let committed = null;
  let target = null; // 코드로 스크롤하는 중이면 그 목표 칸 (중간 날짜로 제목이 깜빡이지 않게)
  let settleTimer = 0;
  let raf = 0;

  function mark(i) {
    index = i;
    buttons.forEach((b, j) => {
      const on = j === i;
      b.setAttribute('aria-pressed', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    title.textContent = dateTitle(fromDayKey(days[i]));
    todayBadge.hidden = days[i] !== today;
  }

  function commit() {
    if (committed === days[index]) return;
    committed = days[index];
    onSelect?.(days[index]);
  }

  // i 번째 칸을 가운데에 두는 스크롤 위치
  const centerLeft = (i) => buttons[i].offsetLeft + buttons[i].offsetWidth / 2 - scroller.clientWidth / 2;

  // 코드로 움직인 스크롤이 끝나면, 목표 칸이 가운데에 있는지 확인하고 아니면 바로 맞춰요
  // (부드러운 스크롤은 화면이 가려져 있으면 멈췄다가 나중에 움직이기도 해요)
  function finishScroll() {
    if (target !== null && nearest() !== target) scroller.scrollLeft = centerLeft(target);
    target = null;
  }

  function scrollToIndex(i, smooth) {
    target = i;
    const instant = !smooth || reduceMotion() || document.hidden;
    scroller.scrollTo({ left: centerLeft(i), behavior: instant ? 'auto' : 'smooth' });
    clearTimeout(settleTimer);
    settleTimer = setTimeout(finishScroll, instant ? 60 : 700);
  }

  function select(i, { scroll = false, commit: doCommit = false } = {}) {
    i = Math.max(0, Math.min(days.length - 1, i));
    mark(i);
    if (scroll) scrollToIndex(i, true);
    if (doCommit) commit();
  }

  // 가운데에 가장 가까운 칸 (칸 너비가 모두 같아요)
  function nearest() {
    const first = buttons[0];
    const step = buttons[1] ? buttons[1].offsetLeft - first.offsetLeft : first.offsetWidth;
    const mid = scroller.scrollLeft + scroller.clientWidth / 2;
    const i = Math.round((mid - (first.offsetLeft + first.offsetWidth / 2)) / (step || 1));
    return Math.max(0, Math.min(days.length - 1, i));
  }

  scroller.addEventListener('scroll', () => {
    if (target !== null) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finishScroll, 140);
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = nearest();
      if (i !== index) mark(i);
    });
    clearTimeout(settleTimer);
    // 멈추면 한 번 더 계산해서 확정 (탭이 가려져 그리기 프레임이 멈춘 경우에도 맞게)
    settleTimer = setTimeout(() => {
      const i = nearest();
      if (i !== index) mark(i);
      commit();
    }, 160);
  }, { passive: true });

  scroller.addEventListener('keydown', (e) => {
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: days.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(moves[e.key], { scroll: true, commit: true });
    buttons[index].focus({ preventScroll: true });
  });

  // 화면에 붙어 크기가 정해지거나(처음) 넓이가 바뀌면 선택한 칸을 다시 가운데로
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    if (!scroller.isConnected) {
      if (lastW) ro.disconnect();
      return;
    }
    const w = scroller.clientWidth;
    if (w && Math.abs(w - lastW) > 1) {
      lastW = w;
      scrollToIndex(index, false);
    }
  });
  ro.observe(scroller);

  mark(index);
  commit();
  return { el: root, selected: () => days[index], select: (key) => select(days.indexOf(key), { scroll: true, commit: true }) };
}
