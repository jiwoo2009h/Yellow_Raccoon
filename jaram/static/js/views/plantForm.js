// 식물 등록 / 수정
// 사진(선택) -> 품종(스위트 바질·상추) -> 이름 -> 실측값(선택) -> '식물 등록하기'

import { api } from '../api.js';
import { h, icons, field, chips, toast, withIcon, backLink, numberInput, toLocalInput, VARIETY, josa } from '../ui.js';
import { prepareImage, readExifDate } from '../image.js';

const PREFIX = { basil: 'B', lettuce: 'L', other: 'P' };

function card(title, desc, ...content) {
  return h('section', { class: 'card', style: { marginTop: '16px' } },
    h('h2', { class: 'card-title' }, title),
    desc ? h('p', { class: 'card-sub' }, desc) : null,
    h('div', { style: { marginTop: '12px' } }, ...content));
}

export async function plantFormView({ id, species: qSpecies }) {
  const screen = document.getElementById('screen');
  const editing = Boolean(id);
  const [plant, list] = await Promise.all([editing ? api.plant(id) : null, api.plants()]);
  let species = plant?.species || (VARIETY[qSpecies] ? qSpecies : 'basil');
  const varieties = [['basil', VARIETY.basil], ['lettuce', VARIETY.lettuce]];
  if (species === 'other') varieties.push(['other', VARIETY.other]);

  const nameInput = h('input', { class: 'input', name: 'name', maxlength: 30, required: true, value: plant?.name ?? '', placeholder: '예: 바질이, 아삭이', autocomplete: 'off' });
  const codeInput = h('input', { class: 'input', name: 'code', maxlength: 12, value: plant?.code ?? '', placeholder: '예: B1', autocomplete: 'off', autocapitalize: 'characters' });
  const memoInput = h('textarea', { class: 'input', name: 'memo', maxlength: 300, placeholder: '예: 10월 20일 파종, 3번 화분' }, plant?.memo ?? '');
  const error = h('p', { class: 'form-error', hidden: true });

  // ---- 사진 (등록할 때만)
  const photo = { file: null, url: null, takenAt: null };
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const photoBox = h('div');
  const paintPhoto = () => {
    if (photo.url) {
      photoBox.replaceChildren(h('div', { class: 'photo-frame' },
        h('img', { src: photo.url, alt: '첫 사진 미리보기' }),
        h('button', {
          class: 'remove', type: 'button', 'aria-label': '사진 빼기', html: icons.close,
          onclick: () => { URL.revokeObjectURL(photo.url); Object.assign(photo, { file: null, url: null, takenAt: null }); paintPhoto(); },
        })));
    } else {
      const zone = h('button', { class: 'dropzone', type: 'button', onclick: () => { fileInput.removeAttribute('capture'); fileInput.click(); } },
        h('div', { class: 'ib', html: icons.upload }),
        h('div', { class: 't' }, '사진을 끌어다 놓거나 눌러서 고르기'),
        h('div', { class: 's' }, '식물 전체와 파란 기준 스티커가 함께 나오게 찍어 주세요'));
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
      zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files[0]) setPhoto(e.dataTransfer.files[0]); });
      photoBox.replaceChildren(zone);
    }
  };
  async function setPhoto(f) {
    if (!f.type.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요.', { error: true }); return; }
    if (photo.url) URL.revokeObjectURL(photo.url);
    photo.file = f;
    photo.url = URL.createObjectURL(f);
    photo.takenAt = (await readExifDate(f))?.slice(0, 16) || toLocalInput(new Date());
    paintPhoto();
  }
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) setPhoto(f); });
  paintPhoto();

  // ---- 실측값 (선택)
  const manual = {
    h: numberInput({ name: 'manual_height_cm', unit: 'cm', min: 0, max: 300 }),
    w: numberInput({ name: 'manual_width_cm', unit: 'cm', min: 0, max: 300 }),
    n: numberInput({ name: 'leaf_count', unit: '장', step: '1', min: 0 }),
  };
  const manualFields = h('div', { class: 'field-row three', hidden: true }, field('높이', manual.h), field('폭', manual.w), field('잎의 수', manual.n));
  const manualBtn = h('button', {
    class: 'btn btn-secondary', type: 'button',
    onclick: () => { manualFields.hidden = false; manualBtn.hidden = true; manual.h.querySelector('input').focus(); },
  }, ...withIcon('ruler', '자로 잰 값 입력하기'));

  // 새 식물이면 'B3' 처럼 다음 식물 ID 를 자동으로
  const nextCode = () => {
    const used = new Set(list.plants.map((p) => p.code));
    let n = list.plants.filter((p) => p.species === species).length + 1;
    while (used.has(`${PREFIX[species]}${n}`)) n += 1;
    return `${PREFIX[species]}${n}`;
  };

  const submit = h('button', { class: 'btn btn-primary', type: 'submit', style: { marginTop: '16px' } }, editing ? '저장하기' : '식물 등록하기');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      const name = nameInput.value.trim();
      try {
        if (editing) {
          const saved = await api.updatePlant(id, { name, code: codeInput.value.trim() || null, memo: memoInput.value.trim() || null, species });
          toast('저장했어요');
          location.replace(`#/plant/${saved.id}`);
          return;
        }
        const saved = await api.createPlant({ name, species, code: nextCode() });
        if (!photo.file) {
          toast(`${josa(saved.name, '을', '를')} 등록했어요`);
          location.replace(`#/plant/${saved.id}`);
          return;
        }
        submit.textContent = '첫 사진을 분석하는 중…';
        try {
          const ctx = await api.upload(saved.id, await prepareImage(photo.file), photo.takenAt);
          const v = (el) => { const x = el.querySelector('input').value.trim(); return x === '' ? null : Number(x); };
          const vals = { manual_height_cm: v(manual.h), manual_width_cm: v(manual.w), leaf_count: v(manual.n) };
          if (Object.values(vals).some((x) => x !== null)) await api.updateMeasurement(ctx.measurement.id, vals);
          toast(`${josa(saved.name, '을', '를')} 등록하고 첫 사진을 분석했어요`);
          location.replace(`#/photo?m=${ctx.measurement.id}`);
        } catch (err) {
          toast(`${josa(saved.name, '을', '를')} 등록했지만 사진 분석에 실패했어요: ${err.message}`, { error: true });
          location.replace(`#/plant/${saved.id}`);
        }
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = editing ? '저장하기' : '식물 등록하기';
      }
    },
  },
  backLink('뒤로'),
  h('header', null,
    h('h1', { class: 'large-title' }, editing ? '식물 정보 수정' : '식물 등록'),
    h('p', { class: 'subtitle' }, editing ? plant.name : '품종과 이름을 정하고, 첫 사진을 올리면 바로 분석을 시작해요.')),
  editing ? null : card('식물 사진', '첫 사진은 이후 생장을 비교하는 기준이 돼요. (선택)', photoBox,
    h('button', { class: 'btn btn-secondary', type: 'button', style: { marginTop: '12px' }, onclick: () => { fileInput.setAttribute('capture', 'environment'); fileInput.click(); } },
      ...withIcon('camera', '카메라로 찍기'))),
  card('품종 선택', '품종에 따라 온도·습도·토양 수분 추천 기준이 달라져요.',
    chips(varieties, species, (v) => { species = v; }, 'chips wrap')),
  card('식물 이름', '홈 화면 목록에 이 이름으로 보여요.', field('이름', nameInput),
    editing ? h('div', { style: { marginTop: '12px' } }, field('식물 ID', codeInput, '사진 파일 이름과 CSV 데이터에 함께 기록돼요.')) : null,
    editing ? h('div', { style: { marginTop: '12px' } }, field('메모 (선택)', memoInput)) : null),
  editing ? null : card('실측값 (선택)', '자로 잰 높이·폭을 남기면 첫 사진의 영상 분석값과 비교해 정확도를 확인할 수 있어요. 첫 사진과 함께 저장돼요.', manualBtn, manualFields),
  error,
  submit,
  fileInput);

  screen.className = 'screen no-tab push plain-bottom';
  screen.replaceChildren(form);
  return { className: 'no-tab push plain-bottom', cleanup: () => { if (photo.url) URL.revokeObjectURL(photo.url); } };
}
