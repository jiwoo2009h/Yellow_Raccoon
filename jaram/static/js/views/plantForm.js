import { api } from '../api.js';
import { h, topbar, field, segmented, toast, formValues } from '../ui.js';

const SPECIES = [['basil', '바질'], ['lettuce', '상추'], ['other', '기타']];
const PREFIX = { basil: ['바질', 'B'], lettuce: ['상추', 'L'], other: ['식물', 'P'] };

export async function plantFormView({ id }) {
  const screen = document.getElementById('screen');
  const editing = Boolean(id);
  const [plant, list] = await Promise.all([editing ? api.plant(id) : null, editing ? null : api.plants()]);
  let species = plant?.species || 'basil';

  const nameInput = h('input', { class: 'input', name: 'name', maxlength: 30, required: true, value: plant?.name ?? '', placeholder: '예: 바질 1', autocomplete: 'off' });
  const codeInput = h('input', { class: 'input', name: 'code', maxlength: 12, value: plant?.code ?? '', placeholder: '예: B1', autocomplete: 'off', autocapitalize: 'characters' });
  const memoInput = h('textarea', { class: 'input', name: 'memo', maxlength: 300, placeholder: '예: 10월 20일 파종, 3번 화분' }, plant?.memo ?? '');

  // 새 식물이면 '바질 3', 'B3' 처럼 다음 번호를 제안
  let suggested = { name: '', code: '' };
  const suggest = () => {
    if (editing) return;
    const n = list.plants.filter((p) => p.species === species).length + 1;
    const [word, letter] = PREFIX[species];
    const next = { name: `${word} ${n}`, code: `${letter}${n}` };
    if (!nameInput.value || nameInput.value === suggested.name) nameInput.value = next.name;
    if (!codeInput.value || codeInput.value === suggested.code) codeInput.value = next.code;
    suggested = next;
  };
  suggest();

  const error = h('p', { class: 'form-error', hidden: true });
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const v = formValues(form);
      error.hidden = true;
      const btn = screen.querySelector('.cta .btn');
      btn.disabled = true;
      try {
        const body = { name: v.name, code: v.code, memo: v.memo, species };
        const saved = editing ? await api.updatePlant(id, body) : await api.createPlant(body);
        toast(editing ? '저장했어요' : `${saved.name}을(를) 등록했어요`);
        location.replace(`#/plant/${saved.id}`);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        btn.disabled = false;
      }
    },
  },
  h('div', { class: 'page-head', style: { paddingTop: '8px' } },
    h('div', null,
      h('h1', { class: 'large-title' }, editing ? '식물 정보 수정' : '어떤 식물을 키우나요?'),
      h('p', { class: 'subtitle' }, editing ? plant.name : '종류에 따라 추천 기준이 달라져요.'))),
  h('div', { style: { height: '16px' } }),
  field('종류', segmented(SPECIES, species, (v) => { species = v; suggest(); })),
  h('div', { style: { height: '16px' } }),
  field('이름', nameInput),
  h('div', { style: { height: '16px' } }),
  field('식물 ID', codeInput, '사진 파일 이름과 CSV 데이터에 함께 기록돼요.'),
  h('div', { style: { height: '16px' } }),
  field('메모 (선택)', memoInput),
  error,
  h('div', { class: 'cta' }, h('button', { class: 'btn btn-primary', type: 'submit' }, editing ? '저장하기' : '등록하기')));

  screen.replaceChildren(topbar({ title: '' }), form);
}
