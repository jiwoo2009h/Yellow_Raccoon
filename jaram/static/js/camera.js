// 실시간 카메라 (HTTPS 에서만): 지난 사진 겹쳐 보기 + 수평계 + 연속 촬영
// 일반 촬영(capture.js)과 3D 측정(scan.js)이 함께 씁니다.

import { h, icons } from './ui.js';
import { canvasToBlob } from './image.js';

export const canUseLiveCamera = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

/** iOS 는 기울기 센서를 쓰려면 사용자가 누른 버튼 안에서 권한을 받아야 함 */
export async function requestTiltPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try { return (await D.requestPermission()) === 'granted'; } catch { return false; }
  }
  return !!D;
}

/**
 * 수평계. mode 'upright' = 휴대폰을 세워 옆에서 찍기, 'flat' = 눕혀서 위에서 찍기.
 * 센서가 없거나 권한이 없으면 표시하지 않음.
 */
export function levelIndicator(mode = 'upright') {
  const bubble = h('span', { class: 'level-bubble' });
  const label = h('span', { class: 'level-text' });
  const el = h('div', { class: 'level', hidden: true, role: 'status', 'aria-live': 'polite' }, h('span', { class: 'level-ring' }, bubble), label);
  let current = mode;
  const onTilt = (e) => {
    if (e.beta === null || e.beta === undefined) return;
    const pitch = current === 'flat' ? e.beta : e.beta - 90;
    const roll = e.gamma || 0;
    const tilt = Math.max(Math.abs(pitch), Math.abs(roll));
    el.hidden = false;
    const ok = tilt <= 5;
    el.classList.toggle('ok', ok);
    label.textContent = ok ? '수평 ✓' : `${Math.round(tilt)}° 기울어짐`;
    const k = 1.6;
    bubble.style.transform = `translate(${Math.max(-18, Math.min(18, roll * k))}px, ${Math.max(-18, Math.min(18, pitch * k))}px)`;
  };
  window.addEventListener('deviceorientation', onTilt);
  // iOS: 버튼을 눌러야 센서 권한을 줄 수 있음
  const D = window.DeviceOrientationEvent;
  let ask = null;
  if (D && typeof D.requestPermission === 'function') {
    ask = h('button', {
      class: 'level-ask', type: 'button',
      onclick: async () => { if (await requestTiltPermission()) ask.remove(); else ask.textContent = '수평계 권한이 없어요'; },
    }, '수평계 켜기');
  }
  return {
    ask,
    el,
    setMode(m) { current = m; },
    stop() { window.removeEventListener('deviceorientation', onTilt); },
  };
}

/**
 * 전체 화면 카메라를 엽니다. 카메라를 열 수 없으면 오류를 던집니다(호출한 쪽에서 파일 선택으로 대체).
 * onShot(blob) 이 Promise 를 돌려주면 끝날 때까지 '분석 중' 을 표시합니다.
 */
export async function openCamera({ title, hint, ghostUrl, level = 'upright', onShot, onAlbum, onClose, extra }) {
  let stream = null;
  let facing = 'environment';
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const stopStream = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const start = async () => {
    stopStream();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
  };
  await start();

  const ghost = h('img', { class: 'ghost', alt: '', hidden: !ghostUrl });
  if (ghostUrl) ghost.src = ghostUrl;
  const hintEl = h('div', { class: 'hint' }, hint || '');
  const tilt = levelIndicator(level);
  const finder = h('div', { class: 'viewfinder' }, video, ghost,
    h('span', { html: '<svg class="grid-lines" viewBox="0 0 3 3" preserveAspectRatio="none"><path d="M1 0v3M2 0v3M0 1h3M0 2h3" stroke="rgba(255,255,255,.28)" stroke-width=".01" vector-effect="non-scaling-stroke"/></svg>', style: { display: 'contents' } }),
    hintEl, tilt.el, tilt.ask);
  const slider = h('label', { class: 'ghost-slider', hidden: !ghostUrl }, '겹쳐 보기',
    h('input', {
      type: 'range', min: 0, max: 70, value: 35, 'aria-label': '지난 사진 투명도',
      oninput: (e) => finder.style.setProperty('--ghost', e.target.value / 100),
    }));
  const titleEl = h('div', { class: 'camera-title' }, title || '');
  const albumInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  albumInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && onAlbum) run(() => onAlbum(file));
  });
  const busyEl = h('div', { class: 'analyzing', hidden: true }, h('div', { class: 'spinner' }), h('div', null, '사진을 분석하고 있어요'));
  const extraBtn = h('button', { class: 'btn btn-text cam-extra', hidden: !extra, onclick: () => extra && extra.onClick() }, extra ? extra.label : '');

  let busy = false;
  async function run(fn) {
    if (busy) return;
    busy = true;
    busyEl.hidden = false;
    try { await fn(); } finally { busy = false; busyEl.hidden = true; }
  }
  const shoot = () => run(async () => {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    await onShot(await canvasToBlob(c, 0.92));
  });

  const cam = h('div', { class: 'camera', role: 'dialog', 'aria-label': title || '카메라' },
    h('div', { class: 'camera-top' },
      h('button', { class: 'icon-btn', 'aria-label': '닫기', html: icons.close, onclick: () => { api.close(); onClose && onClose(); } }),
      titleEl,
      extraBtn),
    finder,
    slider,
    h('div', { class: 'camera-bottom' },
      h('div', { class: 'cam-side' }, h('button', { class: 'icon-btn', 'aria-label': '앨범에서 선택', html: icons.image, onclick: () => albumInput.click() }), '앨범'),
      h('button', { class: 'shutter', 'aria-label': '촬영', onclick: shoot }),
      h('div', { class: 'cam-side' }, h('button', {
        class: 'icon-btn', 'aria-label': '카메라 전환', html: icons.flip,
        onclick: async () => { facing = facing === 'environment' ? 'user' : 'environment'; await start().catch(() => {}); },
      }), '전환')),
    busyEl, albumInput);
  document.getElementById('layer').appendChild(cam);

  const api = {
    close() { stopStream(); tilt.stop(); cam.remove(); },
    update({ title: t, hint: hi, ghostUrl: g, level: lv, extra: ex } = {}) {
      if (t !== undefined) titleEl.textContent = t;
      if (hi !== undefined) hintEl.textContent = hi;
      if (g !== undefined) { ghost.hidden = !g; slider.hidden = !g; if (g) ghost.src = g; }
      if (lv) tilt.setMode(lv);
      if (ex !== undefined) {
        extraBtn.hidden = !ex;
        extraBtn.textContent = ex ? ex.label : '';
        extraBtn.onclick = () => ex && ex.onClick();
      }
    },
  };
  return api;
}
