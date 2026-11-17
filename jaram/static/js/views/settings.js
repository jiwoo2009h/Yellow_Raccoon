import { api } from '../api.js';
import {
  h, icons, topbar, segmented, field, numberInput, toast, confirmSheet, fmt, formValues, skeleton, sheet, dateShort,
  withBusy, checkNumbers, markInvalid, progressSheet, friendlyError,
} from '../ui.js';
import { getTheme, setTheme } from '../theme.js';

const row = ({ href, icon, title, meta, onClick, accent }) => h(href ? 'a' : 'button', {
  class: 'list-item', href, type: href ? null : 'button', onclick: onClick,
},
h('div', { class: 'list-icon' + (accent ? ' accent' : ''), html: icons[icon] }),
h('div', { class: 'grow' }, h('div', { class: 'title' }, title), meta ? h('div', { class: 'meta' }, meta) : null),
h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } }));

// ------------------------------------------------------------ 계정 (계정 모드에서만)
function passwordSheet() {
  sheet((close) => {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, placeholder: '6자 이상' });
    const next2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, '바꾸기');
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (next.value !== next2.value) { markInvalid(next2, '새 비밀번호 두 칸이 서로 달라요'); next2.focus(); return; }
        withBusy(btn, async () => {
          await api.changePassword(cur.value, next.value);
          toast('비밀번호를 바꿨어요');
          await close();
        });
      },
    },
    h('h2', { class: 'sheet-title' }, '비밀번호 바꾸기'),
    field('지금 비밀번호', cur),
    h('div', { class: 'field-gap' }),
    field('새 비밀번호', next),
    h('div', { class: 'field-gap' }),
    field('새 비밀번호 확인', next2),
    h('div', { class: 'actions' }, btn));
    return form;
  });
}

async function membersSheet(me) {
  let data;
  try {
    data = await api.users();
  } catch (err) {
    toast(friendlyError(err), { error: true });
    return;
  }
  sheet(() => [
    h('h2', { class: 'sheet-title' }, '팀원 관리'),
    h('p', { class: 'sheet-desc' }, '팀원이 비밀번호를 잊으면 임시 비밀번호를 만들어 알려 주세요. 로그인한 뒤 설정에서 바꾸면 돼요.'),
    h('div', { class: 'list', style: { margin: '0 -20px', background: 'transparent' } }, data.users.map((u) => h('div', { class: 'list-item' },
      h('div', { class: 'list-icon' + (u.is_admin ? ' accent' : ''), html: icons.sprout }),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, u.username, u.id === me.id ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, '나') : null),
        h('div', { class: 'meta' }, `${u.is_admin ? '관리자' : '팀원'} · 식물 ${u.plants}개 · ${dateShort(u.created_at)} 가입`)),
      u.id === me.id ? null : h('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: async () => {
          const ok = await confirmSheet({ title: `${u.username}의 비밀번호를 초기화할까요?`, desc: '지금 비밀번호는 더 이상 쓸 수 없고, 새 임시 비밀번호를 한 번만 보여 드려요.', ok: '초기화' });
          if (!ok) return;
          try {
            const r = await api.resetUser(u.id);
            sheet((close) => [
              h('h2', { class: 'sheet-title' }, '임시 비밀번호'),
              h('p', { class: 'sheet-desc' }, `${r.username}에게 알려 주세요. 이 창을 닫으면 다시 볼 수 없어요.`),
              h('div', { class: 'temp-password', 'aria-label': '임시 비밀번호' }, r.temp_password),
              h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close() }, '확인')),
            ]);
          } catch (err) {
            toast(friendlyError(err), { error: true });
          }
        },
      }, '비밀번호 초기화')))),
  ]);
}

