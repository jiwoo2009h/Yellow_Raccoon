// 개별 식물 화면
// 1) 식물 관리 추천: 오늘의 추천 행동 + 최근 일주일 수치 기반 추천
// 2) 날짜별 온습도 기록표 (일자 슬라이드표, 한 칸에 '온도 / 습도')
// 3) 급수 기록표 (일자 슬라이드표, 물 준 날은 파란 동그라미 안에 급수량 mL)
// 4) 생장률 그래프 (x축 날짜, y축 이미지 분석 수치) + '온도 표기' '습도 표기' 버튼 -> 오른쪽 y축 추가

import { api } from '../api.js';
import {
  h, icons, statusBadge, fmt, signed, withIcon, backLink, segmented, sheet, confirmSheet, toast, plantTitle,
  dayKey, WEEKDAYS, recBox, recIcon, skeleton, josa,
} from '../ui.js';
import { timeChart } from '../dchart.js';

const DAY = 86400000;
const ms = (s) => new Date(s).getTime();
const WEEKLY_ICON = { temp: 'thermo', humidity: 'humidity', soil: 'soil', lux: 'sun', light_hours: 'bulb', water: 'drop' };

// ---------------------------------------------------------------- 일자 슬라이드표
/**
 * days: [{ key: 'YYYY-MM-DD', date: Date }]
 * cell(day) -> 칸 안 내용, detail(day) -> 아래에 보일 자세한 설명
 */
