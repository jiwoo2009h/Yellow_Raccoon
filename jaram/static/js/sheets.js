// 관리 기록 / 환경 기록 바텀 시트

import { api } from './api.js';
import { h, icons, sheet, field, numberInput, chips, toast, toLocalInput, formValues } from './ui.js';

export const CARE_KINDS = [
  ['water', '물주기', 'drop'],
  ['light', '조명 조정', 'sun'],
  ['move', '위치 변경', 'move'],
  ['fertilize', '비료', 'flask'],
  ['prune', '가지치기', 'scissors'],
  ['other', '기타', 'note'],
];
export const careIcon = (kind) => (CARE_KINDS.find((k) => k[0] === kind) || CARE_KINDS[5])[2];

/** 관리 기록 남기기. 추천에서 열면 kind 와 recCode 가 미리 채워집니다. */
export function careSheet(plant, { kind = 'water', recCode = null } = {}) {
  return new Promise((resolve) => {
    let current = kind;
    sheet((close) => {
      const amountBox = h('div');
      const soilBox = h('div');
      const renderExtra = () => {
        amountBox.replaceChildren();
        soilBox.replaceChildren();
        if (current === 'water') {
          amountBox.append(field('준 물의 양', numberInput({ name: 'amount', unit: 'ml', placeholder: '예: 150' })));
          soilBox.append(field('물 준 뒤 토양 수분 (선택)', numberInput({ name: 'soil', unit: '%', placeholder: '토양 수분계 값' }),
            '물 주기 전후 토양 수분을 기록하면 효과를 비교할 수 있어요.'));
        } else if (current === 'light') {
          amountBox.append(field('조명 시간', numberInput({ name: 'amount', unit: '시간', placeholder: '예: 12' })));
        }
      };
      renderExtra();
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const v = formValues(form);
          const btn = form.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            const updated = await api.addCare(plant.id, {
              kind: current, amount: v.amount, note: v.note, at: v.at, rec_code: recCode,
              env: v.soil !== null && v.soil !== undefined ? { soil: v.soil } : undefined,
            });
            toast('관리 기록을 남겼어요');
            await close();
            resolve(updated);
          } catch (err) {
            toast(err.message, { error: true });
            btn.disabled = false;
          }
        },
      },
      h('h2', { class: 'sheet-title' }, '관리 기록'),
      h('p', { class: 'sheet-desc' }, `${plant.name}에 한 관리를 기록해 두면 다음 측정에서 효과를 비교해요.`),
      chips(CARE_KINDS.map(([k, label]) => [k, label]), current, (k) => { current = k; renderExtra(); }, 'chips in-card'),
      h('div', { style: { height: '20px' } }),
      amountBox,
      soilBox,
      h('div', { style: { height: '16px' } }),
      field('시각', h('input', { class: 'input', type: 'datetime-local', name: 'at', value: toLocalInput() })),
      h('div', { style: { height: '16px' } }),
      field('메모 (선택)', h('input', { class: 'input', name: 'note', maxlength: 300, placeholder: '예: 잎이 처져 보여서 줌' })),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '기록하기')));
      return form;
    });
  });
}

/** 환경 기록 (온도·습도·토양 수분·조도) */
export function envSheet(plant, last = {}) {
  return new Promise((resolve) => {
    sheet((close) => {
      const applyAll = h('input', { type: 'checkbox', name: 'apply_all', checked: true, style: { width: '22px', height: '22px', accentColor: 'var(--accent)' } });
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const v = formValues(form);
          const btn = form.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            const updated = await api.addEnv(plant.id, { ...v, apply_all: applyAll.checked });
            toast('환경을 기록했어요');
            await close();
            resolve(updated);
          } catch (err) {
            toast(err.message, { error: true });
            btn.disabled = false;
          }
        },
      },
      h('h2', { class: 'sheet-title' }, '환경 기록'),
      h('p', { class: 'sheet-desc' }, '온습도계·토양 수분계·조도계 값을 입력해 주세요. 모르는 값은 비워 두면 돼요.'),
      h('div', { class: 'field-row' },
        field('온도', numberInput({ name: 'temp', unit: '℃', placeholder: last.temp ?? '' })),
        field('습도', numberInput({ name: 'humidity', unit: '%', placeholder: last.humidity ?? '' }))),
      h('div', { class: 'field-row' },
        field('토양 수분', numberInput({ name: 'soil', unit: '%', placeholder: last.soil ?? '' })),
        field('조도', numberInput({ name: 'lux', unit: 'lux', placeholder: last.lux ?? '' }))),
      h('label', { class: 'notice', style: { marginTop: '16px', alignItems: 'center', cursor: 'pointer' } },
        applyAll,
        h('span', { class: 'grow' }, '같은 챔버의 다른 식물에도 온도·습도·조도를 함께 기록')),
      h('div', { style: { height: '16px' } }),
      field('시각', h('input', { class: 'input', type: 'datetime-local', name: 'at', value: toLocalInput() })),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '기록하기')));
      return form;
    });
  });
}

export function actionSheet(title, items) {
  sheet((close) => [
    title ? h('h2', { class: 'sheet-title', style: { marginBottom: '12px' } }, title) : null,
    h('div', { class: 'list', style: { background: 'transparent', margin: '0 -20px' } }, items.map((it) =>
      h('button', {
        class: 'list-item', type: 'button',
        onclick: async () => { await close(); it.onClick(); },
      },
      h('div', { class: 'list-icon', html: icons[it.icon], style: it.danger ? { background: 'var(--care-bg)', color: 'var(--care-text)' } : null }),
      h('div', { class: 'grow' },
        h('div', { class: 'title', style: it.danger ? { color: 'var(--care-text)' } : null }, it.label),
        it.desc ? h('div', { class: 'meta' }, it.desc) : null)))),
  ]);
}