// ------------------------------------------------------------ 설정 홈
export async function settingsView() {
  const screen = document.getElementById('screen');
  const head = h('div', { class: 'page-head' }, h('h1', { class: 'large-title' }, '설정'));
  screen.append(head, skeleton(80, 16), skeleton(200));
  const [{ thresholds }, auth] = await Promise.all([api.settings(), api.auth()]);
  const sp = thresholds.species;
  const desc = (t) => `온도 ${fmt(t.temp_min)}–${fmt(t.temp_max)}℃ · 토양 ${fmt(t.soil_min, 0)}% 이상 · 조도 ${fmt(t.lux_min, 0)} lux 이상`;

  const me = auth.required ? auth.user : null;
  const logout = async () => {
    const ok = await confirmSheet({ title: '로그아웃할까요?', desc: '다시 들어오려면 아이디와 비밀번호가 필요해요.', ok: '로그아웃' });
    if (!ok) return;
    try {
      await api.logout();
      window.dispatchEvent(new CustomEvent('jaram:login-required'));
    } catch (err) { toast(friendlyError(err), { error: true }); }
  };

  screen.replaceChildren(head,
    ...(me ? [
      h('h2', { class: 'section-title' }, '계정'),
      h('div', { class: 'list' },
        h('div', { class: 'list-item' },
          h('div', { class: 'list-icon accent', html: icons.sprout }),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, me.username),
            h('div', { class: 'meta' }, me.is_admin ? '관리자 · 내 식물만 보여요' : '내 식물만 보여요'))),
        row({ icon: 'note', title: '비밀번호 바꾸기', onClick: passwordSheet }),
        me.is_admin ? row({ icon: 'settings', title: '팀원 관리', meta: '가입한 사람 보기 · 비밀번호 초기화', onClick: () => membersSheet(me) }) : null,
        row({ icon: 'close', title: '로그아웃', onClick: logout })),
    ] : []),
    h('h2', { class: 'section-title' }, '화면'),
    h('section', { class: 'card' },
      h('div', { class: 'field-label' }, '테마'),
      segmented([['system', '시스템'], ['light', '라이트'], ['dark', '다크']], getTheme(), (v) => setTheme(v))),
    h('h2', { class: 'section-title' }, '추천 기준'),
    h('p', { class: 'caption', style: { margin: '-4px 4px 12px' } }, me ? '실험에서 모은 데이터를 보고 숫자를 조정하세요. 바꾸면 내 식물의 추천에 바로 반영돼요. (팀원마다 따로 저장돼요)' : '실험에서 모은 데이터를 보고 숫자를 조정하세요. 바꾸면 모든 식물의 추천에 바로 반영돼요.'),
    h('div', { class: 'list' },
      row({ href: '#/settings/species/basil', icon: 'leaf', accent: true, title: '바질', meta: desc(sp.basil) }),
      row({ href: '#/settings/species/lettuce', icon: 'sprout', accent: true, title: '상추', meta: desc(sp.lettuce) }),
      row({ href: '#/settings/species/other', icon: 'sprout', title: '기타 식물', meta: desc(sp.other) }),
      row({ href: '#/settings/general', icon: 'sliders', title: '공통 판단 기준', meta: `생장률 계산 간격 ${thresholds.general.rate_window}회 · 환경 지속 ${thresholds.general.persist_count}/${thresholds.general.env_lookback}회 · 3D ${thresholds.general.scan_max_age_days}일 · 특이사항 ${thresholds.general.sign_max_age_days}일` }),
      row({ href: '#/settings/rules', icon: 'note', title: '추천 규칙 고치기', meta: '어떤 조건에서 어떤 추천을 낼지 글로 고쳐요 (rules.md)' })),
    h('h2', { class: 'section-title' }, '데이터'),
    h('div', { class: 'list' },
      h('a', { class: 'list-item', href: '/api/export.csv', download: '' },
        h('div', { class: 'list-icon', html: icons.download }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, 'CSV로 내보내기'), h('div', { class: 'meta' }, me ? '내 식물의 측정·환경·관리 기록' : '모든 측정·환경·관리 기록'))),
      !auth.required || me?.is_admin ? h('a', { class: 'list-item', href: api.backupUrl, download: '' },
        h('div', { class: 'list-icon', html: icons.download }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, '전체 백업 받기'), h('div', { class: 'meta' }, me ? '관리자 전용 · 모든 팀원의 DB와 사진을 zip 하나로' : 'DB와 모든 사진을 zip 파일 하나로'))) : null,
      row({
        icon: 'refresh', title: '모든 사진 다시 분석', meta: '색상 범위를 바꿨거나 인식 방식이 개선됐을 때',
        onClick: async (e) => {
          const btn = e.currentTarget;
          if (btn.dataset.busy) return;
          btn.dataset.busy = '1';
          try {
            const ok = await confirmSheet({ title: '모든 사진을 다시 분석할까요?', desc: '지금 설정된 색상 범위와 새 인식 방식으로 높이·폭·면적을 다시 계산해요. 사진이 많으면 시간이 걸릴 수 있어요.', ok: '다시 분석' });
            if (!ok) return;
            const prog = progressSheet('다시 분석하는 중이에요', '모든 식물의 사진을 다시 계산해요. 화면을 닫지 말고 기다려 주세요.');
            try {
              const r = await api.reanalyze();
              toast(`${r.ok}장을 다시 분석했어요${r.failed ? ` (${r.failed}장 실패)` : ''}`);
            } catch (err) {
              toast(friendlyError(err), { error: true });
            } finally {
              prog.close();
            }
          } finally {
            delete btn.dataset.busy;
          }
        },
      })),
    h('h2', { class: 'section-title' }, '정보'),
    h('div', { class: 'list' },
      row({ href: '#/settings/algorithm', icon: 'book', title: '추천 알고리즘 살펴보기', meta: '상태 판단 규칙과 생장률 계산 방법' }),
      null),
    h('p', { class: 'footer-note' }, '자람 v1.0 · 컴퓨터 비전 기반 식물 생육 분석 및 맞춤형 관리 추천 시스템', h('br'), '2026 과학과제연구 · 바티칸 시국'));
}