function dayStrip({ label, days, cell, detail }) {
  const title = h('div', { class: 'ds-title', 'aria-live': 'polite' });
  const foot = h('div', { class: 'ds-foot' });
  const track = h('div', { class: 'ds-track', role: 'listbox', 'aria-label': label, tabindex: '0', style: { position: 'relative' } });
  const buttons = days.map((d) => {
    const wd = d.date.getDay();
    const b = h('button', {
      class: 'ds-day', type: 'button', role: 'option', 'aria-label': `${d.date.getMonth() + 1}월 ${d.date.getDate()}일`,
      onclick: () => center(b, true),
    },
    h('span', { class: 'wd' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : '') }, WEEKDAYS[wd]),
    h('div', { class: 'ds-pill' }, cell(d)),
    h('span', { class: 'dn' }, `${d.date.getMonth() + 1}/${d.date.getDate()}`));
    b.day = d;
    return b;
  });
  track.append(...buttons);

  let active = null;
  const setActive = (b) => {
    if (active === b) return;
    active?.classList.remove('active');
    active?.setAttribute('aria-selected', 'false');
    active = b;
    b.classList.add('active');
    b.setAttribute('aria-selected', 'true');
    const d = b.day.date;
    title.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일, ${WEEKDAYS[d.getDay()]}요일`;
    foot.textContent = detail(b.day);
  };
  function center(b, smooth) {
    const left = b.offsetLeft + b.offsetWidth / 2 - track.clientWidth / 2;
    track.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    setActive(b);
  }
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = buttons[0];
      for (const b of buttons) {
        if (Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid) < Math.abs(best.offsetLeft + best.offsetWidth / 2 - mid)) best = b;
      }
      setActive(best);
    });
  }, { passive: true });
  track.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(active);
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); center(buttons[i - 1], true); }
    if (e.key === 'ArrowRight' && i < buttons.length - 1) { e.preventDefault(); center(buttons[i + 1], true); }
  });
  const el = h('div', { class: 'day-strip' }, title, h('div', { class: 'ds-marker', 'aria-hidden': 'true' }), track, foot);
  // 화면에 붙은 뒤 오늘(마지막 날)을 가운데로
  setActive(buttons[buttons.length - 1]);
  requestAnimationFrame(() => center(buttons[buttons.length - 1], false));
  return el;
}

function dayRange(p) {
  const times = [
    ...p.measurements.map((m) => ms(m.taken_at)),
    ...p.env_logs.map((e) => ms(e.at)),
    ...p.care_logs.map((c) => ms(c.at)),
  ];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let start = times.length ? new Date(Math.min(...times)) : new Date(today.getTime() - 13 * DAY);
  start.setHours(0, 0, 0, 0);
  if (today - start > 59 * DAY) start = new Date(today.getTime() - 59 * DAY);
  if (today - start < 6 * DAY) start = new Date(today.getTime() - 6 * DAY);
  const days = [];
  for (let d = new Date(start); d <= today; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push({ key: dayKey(d), date: d });
  }
  return days;
}

function byDay(list, at) {
  const out = {};
  for (const x of list) (out[dayKey(x[at])] ||= []).push(x);
  return out;
}
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const pick = (logs, k) => avg(logs.map((e) => e[k]).filter((v) => v !== null && v !== undefined));

// ---------------------------------------------------------------- 화면
export async function plantView({ id }) {
  const screen = document.getElementById('screen');
  screen.append(backLink('홈'), skeleton(60, 8), skeleton(160, 16), skeleton(180, 16));
  const p = await api.plant(id);
  const rec = p.recs?.[0];
  const unit = p.unit === 'cm' ? 'cm' : 'px';
  const l = p.latest;

  // ---- 머리
  const head = h('header', { class: 'detail-head' },
    h('div', { class: 'pc-thumb' }, l ? h('img', { src: l.photo_url, alt: '' }) : h('span', { html: icons.leaf, style: { display: 'contents' } })),
    h('div', { class: 'grow' },
      h('h1', { class: 'large-title', style: { fontSize: '20px' } }, plantTitle(p)),
      h('div', { class: 'pc-meta' }, l ? `측정 ${p.count}회 · 최근 ${new Date(l.taken_at).getMonth() + 1}월 ${new Date(l.taken_at).getDate()}일 촬영` : '아직 사진이 없어요'),
      h('div', { style: { marginTop: '6px' } }, statusBadge(p.status, p.status_label))),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '식물 관리 메뉴', html: icons.more, onclick: () => menu(p) }));

  // ---- 1. 식물 관리 추천
  const actionable = rec && (rec.level === 'care' || rec.level === 'observe');
  const today = h('section', { class: 'today-card', style: { marginTop: '16px' } },
    h('div', { class: 'k' }, h('span', { html: icons[recIcon(rec?.code)], style: { display: 'contents' } }), '오늘의 추천 행동'),
    h('div', { class: 't' }, `'${p.today || '오늘은 사진을 찍어 기록을 시작하는 것을 추천합니다.'}'`),
    rec ? h('div', { class: 'b' }, `${rec.title} — ${rec.body}`) : null,
    rec?.reasons?.length ? h('details', { class: 'why', style: { color: '#fff' } },
      h('summary', { style: { color: 'rgba(255,255,255,.85)' } }, '왜 이렇게 판단했나요?', h('span', { html: icons.chevronDown, style: { display: 'contents' } })),
      h('ul', { style: { background: 'rgba(255,255,255,.12)', color: '#fff' } }, rec.reasons.map((r) => h('li', null, r)))) : null,
    actionable
      ? h('a', { class: 'btn', href: `#/record?tab=care&plant=${p.id}` }, ...withIcon('clipboard', '관리 기록하기'))
      : h('a', { class: 'btn', href: `#/photo?plant=${p.id}` }, ...withIcon('camera', '오늘 사진 찍기')));

  const moreRecs = (p.recs || []).slice(1).filter((r) => r.level !== 'info');
  const weekly = h('section', { class: 'card', style: { marginTop: '12px' } },
    h('h2', { class: 'card-title' }, '식물 관리 추천'),
    h('p', { class: 'card-sub' }, '최근 일주일 수치를 품종별 권장 범위와 비교했어요.'),
    h('div', { style: { marginTop: '8px' } },
      (p.weekly || []).length
        ? p.weekly.map((w) => h('div', { class: `weekly-item ${w.status}` },
          h('div', { class: 'ic', html: icons[WEEKLY_ICON[w.key]] || icons.info }),
          h('div', { class: 'txt' }, w.status === 'low' || w.status === 'high' ? h('b', null, w.text) : w.text)))
        : h('div', { class: 'empty-inline' }, '최근 일주일 환경 기록이 없어요. 기록 탭에서 온도·습도·토양 수분을 남겨 주세요.')),
    moreRecs.length ? h('div', { style: { marginTop: '4px' } }, h('div', { class: 'field-label', style: { marginTop: '8px' } }, '함께 확인할 점'), moreRecs.map((r) => recBox(r))) : null);

  // ---- 2·3. 일자 슬라이드표
  const days = dayRange(p);
  const envByDay = byDay(p.env_logs, 'at');
  const waterByDay = byDay(p.care_logs.filter((c) => c.kind === 'water'), 'at');
  const envStrip = dayStrip({
    label: '날짜별 온도와 습도',
    days,
    cell: (d) => {
      const logs = envByDay[d.key] || [];
      const t = pick(logs, 'temp');
      const hu = pick(logs, 'humidity');
      if (t === null && hu === null) return h('span', { class: 'none' }, '–');
      return [h('span', { class: 'temp' }, t === null ? '–' : `${fmt(t, 1)}°`), h('span', { class: 'slash' }, '/'), h('span', { class: 'hum' }, hu === null ? '–' : `${fmt(hu, 0)}%`)];
    },
    detail: (d) => {
      const logs = envByDay[d.key] || [];
      if (!logs.length) return '이날은 환경 기록이 없어요';
      const parts = [['temp', '온도', '℃', 1], ['humidity', '습도', '%', 0], ['soil', '토양', '%', 0], ['lux', '조도', ' lux', 0], ['light_hours', '조명', '시간', 1]]
        .map(([k, n, u, dg]) => { const v = pick(logs, k); return v === null ? null : `${n} ${fmt(v, dg)}${u}`; }).filter(Boolean);
      return parts.join(' · ');
    },
  });
  const waterStrip = dayStrip({
    label: '날짜별 급수 기록',
    days,
    cell: (d) => {
      const ws = waterByDay[d.key];
      if (!ws) return h('span', { class: 'none' }, '');
      const total = ws.reduce((a, c) => a + (c.amount || 0), 0);
      return total
        ? h('div', { class: 'water' }, h('b', null, fmt(total, 0)), h('small', null, 'mL'))
        : h('div', { class: 'water yes' }, '물');
    },
    detail: (d) => {
      const ws = waterByDay[d.key];
      if (!ws) return '이날은 물을 준 기록이 없어요';
      return ws.map((c) => `${String(new Date(c.at).getHours()).padStart(2, '0')}:${String(new Date(c.at).getMinutes()).padStart(2, '0')} ${c.amount ? `${fmt(c.amount, 0)} mL` : '물주기'}${c.rec_code ? ' (추천 반영)' : ''}`).join(' · ');
    },
  });

  // ---- 4. 생장률 그래프
  const g = { metric: 'area', temp: false, hum: false };
  const chartBox = h('div');
  const metricOptions = [['area', '투영 면적'], ['height', '높이'], ['width', '폭']];
  const drawChart = () => {
    const mUnit = g.metric === 'area' ? (unit === 'cm' ? 'cm²' : 'px') : unit;
    const series = [{
      name: metricOptions.find(([k]) => k === g.metric)[1], color: 'var(--chart-line)', width: 2.5, unit: mUnit, digits: 1,
      points: p.measurements.map((m) => ({ t: ms(m.taken_at), y: m[g.metric] })),
    }];
    const envPts = (k) => p.env_logs.filter((e) => e[k] !== null && e[k] !== undefined).map((e) => ({ t: ms(e.at), y: e[k] }));
    if (g.temp) series.push({ name: '온도', color: 'var(--chart-temp)', axis: 'r1', unit: '℃', digits: 1, points: envPts('temp'), noDots: true });
    if (g.hum) series.push({ name: '습도', color: 'var(--chart-hum)', axis: 'r2', unit: '%', digits: 0, points: envPts('humidity'), noDots: true });
    chartBox.replaceChildren(timeChart({
      ariaLabel: '생장 그래프', height: 190,
      axes: { left: { digits: g.metric === 'area' ? 0 : 1, zero: true }, r1: { unit: '℃', cls: 'temp', digits: 0, minSpan: 10 }, r2: { unit: '%', cls: 'hum', digits: 0, minSpan: 20 } },
      series,
    }));
  };
  const toggle = (key, cls, label) => {
    const b = h('button', {
      class: `toggle ${cls}`, type: 'button', 'aria-pressed': 'false',
      onclick: () => { g[key] = !g[key]; b.setAttribute('aria-pressed', String(g[key])); drawChart(); },
    }, h('i', { style: { background: cls === 'temp' ? 'var(--chart-temp)' : 'var(--chart-hum)' } }), label);
    return b;
  };
  const metricSeg = segmented(metricOptions, g.metric, (v) => { g.metric = v; drawChart(); });
  drawChart();
  const rate = p.facts?.area_rate;
  const growth = h('section', { class: 'card chart-card' },
    h('div', { class: 'card-head' }, h('div', null,
      h('h2', { class: 'card-title' }, '생장률 그래프'),
      h('p', { class: 'card-sub' }, rate === null || rate === undefined
        ? 'x축 날짜 · y축 이미지 분석 수치'
        : `최근 면적 생장률 ${signed(rate, 1)}%/일 · x축 날짜 · y축 이미지 분석 수치`))),
    metricSeg,
    h('div', { class: 'toggle-row' }, toggle('temp', 'temp', '온도 표기'), toggle('hum', 'hum', '습도 표기')),
    chartBox);

  // ---- 사진 기록
  const photos = [...p.measurements].reverse();
  const photoSection = [
    h('h2', { class: 'section-title' }, '사진 기록', h('a', { class: 'section-link', href: `#/photo?plant=${p.id}` }, '사진 찍기')),
    photos.length
      ? h('div', { class: 'photo-strip' }, photos.map((m) => h('a', { href: `#/photo?m=${m.id}` },
        h('img', { src: m.overlay_url || m.photo_url, alt: `${m.taken_at.slice(0, 10)} 사진`, loading: 'lazy' }),
        h('div', { class: 'd' }, `${new Date(m.taken_at).getMonth() + 1}/${new Date(m.taken_at).getDate()}`))))
      : h('a', { class: 'card empty-inline', href: `#/photo?plant=${p.id}`, style: { display: 'block' } }, '아직 사진이 없어요 · 눌러서 첫 사진 찍기'),
  ];

  screen.replaceChildren(
    backLink('홈'),
    head,
    today,
    weekly,
    h('h2', { class: 'section-title' }, '날짜별 온습도 기록표', h('a', { class: 'section-link', href: '#/record' }, '기록하기')),
    envStrip,
    h('h2', { class: 'section-title' }, '급수 기록표', h('a', { class: 'section-link', href: `#/record?tab=care&plant=${p.id}` }, '물 준 기록 남기기')),
    waterStrip,
    h('h2', { class: 'section-title' }, '생장 그래프'),
    growth,
    ...photoSection,
    ...(p.memo ? [h('p', { class: 'disclaimer' }, `메모: ${p.memo}`)] : []));
}

