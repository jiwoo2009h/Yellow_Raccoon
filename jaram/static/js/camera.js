// 실시간 카메라 (HTTPS 에서만 동작)
// 지난 사진을 반투명하게 겹쳐 보여 줘서 매번 같은 위치·거리·구도로 찍을 수 있게 합니다.
// HTTP 이거나 카메라 권한이 없으면 null 을 돌려주고, 부르는 쪽에서 휴대폰 카메라 앱(파일 선택)을 씁니다.

import { h, icons } from './ui.js';
import { canvasToBlob } from './image.js';

export const canUseLiveCamera = () => Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);

/**
 * 전체 화면 카메라를 열고, 찍으면 File 을 돌려줍니다. 닫으면 null.
 * ghostUrl: 겹쳐 볼 지난 사진 주소 (없으면 생략)
 */
export async function openLiveCamera({ title = '', ghostUrl = null } = {}) {
  let stream = null;
  let facing = 'environment';
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const start = async () => {
    stop();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
  };
  await start(); // 권한이 없으면 여기서 예외 -> 부르는 쪽에서 파일 선택으로 대신함

  return new Promise((resolve) => {
    const finish = (file) => {
      stop(); cam.remove();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onLeave);
      resolve(file);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    const onLeave = () => finish(null); // 다른 화면으로 가면 카메라를 끕니다
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onLeave);
    const ghost = ghostUrl ? h('img', { class: 'ghost', src: ghostUrl, alt: '' }) : null;
    const finder = h('div', { class: 'viewfinder' }, video, ghost,
      h('span', { html: '<svg class="grid-lines" viewBox="0 0 3 3" preserveAspectRatio="none"><path d="M1 0v3M2 0v3M0 1h3M0 2h3" stroke="rgba(255,255,255,.28)" stroke-width=".01" vector-effect="non-scaling-stroke"/></svg>', style: { display: 'contents' } }),
      h('div', { class: 'hint' }, ghostUrl ? '흐린 지난 사진에 화분을 맞춰 주세요' : '식물 전체와 파란 스티커가 함께 나오게'));
    const slider = ghostUrl ? h('label', { class: 'ghost-slider' }, '겹쳐 보기',
      h('input', {
        type: 'range', min: 0, max: 70, value: 35, 'aria-label': '지난 사진 투명도',
        oninput: (e) => finder.style.setProperty('--ghost', e.target.value / 100),
      })) : null;
    const shoot = async () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await canvasToBlob(c, 0.92);
      finish(new File([blob], 'camera.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
    };
    const cam = h('div', { class: 'camera', role: 'dialog', 'aria-modal': 'true', 'aria-label': '카메라' },
      h('div', { class: 'camera-top' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', html: icons.close, onclick: () => finish(null) }),
        h('div', { class: 'camera-title' }, title),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': '카메라 전환', html: icons.flip,
          onclick: async () => { facing = facing === 'environment' ? 'user' : 'environment'; await start().catch(() => {}); },
        })),
      finder,
      slider,
      h('div', { class: 'camera-bottom' }, h('button', { class: 'shutter', type: 'button', 'aria-label': '촬영', onclick: shoot })));
    document.getElementById('layer').appendChild(cam);
  });
}