// ------------------------------------------------------------ 종류별 기준
const SECTIONS = [
  ['환경 기준', '온도·습도·토양 수분이 이 범위를 벗어나면 환경 문제로 판단해요.', [
    ['temp', '온도', '℃'],
    ['humidity', '습도', '%'],
    ['soil', '토양 수분', '%'],
    ['lux_min', '조도 최솟값', 'lux', '이보다 어두운 기록이 이어지면 빛 부족 가능성을 확인해요.'],
  ]],
  ['생장 판단', '사진으로 계산한 투영 면적의 변화로 생장 상태를 판단해요.', [
    ['slowdown_ratio', '생장 둔화 기준', '%', '최근 생장률이 이전보다 이만큼 줄면 "생장 둔화"'],
    ['stagnation_rate', '정체 기준', '%/일', '면적 생장률이 하루 이 값보다 낮으면 "정체"'],
    ['drop_alert', '급감 경고', '%', '한 번에 면적이 이만큼 줄면 시듦·촬영 오류를 확인하라고 알려요'],
  ]],
  ['잎 색·모양 판단', '조명 색을 맞춘 사진에서 잎 안쪽 색만 재요. 최근 사진 2장이 모두 약 일주일 전 사진(가장 오래된 3장)보다 이만큼 바뀌어야 "변함"으로 봐요.', [
    ['leaf_hue_drop', '노란 쪽으로 변함', '°', '잎 색상각이 이만큼 낮아지면 (실제 사진에서 같은 잎도 약 ±2° 흔들려요)'],
    ['yellow_rise', '노란 잎 늘어남', '%p', '노란 쪽 잎 픽셀 비율이 이만큼 늘면'],
    ['pale_drop', '잎 색이 옅어짐', '%', '잎 색의 진하기(채도)가 이 비율 이상 줄면'],
    ['stretch_rise', '위로 길쭉해짐', '%', '모양 지수(높이 ÷ √면적)가 이 비율 이상 커지면 웃자람·꽃대를 확인하라고 알려요'],
  ]],
  ['급수 판단', '급수 기록표(날짜·양·물 주기 전 흙 상태)로 물 부족과 과습을 판단해요. 정해진 날짜보다 흙 상태를 먼저 봐요.', [
    ['water_interval_days', '물주기 확인 간격', '일', '흙 상태 기록이 없을 때, 물 준 지 이만큼 지나면 흙을 만져 보라고 알려요. 급수 기록표에 "확인"으로 표시돼요'],
    ['water_frequent_days', '"물을 자주 줌" 기준', '일', '최근 급수 간격의 중앙값이 이보다 짧으면 과습 위험으로 봐요. 물주기 확인 간격보다 짧아야 해요'],
  ]],
  ['3D 생장 판단', '최근 3D 측정이 2번 이상 있으면 부피 변화로 생장을 먼저 판단하고, 정면 사진은 보조 근거로 써요.', [
    ['volume_slowdown_ratio', '부피 둔화 기준', '%', '최근 3D 구간의 부피 생장률이 그 전 구간보다 이만큼 줄면 "생장 둔화"'],
    ['volume_stagnation_rate', '부피 정체 기준', '%/일', '부피 생장률이 하루 이 값보다 낮으면 "정체". 모양이 그대로 커지면 부피는 면적보다 약 1.5배 빠르게 늘어요'],
  ]],
];

