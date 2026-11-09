// 기록하기
// - 환경 기록: 챔버 온도·습도·조도·조명 시간(고른 식물에 같은 값) + 식물별 토양 수분 (하루 한 번)
// - 관리 기록: 시스템 추천을 보고 한 물주기·위치 변경·조명 변경·환기 (할 때마다)

import { api } from '../api.js';
import {
  h, icons, chips, multiChips, toast, fmt, withIcon, toLocalInput, dateTimeShort, numberInput, field, skeleton,
  variety, confirmSheet, recIcon,
} from '../ui.js';
import { careRow } from './home.js';

const CARE_ACTIONS = [['water', '물주기'], ['move', '위치 변경'], ['light', '조명 변경'], ['vent', '환기'], ['other', '기타']];
// 추천 코드 -> 미리 골라 둘 관리 행동
const REC_ACTION = { water_needed: 'water', water_interval: 'water', soil_low_watch: 'water', light_low: 'light', light_low_watch: 'light', env_check: 'vent', env_watch: 'vent' };

/** '10월 30일 09:00' 처럼 보이고, 누르면 날짜·시간을 고르는 작은 버튼 */
function dateTimePicker(value, onChange) {
  const label = h('span', null, dateTimeShort(value));
  const input = h('input', { type: 'datetime-local', value, max: toLocalInput(new Date()), 'aria-label': '기록 날짜와 시간' });
  input.addEventListener('change', () => { if (input.value) { label.textContent = dateTimeShort(input.value); onChange(input.value); } });
  input.addEventListener('click', () => { try { input.showPicker(); } catch { /* 지원하지 않는 브라우저 */ } });
  return h('label', { class: 'dt-inline' }, h('span', { html: icons.clock, style: { display: 'contents' } }), label, input);
}