function menu(p) {
  sheet((close) => [
    h('h2', { class: 'sheet-title', style: { marginBottom: '12px' } }, plantTitle(p)),
    h('div', { class: 'list', style: { border: 0, margin: '0 -18px' } },
      [
        { icon: 'note', label: '이름·품종 수정', go: () => { location.hash = `#/plant/${p.id}/edit`; } },
        {
          icon: 'ruler', label: '크기 보정 (자)',
          desc: p.cm_per_px ? `보정됨 · 1cm = ${fmt(1 / p.cm_per_px, 1)}px` : '파란 스티커가 없을 때 사진 속 자로 cm 환산',
          go: () => { location.hash = `#/plant/${p.id}/calibrate`; },
        },
        {
          icon: 'trash', label: '식물 삭제', danger: true,
          go: async () => {
            const ok = await confirmSheet({ title: `${josa(p.name, '을', '를')} 삭제할까요?`, desc: '사진과 모든 기록이 함께 지워지고 되돌릴 수 없어요.', ok: '삭제', danger: true });
            if (!ok) return;
            await api.deletePlant(p.id);
            toast('삭제했어요');
            location.replace('#/');
          },
        },
      ].map((it) => h('button', { class: 'list-item', type: 'button', onclick: async () => { await close(); it.go(); } },
        h('div', { class: 'list-icon', html: icons[it.icon], style: it.danger ? { background: 'var(--care-bg)', color: 'var(--care-text)' } : null }),
        h('div', { class: 'grow' },
          h('div', { class: 'title', style: it.danger ? { color: 'var(--care-text)' } : null }, it.label),
          it.desc ? h('div', { class: 'meta' }, it.desc) : null)))),
  ]);
}
