// 관리 기록 / 환경 기록 / 식물 상태 기록 바텀 시트

import { api } from './api.js';
import {
  h, icons, sheet, field, numberInput, chips, multiChips, toggleChips, toast, toLocalInput, formValues, checkNumbers,
  friendlyError,
} from './ui.js';

// 식물 특이사항 (서버 recommend.SIGN_LABELS 와 같은 목록)
export const SIGNS = [
  ['wilt', '시듦·처짐'],
  ['yellow', '잎이 노래짐'],
  ['pale', '잎 색이 연해짐'],
  ['leggy', '웃자람(줄기만 길게)'],
  ['bolting', '꽃대가 올라옴'],
  ['tip_dry', '잎 끝이 마름'],
  ['pest', '벌레·곰팡이·반점'],
  ['crowded', '잎이 빽빽하게 겹침'],
];
export const SOIL_STATES = [['dry', '말랐음'], ['moist', '촉촉함'], ['wet', '젖어 있음']];
export const signLabel = (code) => (SIGNS.find((x) => x[0] === code) || [code, code])[1];
export const soilLabel = (code) => (SOIL_STATES.find((x) => x[0] === code) || [code, code])[1];

export const CARE_KINDS = [
  ['water', '물주기', 'drop'],
  ['light', '조명 조정', 'sun'],
  ['move', '위치 변경', 'move'],
  ['fertilize', '비료', 'flask'],
  ['prune', '가지치기', 'scissors'],
  ['other', '기타', 'note'],
];
export const careIcon = (kind) => (CARE_KINDS.find((k) => k[0] === kind) || CARE_KINDS[5])[2];

/** 관리 기록 남기기. 추천에서 열면 kind 와 recCode 가, 급수 기록표에서 열면 그 날짜(at)가 미리 채워집니다. */
export function careSheet(plant, { kind = 'water', recCode = null, at = null } = {}) {
  // 취소(바깥 탭·Esc)하면 null 로 끝남
  return new Promise((resolve) => {
    let current = kind;
    let soilState = null;
    let result = null;
    sheet((close) => {
      // 종류에 따라 바뀌는 칸 (물주기: 물의 양 + 토양 수분, 조명: 시간). 칸 사이 간격은 field-gap 으로
      const extraBox = h('div');
      const renderExtra = () => {
        extraBox.replaceChildren();
        soilState = null;
        if (current === 'water') {
          extraBox.append(
            field('준 물의 양', numberInput({ name: 'amount', unit: 'ml', placeholder: '예: 150', min: 0 }),
              '양을 적어 두면 급수 기록표에 파란 동그라미로 보여요.'),
            h('div', { class: 'field-gap' }),
            field('물 주기 전 흙 상태 (선택)', toggleChips(SOIL_STATES, null, (v) => { soilState = v; }),
              '흙 표면을 손가락으로 만져 보고 골라 주세요. 젖어 있는데 또 주면 과습 신호로 알려 드려요.'),
            h('div', { class: 'field-gap' }),
            field('물 준 뒤 토양 수분 (선택)', numberInput({ name: 'soil', unit: '%', placeholder: '토양 수분계 값', min: 0, max: 100 }),
              '토양 수분계가 있을 때만 적어 주세요.'),
            h('div', { class: 'field-gap' }));
        } else if (current === 'light') {
          extraBox.append(field('조명 시간', numberInput({ name: 'amount', unit: '시간', placeholder: '예: 12', min: 0 })), h('div', { class: 'field-gap' }));
        }
      };
      renderExtra();
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const btn = form.querySelector('button[type=submit]');
          if (btn.disabled || !checkNumbers(form)) return;
          const v = formValues(form);
          btn.disabled = true;
          btn.classList.add('is-loading');
          try {
            const updated = await api.addCare(plant.id, {
              kind: current, amount: v.amount, note: v.note, at: v.at, rec_code: recCode,
              soil_state: current === 'water' ? soilState : null,
              env: v.soil !== null && v.soil !== undefined ? { soil: v.soil } : undefined,
            });
            toast('관리 기록을 남겼어요');
            result = updated;
            await close();
          } catch (err) {
            toast(friendlyError(err), { error: true });
            btn.disabled = false;
            btn.classList.remove('is-loading');
          }
        },
      },
      h('h2', { class: 'sheet-title' }, '관리 기록'),
      h('p', { class: 'sheet-desc' }, `${plant.name}에 한 관리를 기록해 두면 다음 측정에서 효과를 비교해요.`),
      chips(CARE_KINDS.map(([k, label]) => [k, label]), current, (k) => { current = k; renderExtra(); }, 'chips in-card'),
      h('div', { style: { height: '20px' } }),
      extraBox,
      field('시각', h('input', { class: 'input', type: 'datetime-local', name: 'at', value: toLocalInput(at) })),
      h('div', { style: { height: '16px' } }),
      field('메모 (선택)', h('input', { class: 'input', name: 'note', maxlength: 300, placeholder: '예: 잎이 처져 보여서 줌' })),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '기록하기')));
      return form;
    }, { onClose: () => resolve(result) });
  });
}

