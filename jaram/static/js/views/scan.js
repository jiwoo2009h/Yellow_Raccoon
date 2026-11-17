// 3D 측정: 식물 둘레를 돌며 0°·90°·180°·270° (+ 위) 사진을 찍고 3D 영역을 계산합니다.

import { api } from '../api.js';
import { h, icons, topbar, toast, sheet, skeleton, confirmSheet, friendlyError, withBusy, progressSheet } from '../ui.js';
import { prepareImage } from '../image.js';
import { photoInfos, releaseInfos, dropZone, scanAssignSheet } from '../bulk.js';
import { openCamera, canUseLiveCamera } from '../camera.js';
import { roiEditor } from './roi.js';

export const SCAN_STEPS = [
  { key: 'a0', kind: 'side', angle: 0, title: '정면 0°', short: '0°', hint: '평소 찍는 고정 위치에서, 자가 함께 나오게 찍어요.', level: 'upright' },
  { key: 'a90', kind: 'side', angle: 90, title: '¼바퀴 90°', short: '90°', hint: '같은 방향으로 ¼바퀴 돌아서, 같은 높이·비슷한 거리에서 찍어요.', level: 'upright' },
  { key: 'a180', kind: 'side', angle: 180, title: '반 바퀴 180°', short: '180°', hint: '정면의 반대편에서, 같은 높이로 찍어요.', level: 'upright' },
  { key: 'a270', kind: 'side', angle: 270, title: '¾바퀴 270°', short: '270°', hint: '¾바퀴 돈 자리에서, 같은 높이로 찍어요.', level: 'upright' },
  { key: 'top', kind: 'top', angle: null, title: '위 (선택)', short: '위', hint: '정면(0°) 쪽이 사진 아래에 오게, 바로 위에서 내려다보며 찍어요.', level: 'flat', optional: true },
];
export const viewKey = (v) => (v.kind === 'top' ? 'top' : `a${Math.round(v.angle)}`);

/** 위에서 본 촬영 위치 그림 (찍은 곳은 초록, 지금 찍을 곳은 테두리) */
function diagram(done, current) {
  const pos = { a0: [60, 104], a90: [16, 60], a180: [60, 16], a270: [104, 60] };
  const marks = Object.entries(pos).map(([k, [x, y]]) => {
    const fill = done[k] ? 'var(--accent)' : 'var(--surface-3)';
    const ring = current === k ? '<circle cx="' + x + '" cy="' + y + '" r="13" style="fill:none;stroke:var(--accent);stroke-width:2"/>' : '';
    const label = SCAN_STEPS.find((s) => s.key === k).short;
    return `${ring}<rect x="${x - 6}" y="${y - 9}" width="12" height="18" rx="3" style="fill:${fill}"/>`
      + `<text x="${x}" y="${y + (y > 60 ? 22 : y < 60 ? -13 : 4)}" dx="${x < 60 ? -20 : x > 60 ? 20 : 0}" text-anchor="middle" style="fill:var(--text-3);font-size:9px;font-weight:600">${label}</text>`;
  }).join('');
  const topFill = done.top ? 'var(--accent)' : 'var(--surface-3)';
  return h('span', {
    style: { display: 'contents' },
    html: `<svg class="scan-diagram" viewBox="-18 -8 156 140" aria-hidden="true">
      <circle cx="60" cy="60" r="34" style="fill:none;stroke:var(--line);stroke-width:1.5;stroke-dasharray:3 4"/>
      <path d="M46 92 A34 34 0 0 1 28 74" style="fill:none;stroke:var(--text-4);stroke-width:1.5"/>
      <path d="M28 74 l1 -7 M28 74 l6 -3" style="fill:none;stroke:var(--text-4);stroke-width:1.5;stroke-linecap:round"/>
      <circle cx="60" cy="60" r="15" style="fill:var(--surface-2);stroke:var(--line)"/>
      <ellipse cx="54" cy="58" rx="7" ry="4" style="fill:var(--accent)"/><ellipse cx="66" cy="62" rx="7" ry="4" style="fill:var(--accent)"/>
      <ellipse cx="60" cy="54" rx="4" ry="6" style="fill:var(--accent)"/>
      ${marks}
      <rect x="92" y="94" width="18" height="12" rx="3" style="fill:${topFill}"/>
      <text x="101" y="116" text-anchor="middle" style="fill:var(--text-3);font-size:9px;font-weight:600">위</text>
    </svg>`,
  });
}

