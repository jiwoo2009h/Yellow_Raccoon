// 사진 분석
// 사진 선택 -> (글쓰기 화면처럼) 식물·촬영 날짜/시간·메모 고르기 -> '완료' -> OpenCV 분석
// -> 높이·폭·투영 면적·노란 잎 비율 표시 -> 자로 잰 값(선택) 입력 후 저장

import { api } from '../api.js';
import {
  h, icons, segmented, chips, toast, fmt, signed, withIcon, toLocalInput, confirmSheet, plantTitle, skeleton,
  numberInput, field,
} from '../ui.js';
import { prepareImage, readExifDate } from '../image.js';
import { canUseLiveCamera, openLiveCamera } from '../camera.js';

const p2 = (n) => String(n).padStart(2, '0');
const todayShort = () => { const d = new Date(); return `${p2(d.getMonth() + 1)}.${p2(d.getDate())}`; };

export async function photoView(params) {
  const screen = document.getElementById('screen');
  const head = h('header', null,
    h('div', { class: 'title-row' },
      h('h1', { class: 'large-title' }, '사진 분석'),
      h('span', { class: 'date-inline' }, ...withIcon('clock', todayShort()))),
    h('p', { class: 'subtitle' }, '매번 같은 위치·거리에서, 파란 기준 스티커가 함께 나오도록 찍어 주세요.'));
  screen.append(head, skeleton(36, 16), skeleton(45), skeleton(320, 16));

  const { plants } = await api.plants();
  if (!plants.length) {
    screen.replaceChildren(head, h('div', { class: 'empty' },
      h('div', { class: 'art', html: icons.sprout }),
      h('h2', null, '먼저 식물을 등록해 주세요'),
      h('p', null, '바질이나 상추를 등록하면 사진을 찍어 생장을 분석할 수 있어요.'),
      h('a', { class: 'btn btn-primary', href: '#/plant/new' }, ...withIcon('plus', '식물 등록하기'))));
    return;
  }

  const state = {
    plantId: Number(params.plant) || plants[0].id,
    mode: 'camera',
    file: null,
    blob: null,
    preview: null,
    takenAt: toLocalInput(new Date()),
    exif: false,
    note: '',
    ctx: null, // 분석 결과 (measurement context)
    view: 'result',
    busy: false,
  };
  const mid = Number(params.m);
  if (mid) {
    state.ctx = await api.measurement(mid);
    state.plantId = state.ctx.plant.id;
  }
  const plantOf = (id) => plants.find((p) => p.id === id);

  // 숨겨진 파일 선택 상자 (카메라 / 앨범·파일)
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await pick(f);
  });
  const openPicker = async () => {
    if (state.mode === 'camera' && canUseLiveCamera()) {
      // HTTPS: 지난 사진을 겹쳐 보며 찍는 실시간 카메라
      const plant = plantOf(state.plantId);
      try {
        const shot = await openLiveCamera({ title: plant.name, ghostUrl: plant.latest?.photo_url });
        if (shot) await pick(shot);
        return;
      } catch {
        toast('카메라를 바로 열 수 없어 휴대폰 카메라 앱으로 찍어요.');
      }
    }
    if (state.mode === 'camera') fileInput.setAttribute('capture', 'environment');
    else fileInput.removeAttribute('capture');
    fileInput.click();
  };

  async function pick(f) {
    if (!f.type.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요.', { error: true }); return; }
    const exif = await readExifDate(f);
    if (state.preview) URL.revokeObjectURL(state.preview);
    state.file = f;
    state.blob = null;
    state.preview = URL.createObjectURL(f);
    state.takenAt = exif ? exif.slice(0, 16) : toLocalInput(new Date());
    state.exif = !!exif;
    state.ctx = null;
    render();
  }

  const body = h('div');
  screen.replaceChildren(head, body, fileInput);

  function render() {
    const locked = !!state.ctx; // 분석이 끝나면 식물은 바꿀 수 없음
    const picker = chips(plants.map((p) => [p.id, p.name]), state.plantId, (v) => {
      if (locked) return;
      state.plantId = v;
      if (state.file) render();
    });
    picker.style.marginTop = '16px';
    if (locked) picker.querySelectorAll('button').forEach((b) => { b.disabled = b.getAttribute('aria-pressed') !== 'true'; });

    // 누를 때마다 바로 카메라/파일 선택 창을 엽니다 (이미 선택된 쪽을 다시 눌러도 열림)
    const mode = h('div', { class: 'seg', role: 'group', 'aria-label': '사진 입력 방법' });
    for (const [v, ic, label] of [['camera', 'camera', '카메라로 찍기'], ['file', 'upload', '파일 올리기']]) {
      mode.appendChild(h('button', {
        type: 'button', 'aria-pressed': String(state.mode === v), dataset: { v },
        onclick: () => {
          state.mode = v;
          mode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
          openPicker();
        },
      }, ...withIcon(ic, label)));
    }
    mode.style.marginTop = '16px';

    body.replaceChildren(picker, mode,
      state.ctx ? resultSection() : state.file ? composeSection() : emptySection());
  }

  // ---------------------------------------------------------------- 1. 사진 고르기
  function emptySection() {
    const zone = h('button', { class: 'dropzone', type: 'button', onclick: openPicker },
      h('div', { class: 'ib', html: icons.upload }),
      h('div', { class: 't' }, '사진을 찍거나 골라 주세요'),
      h('div', { class: 's' }, '식물 전체와 파란 기준 스티커가 함께 보이게 · JPG, PNG'));
    // 컴퓨터에서는 끌어다 놓기
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) pick(f);
    });
    return h('section', { class: 'card', style: { marginTop: '16px' } }, zone);
  }

  // ---------------------------------------------------------------- 2. 글쓰기 화면 (식물·날짜·메모)
  function composeSection() {
    const dt = h('input', { class: 'input', type: 'datetime-local', value: state.takenAt, max: toLocalInput(new Date()) });
    dt.addEventListener('change', () => { state.takenAt = dt.value; });
    const note = h('textarea', { class: 'input', rows: 3, maxlength: 300, placeholder: '오늘 식물의 모습을 적어 두세요 (선택)' }, state.note);
    note.addEventListener('input', () => { state.note = note.value; });
    const frame = h('div', { class: 'photo-frame' },
      h('img', { src: state.preview, alt: '고른 사진 미리보기' }),
      h('button', {
        class: 'remove', type: 'button', 'aria-label': '사진 빼기', html: icons.close,
        onclick: () => { URL.revokeObjectURL(state.preview); state.file = null; state.preview = null; render(); },
      }));
    const done = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => analyze(frame, done) }, ...withIcon('check', '완료 · 분석하기'));
    return h('div', null,
      h('section', { class: 'card', style: { marginTop: '16px' } },
        frame,
        h('div', { style: { marginTop: '14px' } },
          field('어느 식물인가요?', h('div', { class: 'caption' }, plantTitle(plantOf(state.plantId)), ' · 위에서 바꿀 수 있어요')),
          field('촬영 날짜 및 시간', dt, state.exif ? '사진에 기록된 촬영 시각을 자동으로 넣었어요. 다르면 고쳐 주세요.' : '지금 시각을 넣었어요. 예전에 찍은 사진이면 고쳐 주세요.'),
          field('메모', note))),
      h('div', { style: { marginTop: '16px' } }, done));
  }

  async function analyze(frame, btn) {
    if (state.busy) return;
    if (!state.takenAt) { toast('촬영 날짜와 시간을 골라 주세요.', { error: true }); return; }
    state.busy = true;
    btn.disabled = true;
    frame.appendChild(h('div', { class: 'loading-veil' }, h('div', null, h('div', { class: 'spinner' }), '식물 영역을 분석하는 중…')));
    try {
      state.blob = state.blob || await prepareImage(state.file);
      let ctx = await api.upload(state.plantId, state.blob, state.takenAt);
      if (state.note.trim()) ctx = await api.updateMeasurement(ctx.measurement.id, { note: state.note.trim() });
      state.ctx = ctx;
      state.view = 'result';
      URL.revokeObjectURL(state.preview);
      state.file = null; state.preview = null; state.note = '';
      history.replaceState(null, '', `#/photo?m=${ctx.measurement.id}`);
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast(err.message, { error: true });
      frame.querySelector('.loading-veil')?.remove();
      btn.disabled = false;
    } finally {
      state.busy = false;
    }
  }

  // ---------------------------------------------------------------- 3. 분석 결과
  function resultSection() {
    const { measurement: m, previous, plant } = state.ctx;
    const cm = plant.unit === 'cm';
    const unit = cm ? 'cm' : 'px';
    const img = h('img', { alt: '분석한 식물 사진', style: { maxHeight: 'none', width: '100%' } });
    const box = h('div', { style: { position: 'relative', width: '100%' } }, img);
    const frame = h('div', { class: 'photo-frame' }, box);
    if (m.ref) frame.appendChild(h('span', { class: 'float-chip' }, h('i'), `기준물 인식 · ${fmt(m.ref.px_per_cm, 1)} px/cm`));
    else if (!cm) frame.appendChild(h('span', { class: 'float-chip warn' }, h('i'), '기준물 없음 · px 단위'));
    const label = m.bbox ? h('span', {
      class: 'bbox-label',
      style: { left: `${(m.bbox[0] / m.img_w) * 100}%`, top: `${(m.bbox[1] / m.img_h) * 100}%` },
    }, `H ${fmt(m.height, 1)}${unit}  W ${fmt(m.width, 1)}${unit}`) : null;
    const setView = (v) => {
      state.view = v;
      img.src = v === 'orig' ? m.photo_url : v === 'mask' ? m.mask_url : m.overlay_url;
      if (label) label.hidden = v !== 'result';
    };
    if (label) box.appendChild(label);
    setView(state.view);
    const viewSeg = segmented([['orig', '원본'], ['mask', '식물 영역'], ['result', '결과']], state.view, setView);
    viewSeg.style.marginTop = '12px';

    const d = (key, digits = 1, suffix = '') => {
      if (!previous || m.delta?.[key] === undefined || m.delta?.[key] === null) return null;
      const v = m.delta[key];
      return h('div', { class: 'd ' + (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') }, `지난 기록 대비 ${signed(v, digits)}${suffix}`);
    };
    const met = (ic, k, v, u, delta) => h('div', { class: 'metric' },
      h('div', { class: 'k' }, h('span', { html: icons[ic], style: { display: 'contents' } }), k),
      h('div', { class: 'v' }, v, h('small', null, u)), delta);

    const manual = {
      h: numberInput({ name: 'manual_height_cm', value: m.manual_height_cm, unit: 'cm', min: 0, max: 300 }),
      w: numberInput({ name: 'manual_width_cm', value: m.manual_width_cm, unit: 'cm', min: 0, max: 300 }),
      n: numberInput({ name: 'leaf_count', value: m.leaf_count, unit: '장', step: '1', min: 0 }),
    };
    const save = async (btn) => {
      const v = (el) => { const x = el.querySelector('input').value.trim(); return x === '' ? null : Number(x); };
      btn.disabled = true;
      try {
        await api.updateMeasurement(m.id, {
          manual_height_cm: v(manual.h), manual_width_cm: v(manual.w), leaf_count: v(manual.n),
        });
        toast('분석 결과를 저장했어요');
        location.hash = `#/plant/${plant.id}`;
      } catch (err) {
        toast(err.message, { error: true });
        btn.disabled = false;
      }
    };
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save(saveBtn) }, ...withIcon('check', '이 결과 저장하기'));

    return h('div', null,
      h('section', { class: 'card', style: { marginTop: '16px' } }, frame, viewSeg),
      m.warnings?.length ? h('ul', { class: 'warn-list' }, m.warnings.map((w) => h('li', null, h('span', { html: icons.warn, style: { display: 'contents' } }), w))) : null,
      h('div', { class: 'metric-grid', style: { marginTop: '16px' } },
        met('ruler', '높이', fmt(m.height, 1), unit, d('height', 1, unit)),
        met('ruler', '폭', fmt(m.width, 1), unit, d('width', 1, unit)),
        met('leaf', '투영 면적', fmt(m.area, 1), cm ? 'cm²' : 'px', d('area_pct', 1, '%')),
        met('alert', '노란 잎 비율', fmt(m.yellow_ratio ?? 0, 1), '%', null)),
      h('p', { class: 'detail-line' },
        `잎 평균 Hue ${fmt(m.hue, 1)} · 채도 ${fmt(m.sat, 1)} · ExG ${fmt(m.exg, 2)} · 식물 영역 ${Number(m.area_px).toLocaleString('ko-KR')} px`,
        h('br'), `${plantTitle(plant)} · ${state.ctx.index + 1}번째 기록 · ${m.taken_at.slice(0, 16).replace('T', ' ')}`,
        m.note ? [h('br'), `메모: ${m.note}`] : null),
      h('section', { class: 'card', style: { marginTop: '16px' } },
        h('h2', { class: 'card-title' }, '자로 직접 잰 값 (선택)'),
        h('p', { class: 'card-sub' }, '입력하면 정확도 검증에서 영상 분석값과 비교해요.'),
        h('div', { class: 'field-row three', style: { marginTop: '12px' } },
          field('높이', manual.h), field('폭', manual.w), field('잎의 수', manual.n))),
      h('div', { style: { marginTop: '16px' } },
        saveBtn,
        h('a', { class: 'btn btn-secondary', href: `#/settings/species/${plant.species}` }, ...withIcon('sliders', '식물 영역이 잘 안 잡혀요 · HSV 조정')),
        h('div', { style: { display: 'flex', justifyContent: 'center', marginTop: '8px' } },
          h('button', {
            class: 'btn btn-text', type: 'button',
            onclick: async () => {
              const ok = await confirmSheet({ title: '이 기록을 지울까요?', desc: '사진과 분석 결과가 함께 지워지고 되돌릴 수 없어요.', ok: '지우기', danger: true });
              if (!ok) return;
              await api.deleteMeasurement(m.id);
              toast('기록을 지웠어요');
              state.ctx = null;
              history.replaceState(null, '', '#/photo');
              render();
            },
          }, '이 기록 지우기'))));
  }

  render();
  return { cleanup: () => { if (state.preview) URL.revokeObjectURL(state.preview); } };
}
