import { api } from '../api.js';
import { h, icons, topbar, sheet, toast, relDays, isToday, goBack, skeleton } from '../ui.js';
import { prepareImage, readExifDate } from '../image.js';
import { openCamera, canUseLiveCamera } from '../camera.js';

const STEPS = ['사진 크기를 맞추는 중', '초록색 식물 영역을 찾는 중', '높이·폭·면적을 계산하는 중', '지난 기록과 비교하는 중'];

/** 촬영 탭: 식물을 고른 뒤 촬영 화면으로 */
export async function pickPlantAndCapture() {
  const { plants } = await api.plants();
  if (!plants.length) {
    toast('먼저 식물을 등록해 주세요');
    location.hash = '#/plant/new';
    return;
  }
  if (plants.length === 1) {
    location.hash = `#/plant/${plants[0].id}/capture`;
    return;
  }
  const sorted = [...plants].sort((a, b) => {
    const ta = a.latest && isToday(a.latest.taken_at) ? 1 : 0;
    const tb = b.latest && isToday(b.latest.taken_at) ? 1 : 0;
    return ta - tb || a.id - b.id;
  });
  sheet((close) => [
    h('h2', { class: 'sheet-title' }, '어떤 식물을 찍을까요?'),
    h('p', { class: 'sheet-desc' }, '오늘 아직 찍지 않은 식물이 위에 있어요.'),
    h('div', { class: 'list', style: { margin: '0 -20px', background: 'transparent' } }, sorted.map((p) => {
      const done = p.latest && isToday(p.latest.taken_at);
      return h('button', {
        class: 'list-item', type: 'button',
        onclick: async () => { await close(); location.hash = `#/plant/${p.id}/capture`; },
      },
      h('div', { class: 'thumb', style: { width: '48px', height: '48px', borderRadius: '12px' } },
        p.latest ? h('img', { src: p.latest.photo_url, alt: '' }) : h('span', { html: icons.sprout, style: { display: 'contents' } })),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, p.name, p.code ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, p.code) : null),
        h('div', { class: 'meta' }, p.latest ? `마지막 촬영 ${relDays(p.latest.taken_at)}` : '첫 사진을 찍어 주세요')),
      done ? h('span', { class: 'badge badge-good', html: icons.check + '오늘 완료' }) : h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } }));
    })),
  ]);
}