export async function scanView({ id }) {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '3D 측정' }), skeleton(160, 8), skeleton(320));
  const plant = await api.plant(id);
  // 기다리는 사이 다른 화면으로 갔으면 새 3D 측정(초안)을 만들지 않음
  if (!screen.isConnected) return undefined;
  let scan = await api.createScan(id);
  const refs = scan.reference_views || {};
  const live = canUseLiveCamera();
  let cam = null;
  let busyKey = null;
  let computing = false;
  let left = false;

  const viewsByKey = () => Object.fromEntries((scan.views || []).map((v) => [viewKey(v), v]));
  const nextMissing = (after) => {
    const v = viewsByKey();
    const start = after ? SCAN_STEPS.indexOf(after) + 1 : 0;
    return SCAN_STEPS.slice(start).find((s) => !v[s.key]) || SCAN_STEPS.slice(0, start).find((s) => !v[s.key] && !s.optional);
  };
  const canCompute = () => { const v = viewsByKey(); return !!(v.a0 && (v.a90 || v.a270)); };

  async function upload(step, fileOrBlob) {
    if (busyKey) { toast('앞의 사진을 분석하고 있어요. 잠시만 기다려 주세요'); return false; }
    busyKey = step.key;
    render();
    try {
      const blob = fileOrBlob instanceof File ? await prepareImage(fileOrBlob) : fileOrBlob;
      scan = await api.uploadScanView(scan.id, blob, step.kind, step.angle);
      toast(`${step.short} 사진에서 식물을 찾았어요`);
      return true;
    } catch (err) {
      toast(friendlyError(err), { error: true });
      return false;
    } finally {
      busyKey = null;
      render();
    }
  }

  // 파일 선택 칸은 하나만 만들어 다시 써요 (취소해도 body 에 쌓이지 않게)
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  let fileStep = null;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f && fileStep) await upload(fileStep, f);
  });
  function pickFile(step, camera) {
    if (busyKey) return;
    fileStep = step;
    if (camera) fileInput.setAttribute('capture', 'environment'); else fileInput.removeAttribute('capture');
    fileInput.click();
  }

  // ------------------------------------------------------------ 미리 찍어 둔 사진 여러 장 한꺼번에
  const bulkInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  bulkInput.addEventListener('change', () => {
    const files = [...(bulkInput.files || [])];
    bulkInput.value = '';
    if (files.length) bulkUpload(files);
  });
  const undrop = dropZone(screen, (files) => bulkUpload(files));

  async function bulkUpload(files) {
    if (busyKey || computing || cam) { toast('지금 하는 작업이 끝나면 다시 올려 주세요'); return; }
    const infos = await photoInfos(files);
    if (!infos.length) { toast('사진 파일만 올릴 수 있어요', { error: true }); return; }
    try {
      const picks = await scanAssignSheet(infos, new Set(Object.keys(viewsByKey())));
      if (!picks || !picks.length || !screen.isConnected) return;
      busyKey = 'bulk';
      render();
      const prog = progressSheet('사진을 올리고 있어요', `0/${picks.length}장 · 화면을 닫지 말고 기다려 주세요`);
      const failed = [];
      let done = 0;
      for (const { info, key } of picks) {
        const step = SCAN_STEPS.find((st) => st.key === key);
        try {
          const blob = await prepareImage(info.file);
          scan = await api.uploadScanView(scan.id, blob, step.kind, step.angle);
          done += 1;
        } catch (err) {
          failed.push(`${step.short} (${info.name}): ${friendlyError(err)}`);
        }
        prog.update(`${done + failed.length}/${picks.length}장 · 화면을 닫지 말고 기다려 주세요`);
      }
      prog.close();
      busyKey = null;
      render();
      if (!failed.length) toast(`${done}장을 올렸어요`);
      else {
        sheet((close) => [
          h('h2', { class: 'sheet-title' }, `${done}장을 올렸어요 · ${failed.length}장은 올리지 못했어요`),
          h('ul', { class: 'algo-list' }, failed.map((f) => h('li', null, f))),
          h('p', { class: 'caption' }, '식물이 잘 보이게 다시 찍거나, 올린 뒤 사진을 눌러 분석 영역을 지정해 주세요.'),
          h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close() }, '확인')),
        ]);
      }
    } finally {
      busyKey = null;
      releaseInfos(infos);
      render();
    }
  }

  /** 카메라를 열 수 없을 때: 사용자가 직접 누르는 버튼으로 파일 선택 (iOS 는 자동 클릭을 막음) */
  function fallbackSheet(step) {
    sheet((close) => [
      h('h2', { class: 'sheet-title' }, '카메라를 바로 열 수 없어요'),
      h('p', { class: 'sheet-desc' }, '휴대폰 카메라 앱으로 찍거나 앨범에서 골라 주세요. 브라우저에서 카메라 권한을 허용하면 지난 사진을 겹쳐 보며 찍을 수 있어요.'),
      h('div', { class: 'btn-row actions' },
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { pickFile(step, false); close(); } }, '앨범'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { pickFile(step, true); close(); } },
          h('span', { html: icons.camera, style: { display: 'contents' } }), '카메라 앱으로 찍기')),
    ]);
  }

  const camOpts = (st) => ({
    title: `${st.title} · ${plant.name}`,
    hint: st.hint,
    ghostUrl: refs[st.key] || null,
    level: st.level,
    extra: st.optional ? { label: '건너뛰기', onClick: () => finishCam() } : null,
  });

  function finishCam() { cam?.close(); cam = null; render(); }

  let opening = false;
  async function startCamera(first, single = false) {
    if (cam || opening || busyKey) return;
    opening = true;
    let step = first;
    const after = async (ok) => {
      if (!ok || !cam) return;
      const nxt = single ? null : nextMissing(step);
      if (!nxt) { finishCam(); return; }
      step = nxt;
      cam.update(camOpts(step));
    };
    try {
      const opened = await openCamera({
        ...camOpts(step),
        onShot: async (blob) => after(await upload(step, blob)),
        onAlbum: async (file) => after(await upload(step, file)),
        onClose: () => { cam = null; render(); },
      });
      if (left || !screen.isConnected) { opened.close(); return; }
      cam = opened;
    } catch {
      if (!left) fallbackSheet(step);
    } finally {
      opening = false;
    }
  }

  const take = (step, single) => (live ? startCamera(step, single) : pickFile(step, true));

  function viewSheet(step, v) {
    sheet((close) => [
      h('h2', { class: 'sheet-title' }, `${step.title} 사진`),
      h('img', { src: v.overlay_url, alt: `${step.title} 분석 결과`, style: { width: '100%', borderRadius: '16px', marginTop: '8px' } }),
      v.warnings.length ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
        h('span', { html: icons.warn, style: { display: 'contents' } }), h('div', { class: 'grow' }, v.warnings.map((w) => h('div', null, w)))) : null,
      h('p', { class: 'caption', style: { margin: '10px 2px 0' } }, '초록으로 칠해진 부분이 이 식물로 인식된 영역이에요. 다른 화분이 섞였다면 영역을 지정해 주세요.'),
      h('div', { class: 'list', style: { margin: '12px -20px 0', background: 'transparent' } },
        h('button', { class: 'list-item', type: 'button', onclick: async () => { await close(); roiSheet(step, v); } },
          h('div', { class: 'list-icon', html: icons.crop }), h('div', { class: 'grow' }, h('div', { class: 'title' }, '영역 지정해서 다시 분석'))),
        h('button', { class: 'list-item', type: 'button', onclick: async () => { await close(); take(step, true); } },
          h('div', { class: 'list-icon', html: icons.camera }), h('div', { class: 'grow' }, h('div', { class: 'title' }, '다시 찍기'))),
        h('button', { class: 'list-item', type: 'button', onclick: async () => { await close(); pickFile(step, false); } },
          h('div', { class: 'list-icon', html: icons.image }), h('div', { class: 'grow' }, h('div', { class: 'title' }, '앨범에서 바꾸기'))),
        h('button', {
          class: 'list-item', type: 'button',
          onclick: async () => {
            await close();
            const ok = await confirmSheet({ title: `${step.title} 사진을 뺄까요?`, desc: '이 방향은 다시 찍어야 해요.', ok: '빼기', danger: true });
            if (!ok) return;
            try {
              scan = await api.deleteScanView(scan.id, v.id);
            } catch (err) {
              toast(friendlyError(err), { error: true });
            }
            render();
          },
        }, h('div', { class: 'list-icon care', html: icons.trash }),
        h('div', { class: 'grow' }, h('div', { class: 'title', style: { color: 'var(--care-text)' } }, '이 사진 빼기')))),
    ]);
  }

  function roiSheet(step, v) {
    const editor = roiEditor(v.photo_url, v.roi);
    sheet((close) => [
      h('h2', { class: 'sheet-title' }, `${step.title} 분석 영역`),
      h('p', { class: 'sheet-desc' }, '이 식물만 들어가게 사각형을 맞춰 주세요.'),
      editor.stage,
      editor.readout,
      h('div', { class: 'actions' }, h('button', {
        class: 'btn btn-primary',
        onclick: (e) => withBusy(e.currentTarget, async () => {
          scan = await api.updateScanView(scan.id, v.id, { roi: editor.get() });
          toast('영역을 바꿔 다시 분석했어요');
          await close();
          render();
        }),
      }, '다시 분석'))]);
  }

  async function compute() {
    if (computing) return;
    computing = true;
    render();
    try {
      await api.computeScan(scan.id);
      if (screen.isConnected) location.replace(`#/scan/${scan.id}`);
      else toast('3D 계산을 마쳤어요');
    } catch (err) {
      toast(friendlyError(err), { error: true });
      computing = false;
      render();
    }
  }

  function stepRow(step) {
    const v = viewsByKey()[step.key];
    const busy = busyKey === step.key;
    return h('div', { class: 'list-item scan-step' },
      v ? h('button', { class: 'step-thumb', type: 'button', 'aria-label': `${step.title} 사진 보기`, onclick: () => viewSheet(step, v) },
        h('img', { src: v.overlay_url, alt: '' }))
        : h('div', { class: 'step-thumb empty' }, step.short),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, step.title, v ? h('span', { class: 'step-ok', html: icons.check }) : null),
        h('div', { class: 'meta' }, busy ? '분석하는 중…' : v ? (v.warnings[0] || '식물을 찾았어요. 눌러서 확인할 수 있어요.') : step.hint)),
      busy ? h('div', { class: 'spinner small', role: 'status', 'aria-label': '분석하는 중' })
        : h('button', { class: `btn btn-sm ${v ? 'btn-secondary' : 'btn-soft'}`, disabled: !!busyKey || computing, onclick: () => take(step, !!v) }, v ? '다시' : '찍기'));
  }

  function render() {
    if (!screen.isConnected) return; // 다른 화면으로 이동한 뒤에는 그리지 않음
    const v = viewsByKey();
    const next = nextMissing();
    const sides = ['a0', 'a90', 'a180', 'a270'].filter((k) => v[k]).length;
    screen.replaceChildren(
      topbar({ title: '3D 측정' }),
      h('section', { class: 'card scan-guide', style: { marginTop: '4px' } },
        diagram(v, next && next.key),
        h('div', null,
          h('h2', { class: 'card-title' }, `${plant.name} 둘레를 돌며 찍어요`),
          h('p', { class: 'card-sub', style: { margin: 0 } }, '0°는 평소 자리에서 찍고, 나머지는 같은 방향으로 ¼바퀴씩 돌며 같은 높이에서 찍어요. 휴대폰을 수평으로 들어 주세요.'))),
      h('section', { class: 'card bulk-card', style: { marginTop: '12px' } },
        h('div', { class: 'list-icon accent', html: icons.image }),
        h('div', { class: 'grow' },
          h('h3', { class: 'card-title' }, '미리 찍어 둔 사진 올리기'),
          h('p', { class: 'card-sub', style: { margin: '2px 0 0' } }, '여러 장을 한꺼번에 고르거나 이 화면에 끌어다 놓으면, 파일 이름(측·항공 등)과 촬영 시각으로 방향을 정해 줘요.')),
        h('button', { class: 'btn btn-soft btn-sm', type: 'button', disabled: !!busyKey || computing, onclick: () => bulkInput.click() }, '사진 고르기')),
      h('div', { class: 'list scan-steps', style: { marginTop: '12px' } }, SCAN_STEPS.map(stepRow)),
      h('p', { class: 'caption', style: { margin: '12px 4px 0' } },
        sides < 4 ? `측면 ${sides}/4장 · 4장을 모두 찍으면 더 정확해요. 최소 0°와 90°(또는 270°)가 필요해요.` : '측면 4장을 모두 찍었어요. 위 사진은 선택이에요.'),
      h('div', { class: 'cta' }, h('div', { class: 'btn-row' },
        live && next ? h('button', { class: 'btn btn-secondary', style: { flex: '0 0 40%' }, disabled: !!busyKey || computing, onclick: () => take(next, false) },
          h('span', { html: icons.camera, style: { display: 'contents' } }), '이어 찍기') : null,
        h('button', { class: 'btn btn-primary' + (computing ? ' is-loading' : ''), disabled: !canCompute() || computing || !!busyKey, onclick: compute },
          h('span', { html: icons.cube, style: { display: 'contents' } }), computing ? '계산하는 중…' : '3D 계산하기'))),
      fileInput, bulkInput);
  }

  render();
  return {
    cleanup: () => { left = true; undrop(); cam?.close(); cam = null; },
  };
}