export async function recordView(params) {
  const screen = document.getElementById('screen');
  const head = h('header', null,
    h('h1', { class: 'large-title' }, '기록하기'),
    h('p', { class: 'subtitle' }, '환경은 하루 한 번, 관리 행동은 할 때마다 남겨요.'));
  screen.append(head, skeleton(45, 16), skeleton(280, 16));

  const [{ plants }, { thresholds }] = await Promise.all([api.plants(), api.settings()]);
  if (!plants.length) {
    screen.replaceChildren(head, h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.clipboard }),
      h('h2', null, '먼저 식물을 등록해 주세요'),
      h('p', null, '식물을 등록하면 온도·습도·토양 수분과 물주기를 기록할 수 있어요.'),
      h('a', { class: 'btn btn-primary', href: '#/plant/new' }, ...withIcon('plus', '식물 등록하기'))));
    return;
  }
  const soilMin = (p) => (thresholds.species[p.species] || thresholds.species.other).soil_min;

  let tab = params.tab === 'care' ? 'care' : 'env';
  const tabs = h('div', { class: 'seg', role: 'tablist', style: { marginTop: '16px' } });
  const body = h('div');
  const renderTabs = () => {
    tabs.replaceChildren(...[['env', 'thermo', '환경 기록'], ['care', 'drop', '관리 기록']].map(([v, ic, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-pressed': String(tab === v), 'aria-selected': String(tab === v),
      onclick: () => { if (tab !== v) { tab = v; history.replaceState(null, '', v === 'care' ? '#/record?tab=care' : '#/record'); renderTabs(); render(); } },
    }, ...withIcon(ic, label))));
  };
  renderTabs();
  screen.replaceChildren(head, tabs, body);

  function render() {
    if (tab === 'env') body.replaceChildren(envCard(), soilCard(), envSaveBtn(), careSection());
    else body.replaceChildren(careSection(), careHistory());
  }

  // ---------------------------------------------------------------- 환경 기록
  const env = { at: toLocalInput(new Date()), ids: new Set(plants.map((p) => p.id)), soil: {} };
  let envInputs = {};

  function lastEnv() {
    // 플레이스홀더에 보여 줄 가장 최근 값
    const latest = plants.map((p) => p.latest?.env).filter(Boolean);
    return latest[0] || {};
  }

  function envCard() {
    const last = lastEnv();
    const ph = (k) => (last[k] !== undefined && last[k] !== null ? fmt(last[k], 1) : '');
    envInputs = {
      temp: numberInput({ name: 'temp', unit: '℃', placeholder: ph('temp'), min: -20, max: 60 }),
      humidity: numberInput({ name: 'humidity', unit: '%', placeholder: ph('humidity'), min: 0, max: 100 }),
      lux: numberInput({ name: 'lux', unit: 'lux', placeholder: ph('lux'), min: 0, step: '1' }),
      light_hours: numberInput({ name: 'light_hours', unit: '시간', placeholder: ph('light_hours'), min: 0, max: 24 }),
    };
    return h('section', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-title' }, '챔버 환경'),
        dateTimePicker(env.at, (v) => { env.at = v; })),
      h('div', { class: 'field-label' }, '같은 값을 적용할 식물'),
      multiChips(plants.map((p) => [p.id, p.name]), env.ids, (set) => { env.ids = set; }, 'chips wrap'),
      h('div', { class: 'field-row', style: { marginTop: '14px' } }, field('온도', envInputs.temp), field('습도', envInputs.humidity)),
      h('div', { class: 'field-row' }, field('조도', envInputs.lux), field('조명 시간', envInputs.light_hours)));
  }

  function soilCard() {
    const rows = plants.map((p) => {
      const min = soilMin(p);
      const lastSoil = p.latest?.env?.soil ?? p.facts?.soil;
      const fill = h('div', { class: 'fill' });
      const row = h('div', { class: 'soil-row' });
      const input = h('input', {
        type: 'number', inputmode: 'decimal', min: 0, max: 100, step: 'any',
        'aria-label': `${p.name} 토양 수분 (%)`, placeholder: lastSoil !== null && lastSoil !== undefined ? fmt(lastSoil, 0) : '–',
        value: env.soil[p.id] ?? '',
      });
      const paint = () => {
        const raw = input.value.trim();
        const v = raw === '' ? lastSoil : Number(raw);
        const has = v !== null && v !== undefined && !Number.isNaN(v);
        fill.style.width = has ? `${Math.max(0, Math.min(100, v))}%` : '0%';
        fill.style.opacity = raw === '' ? '0.35' : '1';
        const low = has && v < min;
        fill.classList.toggle('low', low);
        row.classList.toggle('low', low && raw !== '');
      };
      input.addEventListener('input', () => { env.soil[p.id] = input.value; paint(); });
      row.append(
        h('div', null, h('div', { class: 'n' }, p.name), h('div', { class: 's' }, variety(p.species))),
        h('div', { class: 'soil-bar', title: `기준 ${min}%` }, fill, h('div', { class: 'mark', style: { left: `${min}%` } })),
        h('div', { class: 'pct' }, input));
      paint();
      return row;
    });
    return h('section', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: 'card-head' }, h('div', null,
        h('h2', { class: 'card-title' }, '토양 수분 (식물별)'),
        h('p', { class: 'card-sub' }, '화분마다 다르니 하나씩 재요. 기준 미만은 빨간색, 흐린 막대는 지난 값이에요.'))),
      rows);
  }

  function envSaveBtn() {
    const btn = h('button', {
      class: 'btn btn-primary', type: 'button', style: { marginTop: '16px' },
      onclick: async () => {
        const val = (el) => { const x = el.querySelector('input').value.trim(); return x === '' ? null : Number(x); };
        const soil = Object.fromEntries(Object.entries(env.soil).filter(([, v]) => String(v).trim() !== '').map(([k, v]) => [k, Number(v)]));
        const payload = {
          at: env.at, plant_ids: [...env.ids], soil,
          temp: val(envInputs.temp), humidity: val(envInputs.humidity), lux: val(envInputs.lux), light_hours: val(envInputs.light_hours),
        };
        btn.disabled = true;
        try {
          const r = await api.addEnvBulk(payload);
          toast(`식물 ${r.count}개에 환경 기록을 저장했어요`);
          env.soil = {};
          const fresh = await api.plants();
          plants.splice(0, plants.length, ...fresh.plants);
          render();
        } catch (err) {
          toast(err.message, { error: true });
        } finally {
          btn.disabled = false;
        }
      },
    }, ...withIcon('check', '환경 기록 저장'));
    return btn;
  }

  // ---------------------------------------------------------------- 관리 기록 (추천 보고 관리하기)
  const care = { plantId: Number(params.plant) || (plants.find((p) => p.status === 'care') || plants[0]).id, kind: null, at: toLocalInput(new Date()), fromRec: null };
  const nowParts = () => { const v = toLocalInput(new Date()); return [v.slice(0, 10), v.slice(11, 16)]; };

  function careSection() {
    const plant = plants.find((p) => p.id === care.plantId) || plants[0];
    const rec = plant.recs?.[0];
    const suggested = rec ? REC_ACTION[rec.code] || rec.action?.kind || null : null;
    const kind = care.kind || suggested || 'water';
    const actionable = rec && (rec.level === 'care' || rec.level === 'observe');
    const fromRec = care.fromRec ?? !!actionable;

    const amount = numberInput({ name: 'amount', unit: 'mL', min: 0, step: '1', placeholder: '150' });
    const note = h('input', { class: 'input', name: 'note', maxlength: 300, placeholder: kind === 'move' ? '예: 창가 쪽 20cm' : '메모 (선택)' });
    // 시각은 입력칸, 날짜는 오른쪽 위의 작은 버튼 (기본: 오늘)
    const time = h('input', { class: 'input', type: 'time', value: care.at.slice(11, 16) });
    time.addEventListener('change', () => { if (time.value) care.at = `${care.at.slice(0, 10)}T${time.value}`; });
    const dateLabel = h('span', null, '');
    const paintDate = () => {
      const [today] = nowParts();
      const d = new Date(`${care.at.slice(0, 10)}T00:00`);
      dateLabel.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일${care.at.slice(0, 10) === today ? ' (오늘)' : ''}`;
    };
    const dateInput = h('input', { type: 'date', value: care.at.slice(0, 10), max: nowParts()[0], 'aria-label': '관리한 날짜' });
    dateInput.addEventListener('click', () => { try { dateInput.showPicker(); } catch { /* 지원하지 않는 브라우저 */ } });
    dateInput.addEventListener('change', () => { if (dateInput.value) { care.at = `${dateInput.value}T${care.at.slice(11, 16)}`; paintDate(); } });
    paintDate();
    const amountField = field('물 양', amount);
    amountField.hidden = kind !== 'water';
    let currentKind = kind;
    const check = h('input', { type: 'checkbox', checked: fromRec });
    check.addEventListener('change', () => { care.fromRec = check.checked; });

    const save = h('button', {
      class: 'btn btn-outline-accent', type: 'button', style: { marginTop: '16px' },
      onclick: async () => {
        const a = amount.querySelector('input').value.trim();
        save.disabled = true;
        try {
          await api.addCare(plant.id, {
            kind: currentKind, at: care.at, amount: currentKind === 'water' && a !== '' ? Number(a) : null,
            note: note.value.trim() || null, from_rec: check.checked,
          });
          toast(`${plant.name} 관리 기록을 저장했어요`);
          care.kind = null; care.fromRec = null; care.at = toLocalInput(new Date());
          const fresh = await api.plants();
          plants.splice(0, plants.length, ...fresh.plants);
          render();
        } catch (err) {
          toast(err.message, { error: true });
          save.disabled = false;
        }
      },
    }, ...withIcon('clipboard', '관리 기록 저장'));

    return h('div', null,
      h('h2', { class: 'section-title' }, '추천 보고 관리하기', h('a', { class: 'section-link', href: `#/plant/${plant.id}` }, plant.name)),
      h('section', { class: 'card' },
        h('div', { class: 'label-row' },
          h('div', { class: 'field-label' }, '관리한 식물'),
          h('label', { class: 'dt-inline' }, h('span', { html: icons.clock, style: { display: 'contents' } }), dateLabel, dateInput)),
        chips(plants.map((p) => [p.id, p.name]), plant.id, (v) => { care.plantId = v; care.kind = null; care.fromRec = null; render(); }, 'chips wrap'),
        rec ? h('div', { class: `rec-box ${rec.level}`, style: { marginTop: '14px' } },
          h('span', { html: icons[recIcon(rec.code)], style: { display: 'contents' } }),
          h('div', null,
            h('div', { class: 't' }, `시스템 추천 · ${rec.title}`),
            h('div', { class: 'b' }, rec.today || rec.body))) : null,
        h('div', { class: 'field-label', style: { marginTop: '14px' } }, '관리 행동'),
        chips(CARE_ACTIONS, kind, (v) => {
          currentKind = v; care.kind = v;
          amountField.hidden = v !== 'water';
          note.placeholder = v === 'move' ? '예: 창가 쪽 20cm' : '메모 (선택)';
        }, 'chips wrap'),
        h('div', { class: 'field-row', style: { marginTop: '14px' } }, amountField, field('시각', time)),
        h('div', { style: { marginTop: '12px' } }, field('메모', note)),
        h('label', { class: 'check' }, check, h('span', { class: 'box', html: icons.check }), '시스템 추천을 보고 한 행동이에요'),
        save));
  }

  function careHistory() {
    const wrap = h('div', null, h('h2', { class: 'section-title' }, '관리 기록 전체'), skeleton(180, 0));
    api.careList(200).then(({ items }) => {
      const card = h('section', { class: 'card list-card' });
      const fill = (list) => card.replaceChildren(...(list.length ? list.map((c) => careRow(c, {
        onDelete: async () => {
          const ok = await confirmSheet({ title: '이 관리 기록을 지울까요?', desc: `${c.plant_name} · ${c.kind_label} · ${dateTimeShort(c.at)}`, ok: '지우기', danger: true });
          if (!ok) return;
          await api.deleteCare(c.id);
          toast('관리 기록을 지웠어요');
          fill(list.filter((x) => x.id !== c.id));
        },
      })) : [h('div', { class: 'empty-inline' }, '아직 관리 기록이 없어요.')]));
      fill(items);
      wrap.replaceChildren(wrap.firstChild, card);
    }).catch((err) => toast(err.message, { error: true }));
    return wrap;
  }

  render();
}