export async function speciesSettingsView({ key }) {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '' }), skeleton(90, 8), skeleton(320, 24));
  const { thresholds, defaults } = await api.settings();
  const t = thresholds.species[key];
  if (!t) { location.replace('#/settings'); return; }

  const rangeRow = (base, unit) => h('div', { class: 'range-row' },
    numberInput({ name: `${base}_min`, unit, value: t[`${base}_min`] }),
    h('span', { class: 'sep' }, '~'),
    numberInput({ name: `${base}_max`, unit, value: t[`${base}_max`] }));

  const hsvBox = h('div');
  const hsvPreview = h('div', { class: 'hsv-bar', 'aria-hidden': 'true' });
  const drawHsv = () => {
    const v = formValues(form);
    const lo = v.h_min ?? 0;
    const hi = v.h_max ?? 179;
    // OpenCV Hue(0~179)는 일반 색상환(0~359)의 절반 값
    hsvPreview.style.background = 'linear-gradient(90deg,' + Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 80% 50%)`).join(',') + ')';
    hsvPreview.replaceChildren(h('div', { class: 'sel', style: { left: `${(lo / 180) * 100}%`, width: `${((hi - lo) / 180) * 100}%` } }));
  };
  hsvBox.append(
    h('div', { class: 'field-label' }, '색상 H (0~179)'),
    h('div', { class: 'range-row' }, numberInput({ name: 'h_min', value: t.hsv_lower[0] }), h('span', { class: 'sep' }, '~'), numberInput({ name: 'h_max', value: t.hsv_upper[0] })),
    hsvPreview,
    h('div', { style: { height: '16px' } }),
    h('div', { class: 'field-label' }, '채도 S (0~255)'),
    h('div', { class: 'range-row' }, numberInput({ name: 's_min', value: t.hsv_lower[1] }), h('span', { class: 'sep' }, '~'), numberInput({ name: 's_max', value: t.hsv_upper[1] })),
    h('div', { style: { height: '16px' } }),
    h('div', { class: 'field-label' }, '명도 V (0~255)'),
    h('div', { class: 'range-row' }, numberInput({ name: 'v_min', value: t.hsv_lower[2] }), h('span', { class: 'sep' }, '~'), numberInput({ name: 'v_max', value: t.hsv_upper[2] })));

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, '저장하기');
  const form = h('form', {
    oninput: drawHsv,
    onsubmit: (e) => { e.preventDefault(); save(); },
  },
  h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
    h('h1', { class: 'large-title' }, `${t.label} 기준`),
    h('p', { class: 'subtitle' }, '관리 추천 알고리즘이 쓰는 임계값이에요.'))),
  h('button', { class: 'list-item suggest-entry', type: 'button', onclick: () => suggestSheet(key, t.label, form) },
    h('div', { class: 'list-icon accent', html: icons.chart }),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, '실험 데이터로 기준 제안받기'),
      h('div', { class: 'meta' }, '모은 기록의 통계로 제안값과 근거를 보여 줘요')),
    h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } })),
  SECTIONS.map(([title, desc, items]) => [
    h('h2', { class: 'section-title' }, title),
    h('section', { class: 'card' },
      h('p', { class: 'card-sub', style: { marginBottom: '16px' } }, desc),
      items.map(([k, label, unit, hint], i) => h('div', { style: { marginTop: i ? '18px' : 0 } },
        ['temp', 'humidity', 'soil'].includes(k)
          ? h('div', null, h('div', { class: 'field-label' }, `${label} 범위`), rangeRow(k, unit))
          : field(label, numberInput({ name: k, unit, value: t[k] }), hint)))),
  ]),
  h('h2', { class: 'section-title' }, '식물 영역 색상 (HSV)'),
  h('section', { class: 'card' },
    h('p', { class: 'card-sub', style: { marginBottom: '16px' } }, '사진에서 이 범위의 색을 식물로 인식해요. 잎이 잘 잡히지 않으면 범위를 넓히고, 배경이 섞이면 좁혀 보세요.'),
    hsvBox),
  h('button', { class: 'btn btn-text', type: 'button', style: { margin: '20px auto 0', display: 'flex' }, onclick: resetSpecies }, '기본값으로 되돌리기'),
  h('div', { class: 'cta' }, saveBtn));

  function collect(v) {
    const next = structuredClone(thresholds);
    const s = next.species[key];
    for (const k of Object.keys(s)) {
      if (k in v && v[k] !== null) s[k] = v[k];
    }
    s.hsv_lower = [v.h_min, v.s_min, v.v_min].map((x, i) => x ?? t.hsv_lower[i]);
    s.hsv_upper = [v.h_max, v.s_max, v.v_max].map((x, i) => x ?? t.hsv_upper[i]);
    return next;
  }

  /** 저장 전에 칸 옆에 바로 알려 주는 검사: 빈 칸, 최솟값 ≥ 최댓값, HSV 범위 */
  function validate() {
    if (!checkNumbers(form)) return false;
    const input = (name) => form.querySelector(`input[name="${name}"]`);
    const v = formValues(form);
    let first = null;
    const bad = (name, msg) => { const el = input(name); if (el) { markInvalid(el, msg); first = first || el; } };
    form.querySelectorAll('input[type="number"]').forEach((el) => { if (v[el.name] === null) bad(el.name, '값을 입력해 주세요'); });
    [['temp', '온도'], ['humidity', '습도'], ['soil', '토양 수분']].forEach(([k, label]) => {
      const lo = v[`${k}_min`];
      const hi = v[`${k}_max`];
      if (lo !== null && hi !== null && lo >= hi) bad(`${k}_max`, `${label} 최댓값은 최솟값(${fmt(lo)})보다 커야 해요`);
    });
    [['h', 179, '색상 H'], ['s', 255, '채도 S'], ['v', 255, '명도 V']].forEach(([c, max, label]) => {
      const lo = v[`${c}_min`];
      const hi = v[`${c}_max`];
      [[`${c}_min`, lo], [`${c}_max`, hi]].forEach(([name, x]) => {
        if (x !== null && (x < 0 || x > max)) bad(name, `${label}는 0~${max} 사이로 입력해 주세요`);
      });
      if (lo !== null && hi !== null && lo >= hi) bad(`${c}_max`, `${label} 최댓값은 최솟값보다 커야 해요`);
    });
    [['slowdown_ratio', '생장 둔화 기준'], ['volume_slowdown_ratio', '부피 둔화 기준']].forEach(([k, label]) => {
      if (v[k] !== null && (v[k] <= 0 || v[k] >= 100)) bad(k, `${label}은 0보다 크고 100보다 작아야 해요`);
    });
    if (v.water_frequent_days !== null && v.water_interval_days !== null
        && (v.water_frequent_days <= 0 || v.water_frequent_days >= v.water_interval_days)) {
      bad('water_frequent_days', `0보다 크고 물주기 확인 간격(${fmt(v.water_interval_days)}일)보다 짧아야 해요`);
    }
    if (first) {
      first.focus();
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast('빨간색으로 표시된 칸을 확인해 주세요', { error: true });
      return false;
    }
    return true;
  }

  async function save(next) {
    if (!next && !validate()) return;
    const before = JSON.stringify([t.hsv_lower, t.hsv_upper]);
    let hsvChanged = false;
    const saved = await withBusy(saveBtn, async () => {
      const res = await api.saveSettings(next || collect(formValues(form)));
      const after = res.thresholds.species[key];
      hsvChanged = JSON.stringify([after.hsv_lower, after.hsv_upper]) !== before;
      toast('기준을 저장했어요');
      return true;
    });
    if (!saved) return;
    if (hsvChanged) {
      const ok = await confirmSheet({ title: '사진을 다시 분석할까요?', desc: `색상 범위가 바뀌었어요. ${t.label} 사진들을 새 범위로 다시 분석하면 그래프와 추천도 함께 바뀌어요.`, ok: '다시 분석' });
      if (ok) {
        const prog = progressSheet('다시 분석하는 중이에요', `${t.label} 사진을 새 색상 범위로 계산해요.`);
        try {
          const { plants } = await api.plants();
          let n = 0;
          for (const p of plants.filter((x) => x.species === key)) n += (await api.reanalyze(p.id)).ok;
          toast(`${n}장을 다시 분석했어요`);
        } catch (err) {
          toast(friendlyError(err), { error: true });
        } finally {
          prog.close();
        }
      }
    }
    if (screen.isConnected) location.hash = '#/settings';
  }

  async function resetSpecies() {
    const ok = await confirmSheet({ title: `${t.label} 기준을 기본값으로 되돌릴까요?`, ok: '되돌리기' });
    if (!ok) return;
    const next = structuredClone(thresholds);
    next.species[key] = structuredClone(defaults.species[key]);
    await save(next);
  }

  screen.replaceChildren(topbar({ title: '' }), form);
  drawHsv();
}

// ------------------------------------------------------------ 기준값 제안
const SUGGEST_DIGITS = { lux_min: 0, temp_min: 1, temp_max: 1, stagnation_rate: 1, volume_stagnation_rate: 1 };

function suggestSheet(species, label, form) {
  const from = h('input', { class: 'input', type: 'date', name: 'from', 'aria-label': '시작 날짜' });
  const to = h('input', { class: 'input', type: 'date', name: 'to', 'aria-label': '끝 날짜' });
  const body = h('div', { class: 'suggest-body' }, h('div', { class: 'spinner small', style: { margin: '24px auto' } }));
  let data = null;
  const checks = new Map();

  const value = (it, v) => `${fmt(v, SUGGEST_DIGITS[it.key] ?? 0)}${it.unit === 'lux' ? ' lux' : it.unit}`;

  function itemRow(it) {
    const can = it.suggested !== null && it.changed;
    const box = can ? h('input', { type: 'checkbox', checked: true, 'aria-label': `${it.label} 제안값 적용` }) : null;
    if (box) checks.set(it.key, box);
    return h('label', { class: `suggest-item${can ? '' : ' none'}` },
      box || h('span', { class: 'suggest-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'grow' },
        h('div', { class: 'suggest-head' },
          h('span', { class: 'title' }, it.label),
          h('span', { class: 'vals' },
            value(it, it.current),
            it.suggested !== null ? [h('span', { class: 'arrow' }, '→'), h('b', null, value(it, it.suggested))] : null)),
        it.suggested !== null
          ? [h('div', { class: 'method' }, it.changed ? it.method : '제안값이 지금 기준과 같아요'), h('div', { class: 'basis' }, it.basis)]
          : [h('div', { class: 'method' }, it.missing), it.basis ? h('div', { class: 'basis' }, it.basis) : null]));
  }

  async function load() {
    checks.clear();
    body.replaceChildren(h('div', { class: 'spinner small', style: { margin: '24px auto' } }));
    try {
      data = await api.suggest(species, from.value, to.value);
    } catch (err) {
      body.replaceChildren(h('div', { class: 'notice warn' }, h('span', { html: icons.warn, style: { display: 'contents' } }), h('div', { class: 'grow' }, friendlyError(err))));
      return;
    }
    const s = data.summary;
    body.replaceChildren(
      h('p', { class: 'caption', style: { margin: '0 2px 10px' } },
        s.plants.length ? `${s.plants.join('·')} · 생장 구간 ${s.intervals}개 · 3D 구간 ${s.scan_intervals}개${s.first ? ` · ${dateShort(s.first)}–${dateShort(s.last)}` : ''}`
          : `${label} 식물이 아직 없어요.`),
      h('div', { class: 'suggest-list' }, data.items.map(itemRow)));
    apply.disabled = checks.size === 0;
  }

  const apply = h('button', { class: 'btn btn-primary', disabled: true }, '고른 값 입력칸에 넣기');
  sheet((close) => {
    apply.onclick = async () => {
      let n = 0;
      for (const it of data.items) {
        const box = checks.get(it.key);
        if (!box || !box.checked) continue;
        const input = form.querySelector(`input[name="${it.key}"]`);
        if (!input) continue;
        input.value = String(it.suggested);
        input.closest('.input-wrap')?.classList.add('just-filled');
        n += 1;
      }
      await close();
      toast(n ? `${n}개 항목을 채웠어요. 확인하고 저장해 주세요` : '고른 항목이 없어요');
    };
    return [
      h('h2', { class: 'sheet-title' }, `${label} 기준 제안`),
      h('p', { class: 'sheet-desc' }, '모은 기록으로 통계를 내서 기준을 제안해요. 고른 값은 입력칸에만 채워지고, 저장하기를 눌러야 반영돼요.'),
      h('div', { class: 'field-label' }, '기초 데이터 기간 (비우면 전체)'),
      h('div', { class: 'range-row' }, from, h('span', { class: 'sep' }, '~'), to),
      h('button', { class: 'btn btn-soft btn-sm', type: 'button', style: { marginTop: '10px' }, onclick: load }, '이 기간으로 다시 계산'),
      h('div', { style: { height: '16px' } }),
      body,
      h('p', { class: 'caption', style: { margin: '12px 2px 0' } }, '식물이 클수록 % 생장률은 자연히 낮아져요. 지금 생장 단계와 비슷한 기간을 고르면 더 알맞은 값이 나와요.'),
      h('div', { class: 'actions' }, apply),
    ];
  });
  load();
}

// ------------------------------------------------------------ 공통 기준
export async function generalSettingsView() {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '' }), skeleton(90, 8), skeleton(320, 24));
  const { thresholds } = await api.settings();
  const g = thresholds.general;
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, '저장하기');
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      if (!checkNumbers(form)) return;
      const v = formValues(form);
      let first = null;
      form.querySelectorAll('input[type="number"]').forEach((el) => {
        const x = v[el.name];
        const min = Number(el.min || 1);
        const max = Number(el.max || 60);
        const msg = x === null ? '값을 입력해 주세요' : !Number.isInteger(x) ? '정수로 입력해 주세요' : x < min || x > max ? `${min}~${max} 사이로 입력해 주세요` : null;
        if (msg) { markInvalid(el, msg); first = first || el; }
      });
      if (v.persist_count !== null && v.env_lookback !== null && v.persist_count > v.env_lookback) {
        const el = form.querySelector('input[name="persist_count"]');
        markInvalid(el, '"지속" 횟수는 환경을 볼 기록 수보다 클 수 없어요');
        first = first || el;
      }
      if (first) { first.focus(); return; }
      const next = structuredClone(thresholds);
      Object.assign(next.general, v);
      withBusy(saveBtn, async () => {
        await api.saveSettings(next);
        toast('기준을 저장했어요');
        if (screen.isConnected) location.hash = '#/settings';
      });
    },
  },
  h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
    h('h1', { class: 'large-title' }, '공통 판단 기준'),
    h('p', { class: 'subtitle' }, '모든 식물에 똑같이 적용돼요.'))),
  h('section', { class: 'card', style: { marginTop: '16px' } },
    field('생장률 계산 간격', numberInput({ name: 'rate_window', unit: '회', value: g.rate_window, step: 1, min: 1, max: 10 }),
      '최근 몇 번의 측정 구간을 묶어 생장률을 계산할지 정해요. 2이면 최근 사진 3장의 처음과 끝을 비교해요. 크게 할수록 측정 오차에 덜 흔들려요.'),
    h('div', { style: { height: '18px' } }),
    field('환경을 볼 기록 수', numberInput({ name: 'env_lookback', unit: '회', value: g.env_lookback, step: 1, min: 1, max: 10 }),
      '최근 몇 번의 환경 기록을 함께 볼지 정해요.'),
    h('div', { style: { height: '18px' } }),
    field('"지속"으로 볼 횟수', numberInput({ name: 'persist_count', unit: '회', value: g.persist_count, step: 1, min: 1, max: 10 }),
      '그중 몇 번 이상 기준을 벗어나야 "계속 벗어남"으로 판단할지 정해요. 센서 값이 한 번 튀어서 잘못 추천하는 것을 막아요.'),
    h('div', { style: { height: '18px' } }),
    field('3D 측정을 쓸 기간', numberInput({ name: 'scan_max_age_days', unit: '일', value: g.scan_max_age_days, step: 1, min: 1, max: 60 }),
      '마지막 3D 측정이 이 기간 안에 있을 때만 부피 생장률로 판단해요. 오래된 3D 측정은 쓰지 않고 정면 사진으로 판단해요.'),
    h('div', { style: { height: '18px' } }),
    field('특이사항을 볼 기간', numberInput({ name: 'sign_max_age_days', unit: '일', value: g.sign_max_age_days, step: 1, min: 1, max: 14 }),
      '시듦·웃자람 같은 식물 상태 기록을 며칠 동안 "지금 상태"로 보고 추천에 쓸지 정해요.'),
    h('div', { style: { height: '18px' } }),
    field('양분 부족을 확인할 기간', numberInput({ name: 'nutrient_check_days', unit: '일', value: g.nutrient_check_days, step: 1, min: 7, max: 90 }),
      '잎이 노래지거나 옅어졌는데 이 기간 동안 비료를 준 기록이 없으면(기록 2주 이상) 양분 부족도 확인하라고 알려요.')),
  h('div', { class: 'cta' }, saveBtn));
  screen.replaceChildren(topbar({ title: '' }), form);
}

// ------------------------------------------------------------ 알고리즘 설명
export async function algorithmView() {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '' }), skeleton(90, 8), skeleton(320, 24));
  const { thresholds } = await api.settings();
  const g = thresholds.general;
  const b = thresholds.species.basil;
  const l = thresholds.species.lettuce;
  const both = (k, unit = '', d = 0) => `바질 ${fmt(b[k], d)}${unit} / 상추 ${fmt(l[k], d)}${unit}`;
  const flow = ['사진 입력', '영상 분석', '3D 측정(선택)', '급수 기록', '식물 상태', '환경 데이터', '생장률 계산', '조건 비교', '상태 판단', '관리 추천'];
  const rules = [
    [`흙이 말랐음(만져 보기 또는 토양 수분 < ${both('soil_min', '%')})  그리고  생장 감소 또는 시듦`, '수분 부족 가능성 → 흙 전체가 젖도록 물주기', 'care'],
    ['흙은 마르지만 잘 자라는 중', '바로 판단하지 않고 관찰', 'observe'],
    [`흙이 계속 젖어 있음·급수 간격 < ${both('water_frequent_days', '일', 1)}·젖은 흙에 또 급수  그리고  생장 감소·시듦·잎이 노래짐`, '과습 가능성 → 간격 늘리기, 받침 물 버리기, 배수 확인', 'care'],
    ['물을 자주 주지만 잘 자라는 중', '흙 표면이 마른 걸 확인하고 주기', 'observe'],
    ['시들었는데 흙이 마르지 않음(방금 물을 줌·촉촉함·젖어 있음)', '물 부족이 아닐 수 있음 → 과습·뿌리·고온 확인', 'care'],
    [`흙 상태를 모르고 마지막 급수 후 ${both('water_interval_days', '일')} 지남`, '흙을 만져 보고 말랐으면 물주기', 'observe'],
    [`웃자람(줄기만 길게)  또는  조도 < ${both('lux_min', ' lux')} 가 지속  그리고  생장 감소`, '빛 부족 가능성 → 위치·조명 확인', 'care'],
    ['온도·습도가 범위 밖으로 지속  그리고  생장 감소', '환경 조건 확인 필요', 'care'],
    ['상추 꽃대  그리고  고온 지속', '서늘한 곳(15~20℃)으로, 꽃대 자르기', 'care'],
    ['벌레·곰팡이·반점', '통풍, 잎 겹침 정리, 상한 잎 제거', 'care'],
    ['잎 끝이 마름 / 잎이 빽빽하게 겹침', '습도·급수 확인 / 솎아 주기', 'observe'],
    [`한 번에 투영 면적이 ${fmt(b.drop_alert, 0)}% 이상 감소`, '시듦 또는 촬영 오류 확인', 'observe'],
    [`잎이 노래짐  또는  사진의 잎 색상각이 약 일주일 전보다 ${fmt(b.leaf_hue_drop, 0)}° 이상 낮아짐·노란 잎 +${fmt(b.yellow_rise, 0)}%p (최근 2장 모두)`, '과습·빛·물 부족 추천이 있으면 그 근거로. 아니면 추위 → 비료 효과 확인 → 비료 과다 → 아래쪽 오래된 잎 → 양분 부족(비료 기록 없음) 순서로 확인', 'observe'],
    [`잎 색 진하기가 ${fmt(b.pale_drop, 0)}% 이상 줄어듦 (잎 색이 옅어짐)`, '빛 부족 → 양분 부족 순서로 확인', 'observe'],
    [`모양 지수(높이 ÷ √면적)가 ${fmt(b.stretch_rise, 0)}% 이상 커짐 (위로 길쭉해짐)`, '웃자람 → 조명 시간·높이 확인, 상추는 고온이면 꽃대 확인 (잎 색이 옅어졌거나 생장 감소면 관리)', 'observe'],
    ['정면 사진과 3D 측정의 생장 판단이 엇갈림', '촬영 각도·높이 확인 (3D 결과 우선)', 'observe'],
    ['생장이 감소했지만 환경으로 설명되지 않음', '원인 불명 → 관찰', 'observe'],
    ['환경 조건이 안정적  그리고  계속 잘 자람', '현재 관리 환경 유지', 'good'],
  ];
  const label = { care: '관리 필요', observe: '관찰 필요', good: '정상 생육' };
  const bullets = (items) => h('ul', { class: 'algo-list' }, items.map((x) => h('li', null, x)));
  const formula = (name, expr) => h('div', null, h('div', { class: 'field-label' }, name), h('div', { class: 'num' }, expr));
  screen.replaceChildren(
    topbar({ title: '' }),
    h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
      h('h1', { class: 'large-title' }, '추천 알고리즘'),
      h('p', { class: 'subtitle' }, '규칙 기반(IF → THEN)으로 판단해서 왜 그런 추천이 나왔는지 설명할 수 있어요.'))),
    h('a', { class: 'notice accent', href: '#/settings/rules', style: { marginTop: '4px' } },
      h('span', { html: icons.note, style: { display: 'contents' } }),
      h('span', { class: 'grow' }, h('b', null, '규칙을 글로 고칠 수 있어요. '), '아래 표는 기본 규칙(rules.md)의 요약이에요. 조건·단계·문구를 바꾸려면 "추천 규칙 고치기"로 가세요.'),
      h('span', { html: icons.chevron, style: { display: 'contents' } })),
    h('h2', { class: 'section-title' }, '처리 과정'),
    h('section', { class: 'card' }, h('div', { class: 'flow' }, flow.flatMap((x, i) => [i ? h('span', { class: 'arrow' }, '→') : null, h('span', { class: 'step' }, x)]))),

    h('h2', { class: 'section-title' }, '영상 분석'),
    h('section', { class: 'card' }, bullets([
      '사진 긴 변을 1280px로 맞추고 흐림 처리로 잡음을 줄여요.',
      'HSV 색 공간에서 종류별 초록 범위만 남긴 뒤, Opening(잡음 제거)과 Closing(빈틈 메우기)을 해요.',
      '가장 큰 초록 덩어리와 그 근처 잎 조각을 한 식물로 묶어 높이·폭(경계 상자)과 투영 면적(초록 픽셀 수)을 재요.',
      '분석 영역을 지정하면 영역 밖 초록색(옆 화분 잎, 소품)은 빼고 분석해요.',
      '사진 속 자로 크기를 보정하면 cm 단위로 바꿔요. 생장률(%)은 단위와 관계없이 같아요.',
    ])),

    h('h2', { class: 'section-title' }, '생장률 계산'),
    h('section', { class: 'card stack' },
      formula('변화량', 'X₂ − X₁'),
      formula('생장률 (하루당)', '(X₂ − X₁) ÷ (t₂ − t₁)'),
      formula('상대 생장률 (%/일)', '(X₂ − X₁) ÷ X₁ × 100 ÷ (t₂ − t₁)'),
      h('p', { class: 'caption', style: { margin: 0 } }, `X는 투영 면적·높이·폭, t는 촬영 시각이에요. 최근 ${g.rate_window}구간과 그 이전 ${g.rate_window}구간의 생장률을 비교해서 생장이 느려졌는지 판단해요. 면적 생장률이 이전보다 ${fmt(b.slowdown_ratio, 0)}% 넘게 줄면 '둔화', 하루 ${fmt(b.stagnation_rate)}%보다 낮으면 '정체'예요.`)),

    h('h2', { class: 'section-title' }, '3D 측정'),
    h('section', { class: 'card stack' },
      bullets([
        '식물 둘레를 돌며 0°·90°·180°·270°(+위) 사진을 찍으면, 모든 사진에서 식물 안쪽인 공간만 남겨 3D 영역을 만들어요(시각 헐).',
        '손으로 들고 찍어 생기는 거리 차이는 식물 높이를 0° 사진에 맞춰 보정하고, 회전축 위치는 부피가 가장 커지는 곳으로 맞춰요.',
        '위 사진은 8가지 방향 중 옆 사진과 가장 잘 맞는 방향을 골라 쓰고, 잘 맞지 않으면 빼고 계산해요.',
      ]),
      formula('하루 평균 부피 생장률 (%/일)', '((V₂ ÷ V₁)^(1 ÷ 일수) − 1) × 100'),
      h('p', { class: 'caption', style: { margin: 0 } },
        `3D 측정은 1주 간격이라 몇 배씩 커지므로 하루하루 같은 비율로 자랐다고 보고 계산해요. 최근 3D 측정이 2번 이상(마지막이 ${fmt(g.scan_max_age_days, 0)}일 안, 최근 사진 구간과 겹침)이면 부피로 먼저 판단하고 정면 사진은 보조 근거로 써요. 부피 정체 기준은 하루 ${fmt(b.volume_stagnation_rate)}%, 둔화 기준은 ${fmt(b.volume_slowdown_ratio, 0)}%예요.`),
      h('p', { class: 'caption', style: { margin: 0 } }, '잎 사이 빈 곳까지 채워져 부피가 실제보다 크게 나오므로, 같은 방식으로 찍은 측정끼리의 변화율로 판단해요.')),

    h('h2', { class: 'section-title' }, '판단 규칙'),
    h('section', { class: 'card' }, rules.map(([cond, then, level]) => h('div', { class: 'rule' },
      h('div', { class: 'if' }, h('span', { class: 'kw' }, 'IF'), cond),
      h('div', { class: 'then' }, h('span', { class: 'kw' }, 'THEN'), then, h('span', { class: `badge badge-${level}` }, label[level]))))),
    h('p', { class: 'caption', style: { margin: '8px 4px 0' } }, `환경값은 최근 ${g.env_lookback}번 중 ${g.persist_count}번 이상 기준을 벗어나야 '지속'으로 봐요. 생장 감소 = 둔화 또는 정체. 특이사항은 최근 ${g.sign_max_age_days}일, 흙 만져 보기는 최근 2일 기록을 써요.`),
    h('p', { class: 'caption', style: { margin: '4px 4px 0' } }, '판단 근거: 농촌진흥청·농사로 허브·상추 재배 관리 자료 (물은 흙 표면이 마른 걸 확인하고 주기, 바질·로즈마리는 과습에 민감, 빛 부족 → 웃자람, 고온 → 상추 꽃대, 통풍 부족 → 병해).'),

    h('h2', { class: 'section-title' }, '상태 구분'),
    h('div', { class: 'list' },
      [['good', '정상 생육', '높이와 투영 면적(또는 3D 부피)이 꾸준히 늘고, 환경 변화가 크지 않아요.'],
        ['observe', '관찰 필요', '생장 증가량이 줄었거나 환경값이 변했지만 아직 원인을 단정하기 어려워요.'],
        ['care', '관리 필요', '생육 정체·감소와 좋지 않은 환경 조건이 함께 나타나요.']].map(([k, t, d]) =>
        h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('span', { class: `badge badge-${k}` }, t), h('div', { class: 'meta', style: { marginTop: '6px' } }, d))))),

    h('h2', { class: 'section-title' }, '기준값 자동 제안'),
    h('section', { class: 'card' }, bullets([
      '정체 기준: 환경이 기준 안이었던 정상 구간 생장률의 하위 10% (건강한 구간의 90%는 이보다 빨랐어요)',
      '급감 경고: 평상시 측정 오차로 줄어든 폭(5백분위)의 1.5배',
      '토양 수분 최솟값: 물을 주기 직전 토양 수분의 중앙값',
      '온도·습도·조도: 잘 자란 구간이 기준 밖이면 넓히고, 기준 안에서 느린 구간이 나오면 좁혀요. 근거가 없으면 그대로 둬요.',
      '이상치는 IQR 규칙으로 빼고, 생장 구간이 8개 미만이면 제안하지 않아요.',
    ]), h('a', { class: 'btn btn-text', href: '#/settings/species/basil', style: { marginTop: '4px' } }, '바질 기준에서 제안받기')),

    h('h2', { class: 'section-title' }, '추천 효과 검증'),
    h('section', { class: 'card' }, bullets([
      '사진을 찍은 시점마다 그때까지의 기록만으로 추천을 다시 계산해요.',
      '추천 뒤 2일 안에 맞는 관리를 기록했으면 따름, 아니면 안 따름이에요.',
      '따름/안 따름 무리의 다음 구간 생장률 변화, 회복 비율, 토양 수분 변화를 비교해요.',
    ]), h('a', { class: 'btn btn-text', href: '#/report/validation', style: { marginTop: '4px' } }, '검증 리포트 보기')),

    h('p', { class: 'caption', style: { margin: '20px 4px 0' } }, '추천은 식물 상태를 의학적·생물학적으로 진단하는 것이 아니라, 측정한 데이터로 관리 행동을 결정할 때 참고할 수 있는 보조 정보예요. 모든 수식과 근거는 저장소의 jaram/ALGORITHM.md 문서에 정리돼 있어요.'));
}
