// 사진 준비: 촬영 시각(EXIF) 읽기 + 업로드 전에 크기 줄이기

const MAX_SIDE = 1600;

/** 사진을 긴 변 1600px JPEG 로 줄입니다. (휴대폰 회전 정보는 브라우저가 자동으로 반영) */
export async function prepareImage(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await loadImg(URL.createObjectURL(file));
  }
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return canvasToBlob(canvas);
}

export function canvasToBlob(canvas, quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 변환하지 못했어요.'))), 'image/jpeg', quality);
  });
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('사진을 열 수 없어요.'));
    img.src = src;
  });
}

/** JPEG 의 EXIF 에서 촬영 시각(DateTimeOriginal)을 읽습니다. 없으면 null. */
export async function readExifDate(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xff00) !== 0xff00) return null;
      off += 2 + size;
    }
  } catch { /* EXIF 가 없거나 형식이 달라도 무시 */ }
  return null;
}

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const findTag = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === tag) return e;
    }
    return null;
  };
  const ifd0 = u32(4);
  const exifPtr = findTag(ifd0, 0x8769);
  if (exifPtr === null) return null;
  const exifIfd = u32(exifPtr + 8);
  const dt = findTag(exifIfd, 0x9003) ?? findTag(exifIfd, 0x9004);
  if (dt === null) return null;
  const count = u32(dt + 4);
  const valOff = u32(dt + 8);
  let s = '';
  for (let i = 0; i < Math.min(count, 19); i++) s += String.fromCharCode(v.getUint8(start + valOff + i));
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}
