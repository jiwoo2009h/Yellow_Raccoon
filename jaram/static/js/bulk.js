// 미리 찍어 둔 사진 여러 장을 한꺼번에 올리기 (끌어다 놓기 · 여러 장 고르기)
// - 3D 측정: 파일 이름과 촬영 시각으로 방향(0°·90°·180°·270°·위)을 자동으로 정하고, 사용자가 고칠 수 있어요.
// - 정면 사진: 촬영 시각(EXIF, 없으면 파일 수정 시각) 순서로 각각 기록해요.

import { h, sheet, toLocalInput, dateTime, toggleChips } from './ui.js';
import { readExifDate } from './image.js';

const isImage = (f) => (f.type ? f.type.startsWith('image/') : /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name || ''));

/** 사진 파일 정보: 촬영 시각(EXIF → 파일 수정 시각), 미리보기 주소 */
export async function photoInfos(files) {
  const list = [...files].filter(isImage);
  const out = await Promise.all(list.map(async (file) => {
    const exif = await readExifDate(file);
    const time = exif ? new Date(exif) : new Date(file.lastModified || Date.now());
    return { file, name: file.name || '사진', exif, time, takenAt: exif || toLocalInput(time), url: URL.createObjectURL(file) };
  }));
  return out.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
}

export function releaseInfos(infos) {
  infos.forEach((i) => URL.revokeObjectURL(i.url));
}

/**
 * 화면(target)에 사진을 끌어다 놓으면 onFiles(FileList) 를 불러요. 끌고 있는 동안 .is-dragover 표시.
 * 돌려준 함수를 부르면 해제돼요.
 */
export function dropZone(target, onFiles) {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const enter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth += 1; target.classList.add('is-dragover'); };
  const over = (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const leave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) target.classList.remove('is-dragover'); };
  const drop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    target.classList.remove('is-dragover');
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  };
  target.addEventListener('dragenter', enter);
  target.addEventListener('dragover', over);
  target.addEventListener('dragleave', leave);
  target.addEventListener('drop', drop);
  return () => {
    target.removeEventListener('dragenter', enter);
    target.removeEventListener('dragover', over);
    target.removeEventListener('dragleave', leave);
    target.removeEventListener('drop', drop);
  };
}

// ------------------------------------------------------------ 3D 측정 방향 자동 판단
export const SCAN_KEYS = [['a0', '0°'], ['a90', '90°'], ['a180', '180°'], ['a270', '270°'], ['top', '위'], ['skip', '빼기']];
const SIDE_ORDER = ['a0', 'a90', 'a180', 'a270'];
// 파일 이름 단서 (실험 사진 이름: 측.jpg = 고정 위치 측면, 항.jpg·항공.jpg = 위에서 찍은 사진)
const NAME_HINTS = [
  [/(^|[^가-힣])(항공|항|위|탑)([^가-힣]|$)|top|above|overhead|aerial/i, 'top'],
  [/(^|[^가-힣])(측|정면|앞)([^가-힣]|$)|front|(^|[^0-9])0(도|deg|°)/i, 'a0'],
  [/(^|[^가-힣])(오른|우측|우)([^가-힣]|$)|right|90(도|deg|°)/i, 'a90'],
  [/(^|[^가-힣])(뒤|후면|반대)([^가-힣]|$)|back|rear|180(도|deg|°)/i, 'a180'],
  [/(^|[^가-힣])(왼|좌측|좌)([^가-힣]|$)|left|270(도|deg|°)/i, 'a270'],
];

/** 이름 단서 → 촬영 시각 순서로 빈 방향(0→90→180→270)을 채워요. 남으면 '위', 그다음은 '빼기'. */
export function guessScanKeys(infos) {
  const keys = new Array(infos.length).fill(null);
  const used = new Set();
  infos.forEach((info, i) => {
    const base = info.name.replace(/\.[^.]+$/, '');
    for (const [re, key] of NAME_HINTS) {
      if (re.test(base) && !used.has(key)) { keys[i] = key; used.add(key); break; }
    }
  });
  const free = [...SIDE_ORDER, 'top'].filter((k) => !used.has(k));
  infos.forEach((_, i) => { // infos 는 촬영 시각 순서
    if (keys[i]) return;
    keys[i] = free.shift() || 'skip';
  });
  return keys;
}

/**
 * 방향 확인 시트. 고른 결과 [{ info, key }] (빼기 제외) 를 돌려줘요. 취소하면 null.
 * existing: 이미 찍어 둔 방향들 (바꾸게 된다고 알려 줘요)
 */
export function scanAssignSheet(infos, existing = new Set()) {
  return new Promise((resolve) => {
    const keys = guessScanKeys(infos);
    let result = null;
    const rows = [];
    const refresh = () => rows.forEach((r, i) => r.setKey(keys[i]));
    sheet((close) => {
      const list = h('div', { class: 'assign-list' }, infos.map((info, i) => {
        const note = h('div', { class: 'meta' });
        const setNote = () => {
          note.textContent = `${info.exif ? '촬영' : '파일'} ${dateTime(info.time)}${existing.has(keys[i]) ? ' · 지금 사진을 바꿔요' : ''}`;
        };
        let chipsEl = null;
        const row = h('div', { class: 'assign-row' },
          h('img', { class: 'assign-thumb', src: info.url, alt: '' }),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, info.name), note));
        const mount = () => {
          const next = toggleChips(SCAN_KEYS, keys[i], (v) => {
            const prev = keys[i];
            const want = v || 'skip';
            // 같은 방향을 다른 사진이 쓰고 있으면 서로 바꿔요
            const j = keys.findIndex((k, idx) => idx !== i && k === want && want !== 'skip');
            if (j >= 0) keys[j] = prev;
            keys[i] = want;
            refresh();
          }, 'chips in-card wrap assign-chips');
          if (chipsEl) chipsEl.replaceWith(next); else row.append(next);
          chipsEl = next;
          setNote();
        };
        row.setKey = () => mount();
        mount();
        rows.push(row);
        return row;
      }));
      const ok = h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          result = infos.map((info, i) => ({ info, key: keys[i] })).filter((x) => x.key !== 'skip');
          await close();
        },
      }, '올리기');
      return [
        h('h2', { class: 'sheet-title' }, '사진 방향을 확인해 주세요'),
        h('p', { class: 'sheet-desc' }, '파일 이름(측·항공 등)과 촬영 시각 순서로 자동으로 정했어요. 틀리면 눌러서 바꿔 주세요. 같은 방향을 고르면 서로 바뀌어요.'),
        list,
        h('div', { class: 'actions' }, ok),
      ];
    }, { onClose: () => resolve(result) });
  });
}