/** 환경 기록 (온도·습도·토양 수분·조도). at: 미리 채울 시각 (온습도 기록표에서 고른 날짜) */
export function envSheet(plant, last = {}, { at = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    sheet((close) => {
      const applyAll = h('input', { type: 'checkbox', name: 'apply_all', checked: true });
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const btn = form.querySelector('button[type=submit]');
          if (btn.disabled || !checkNumbers(form)) return;
          const v = formValues(form);
          if (['temp', 'humidity', 'soil', 'lux'].every((k) => v[k] === null)) {
            toast('값을 하나 이상 입력해 주세요', { error: true });
            form.querySelector('input[name="temp"]')?.focus();
            return;
          }
          btn.disabled = true;
          btn.classList.add('is-loading');
          try {
            const updated = await api.addEnv(plant.id, { ...v, apply_all: applyAll.checked });
            toast('환경을 기록했어요');
            result = updated;
            await close();
          } catch (err) {
            toast(friendlyError(err), { error: true });
            btn.disabled = false;
            btn.classList.remove('is-loading');
          }
        },
      },
      h('h2', { class: 'sheet-title' }, '환경 기록'),
      h('p', { class: 'sheet-desc' }, '온습도계·토양 수분계·조도계 값을 입력해 주세요. 모르는 값은 비워 두면 돼요.'),
      h('div', { class: 'field-row' },
        field('온도', numberInput({ name: 'temp', unit: '℃', placeholder: last.temp ?? '' })),
        field('습도', numberInput({ name: 'humidity', unit: '%', placeholder: last.humidity ?? '', min: 0, max: 100 }))),
      h('div', { class: 'field-row' },
        field('토양 수분', numberInput({ name: 'soil', unit: '%', placeholder: last.soil ?? '', min: 0, max: 100 })),
        field('조도', numberInput({ name: 'lux', unit: 'lux', placeholder: last.lux ?? '', min: 0 }))),
      h('label', { class: 'notice check-row', style: { marginTop: '16px' } },
        applyAll,
        h('span', { class: 'grow' }, '같은 챔버의 다른 식물에도 온도·습도·조도를 함께 기록')),
      h('div', { style: { height: '16px' } }),
      field('시각', h('input', { class: 'input', type: 'datetime-local', name: 'at', value: toLocalInput(at) })),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '기록하기')));
      return form;
    }, { onClose: () => resolve(result) });
  });
}

/** 식물 상태 기록: 특이사항(시듦·웃자람 등) + 흙 만져 보기. 추천 알고리즘이 생장 기록과 함께 봐요. */
export function observeSheet(plant, { at = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let signs = [];
    let soil = null;
    sheet((close) => {
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const btn = form.querySelector('button[type=submit]');
          if (btn.disabled) return;
          const v = formValues(form);
          if (!signs.length && !soil && !v.note) {
            toast('특이사항이나 흙 상태를 하나 이상 골라 주세요', { error: true });
            return;
          }
          btn.disabled = true;
          btn.classList.add('is-loading');
          try {
            const updated = await api.addObservation(plant.id, { signs, soil_state: soil, note: v.note, at: v.at });
            toast('식물 상태를 기록했어요');
            result = updated;
            await close();
          } catch (err) {
            toast(friendlyError(err), { error: true });
            btn.disabled = false;
            btn.classList.remove('is-loading');
          }
        },
      },
      h('h2', { class: 'sheet-title' }, '식물 상태 기록'),
      h('p', { class: 'sheet-desc' }, `${plant.name}에서 눈에 띄는 점을 골라 주세요. 생장 기록·급수 기록과 함께 보고 관리 방법을 추천해요.`),
      field('특이사항 (여러 개 고를 수 있어요)', multiChips(SIGNS, [], (v) => { signs = v; })),
      h('div', { style: { height: '20px' } }),
      field('흙 상태 (선택)', toggleChips(SOIL_STATES, null, (v) => { soil = v; }), '흙 표면을 손가락으로 만져 보고 골라 주세요.'),
      h('div', { style: { height: '16px' } }),
      field('시각', h('input', { class: 'input', type: 'datetime-local', name: 'at', value: toLocalInput(at) })),
      h('div', { style: { height: '16px' } }),
      field('메모 (선택)', h('input', { class: 'input', name: 'note', maxlength: 300, placeholder: '예: 아래쪽 잎 두 장이 노래짐' })),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '기록하기')));
      return form;
    }, { onClose: () => resolve(result) });
  });
}

export function actionSheet(title, items) {
  // 한 번 고르면 시트 안의 다른 항목은 잠가요 (두 번 눌러 확인 창이 2개 뜨거나 카메라가 2번 열리지 않게)
  let picked = false;
  sheet((close) => [
    title ? h('h2', { class: 'sheet-title', style: { marginBottom: '12px' } }, title) : null,
    h('div', { class: 'list', style: { background: 'transparent', margin: '0 -20px' } }, items.map((it) =>
      h('button', {
        class: 'list-item', type: 'button',
        onclick: async () => {
          if (picked) return;
          picked = true;
          await close();
          try { await it.onClick(); } catch (err) { toast(friendlyError(err), { error: true }); }
        },
      },
      h('div', { class: 'list-icon' + (it.danger ? ' care' : ''), html: icons[it.icon] }),
      h('div', { class: 'grow' },
        h('div', { class: 'title', style: it.danger ? { color: 'var(--care-text)' } : null }, it.label),
        it.desc ? h('div', { class: 'meta' }, it.desc) : null)))),
  ]);
}