export async function captureView({ id }) {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '사진 찍기' }), skeleton(400, 8));
  const plant = await api.plant(id);
  const latest = plant.measurements[plant.measurements.length - 1];
  const canLive = canUseLiveCamera();
  let cam = null;
  let busy = false;

  const stop = () => { cam?.close(); cam = null; };

  // 숨겨진 파일 입력: 카메라 앱 / 앨범
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const albumInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await submit(file, await readExifDate(file));
  };
  camInput.addEventListener('change', onFile);
  albumInput.addEventListener('change', onFile);

  async function submit(fileOrBlob, exifDate) {
    if (busy) return;
    busy = true;
    const overlay = analyzingOverlay();
    try {
      // 앨범·카메라 앱 사진은 업로드 전에 줄이고, 실시간 카메라 프레임은 그대로 보냅니다.
      const blob = fileOrBlob instanceof File ? await prepareImage(fileOrBlob) : fileOrBlob;
      let takenAt = null;
      if (exifDate && Math.abs(new Date(exifDate) - Date.now()) > 10 * 60 * 1000) takenAt = exifDate;
      const res = await api.upload(plant.id, blob, takenAt);
      stop();
      overlay.remove();
      location.hash = `#/m/${res.measurement.id}?new=1`;
    } catch (err) {
      overlay.remove();
      busy = false;
      errorSheet(err.message);
    }
  }

  function analyzingOverlay() {
    const steps = h('div', { class: 'steps' }, STEPS[0]);
    const el = h('div', { class: 'analyzing', style: { position: 'fixed', zIndex: 70, color: '#fff' }, role: 'status' },
      h('div', { class: 'spinner' }), h('div', null, '사진을 분석하고 있어요'), steps);
    let i = 0;
    const timer = setInterval(() => { i = Math.min(STEPS.length - 1, i + 1); steps.textContent = STEPS[i]; }, 650);
    document.getElementById('layer').appendChild(el);
    const remove = el.remove.bind(el);
    el.remove = () => { clearInterval(timer); remove(); };
    return el;
  }

  function errorSheet(message) {
    sheet((close) => [
      h('h2', { class: 'sheet-title' }, '분석하지 못했어요'),
      h('p', { class: 'sheet-desc' }, message),
      h('ul', { class: 'tips', style: { marginBottom: '8px' } },
        h('li', null, h('span', { class: 'n' }, '1'), '식물이 사진 가운데에 크게 나오게 찍어 주세요.'),
        h('li', null, h('span', { class: 'n' }, '2'), '배경에 초록색 물건이 없도록 해 주세요.'),
        h('li', null, h('span', { class: 'n' }, '3'), '그래도 안 되면 설정에서 색상(HSV) 범위를 넓혀 보세요.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => close() }, '다시 찍기')),
    ]);
  }

  // ------------------------------------------------------------ 실시간 카메라 (HTTPS 일 때)
  async function liveMode() {
    fileMode(null); // 카메라를 닫으면 보이는 화면
    cam = await openCamera({
      title: plant.name,
      hint: latest ? '흐린 지난 사진에 화분을 맞춰 주세요' : '식물 전체와 자가 함께 나오게 찍어 주세요',
      ghostUrl: latest ? latest.photo_url : null,
      onShot: (blob) => submit(blob, null),
      onAlbum: async (file) => submit(file, await readExifDate(file)),
      onClose: () => { cam = null; goBack(`#/plant/${plant.id}`); },
    });
  }

  // ------------------------------------------------------------ 기본 모드: 휴대폰 카메라 앱 사용
  function fileMode(reason) {
    const content = [
      topbar({ title: `${plant.name} 촬영` }),
      latest
        ? h('div', { class: 'ref-photo', style: { marginTop: '4px' } },
          h('img', { src: latest.photo_url, alt: '지난 사진' }),
          h('span', { class: 'label' }, `지난 사진 · ${relDays(latest.taken_at)}`))
        : null,
      h('section', { class: 'card', style: { marginTop: '12px' } },
        h('h2', { class: 'card-title', style: { marginBottom: '14px' } }, latest ? '지난 사진과 같은 구도로 찍어 주세요' : '첫 사진이 기준이 돼요'),
        h('ul', { class: 'tips' },
          h('li', null, h('span', { class: 'n' }, '1'), '챔버에 표시한 같은 위치·높이에서 찍어요.'),
          h('li', null, h('span', { class: 'n' }, '2'), '화분 옆에 자를 세워 두면 cm 단위로 바꿀 수 있어요.'),
          h('li', null, h('span', { class: 'n' }, '3'), '식물 전체가 나오게, 배경은 단순하게 찍어요.'),
          h('li', null, h('span', { class: 'n' }, '4'), '조명 조건을 매번 같게 맞춰 주세요.'))),
      reason ? h('p', { class: 'caption', style: { margin: '12px 4px 0' } }, reason) : null,
      h('div', { class: 'cta' }, h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-secondary', style: { flex: '0 0 34%' }, onclick: () => albumInput.click() }, '앨범'),
        h('button', { class: 'btn btn-primary', onclick: () => camInput.click() },
          h('span', { html: icons.camera, style: { display: 'contents' } }), '카메라로 찍기'))),
      camInput, albumInput,
    ];
    screen.replaceChildren(...content.filter(Boolean));
  }

  if (canLive) {
    try {
      await liveMode();
    } catch (err) {
      fileMode('카메라를 바로 열 수 없어 휴대폰 카메라 앱으로 찍어요. (브라우저에서 카메라 권한을 허용하면 지난 사진을 겹쳐 보며 찍을 수 있어요)');
    }
  } else {
    fileMode(!window.isSecureContext ? 'HTTPS로 접속하면(python app.py --https) 지난 사진을 겹쳐 보면서 찍을 수 있어요.' : null);
  }
  return { cleanup: stop };
}
