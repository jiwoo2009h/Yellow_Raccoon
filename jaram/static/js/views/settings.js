import { api } from '../api.js';
import { h, icons, topbar, segmented, field, numberInput, toast, confirmSheet, fmt, formValues, skeleton } from '../ui.js';
import { getTheme, setTheme } from '../theme.js';

const row = ({ href, icon, title, meta, onClick, accent }) => h(href ? 'a' : 'button', {
  class: 'list-item', href, type: href ? null : 'button', onclick: onClick,
},
h('div', { class: 'list-icon' + (accent ? ' accent' : ''), html: icons[icon] }),
h('div', { class: 'grow' }, h('div', { class: 'title' }, title), meta ? h('div', { class: 'meta' }, meta) : null),
h('span', { class: 'chev', html: icons.chevron, style: { display: 'contents' } }));

// ------------------------------------------------------------ 설정 홈
export async function settingsView() {
  const screen = document.getElementById('screen');
  const head = h('div', { class: 'page-head' }, h('h1', { class: 'large-title' }, '설정'));
  screen.append(head, skeleton(80, 16), skeleton(200));
  const [{ thresholds }, auth] = await Promise.all([api.settings(), api.auth()]);
  const sp = thresholds.species;
  const desc = (t) => `온도 ${fmt(t.temp_min)}–${fmt(t.temp_max)}℃ · 토양 ${fmt(t.soil_min, 0)}% 이상 · 조도 ${fmt(t.lux_min, 0)} lux 이상`;

  screen.replaceChildren(head,
    h('h2', { class: 'section-title' }, '화면'),
    h('section', { class: 'card' },
      h('div', { class: 'field-label' }, '테마'),
      segmented([['system', '시스템'], ['light', '라이트'], ['dark', '다크']], getTheme(), (v) => setTheme(v))),
    h('h2', { class: 'section-title' }, '추천 기준'),
    h('p', { class: 'caption', style: { margin: '-4px 4px 12px' } }, '실험에서 모은 데이터를 보고 숫자를 조정하세요. 바꾸면 모든 식물의 추천에 바로 반영돼요.'),
    h('div', { class: 'list' },
      row({ href: '#/settings/species/basil', icon: 'leaf', accent: true, title: '바질', meta: desc(sp.basil) }),
      row({ href: '#/settings/species/lettuce', icon: 'sprout', accent: true, title: '상추', meta: desc(sp.lettuce) }),
      row({ href: '#/settings/species/other', icon: 'sprout', title: '기타 식물', meta: desc(sp.other) }),
      row({ href: '#/settings/general', icon: 'sliders', title: '공통 판단 기준', meta: `생장률 계산 간격 ${thresholds.general.rate_window}회 · 환경 지속 ${thresholds.general.persist_count}/${thresholds.general.env_lookback}회 · 3D ${thresholds.general.scan_max_age_days}일` })),
    h('h2', { class: 'section-title' }, '데이터'),
    h('div', { class: 'list' },
      h('a', { class: 'list-item', href: '/api/export.csv', download: '' },
        h('div', { class: 'list-icon', html: icons.download }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, 'CSV로 내보내기'), h('div', { class: 'meta' }, '모든 측정·환경·관리 기록'))),
      h('a', { class: 'list-item', href: api.backupUrl, download: '' },
        h('div', { class: 'list-icon', html: icons.download }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, '전체 백업 받기'), h('div', { class: 'meta' }, 'DB와 모든 사진을 zip 파일 하나로'))),
      row({
        icon: 'refresh', title: '모든 사진 다시 분석', meta: '색상(HSV) 범위를 바꾼 뒤 사용하세요',
        onClick: async () => {
          const ok = await confirmSheet({ title: '모든 사진을 다시 분석할까요?', desc: '지금 설정된 색상 범위로 높이·폭·면적을 다시 계산해요. 사진이 많으면 시간이 걸릴 수 있어요.', ok: '다시 분석' });
          if (!ok) return;
          toast('다시 분석하는 중이에요…');
          const r = await api.reanalyze();
          toast(`${r.ok}장을 다시 분석했어요${r.failed ? ` (${r.failed}장 실패)` : ''}`);
        },
      })),
    h('h2', { class: 'section-title' }, '정보'),
    h('div', { class: 'list' },
      row({ href: '#/settings/algorithm', icon: 'book', title: '추천 알고리즘 살펴보기', meta: '상태 판단 규칙과 생장률 계산 방법' }),
      auth.required ? row({
        icon: 'close', title: '로그아웃', meta: '이 휴대폰에서 팀 비밀번호 로그인을 해제해요',
        onClick: async () => {
          const ok = await confirmSheet({ title: '로그아웃할까요?', desc: '다시 들어오려면 팀 비밀번호가 필요해요.', ok: '로그아웃' });
          if (!ok) return;
          await api.logout();
          window.dispatchEvent(new CustomEvent('jaram:login-required'));
        },
      }) : null),
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
    ['hue_drop', '잎 색 변화', 'Hue', '잎의 평균 색상이 처음보다 이만큼 노란 쪽으로 바뀌면 알려요'],
    ['water_interval_days', '물주기 확인 간격', '일', '토양 수분 기록이 없을 때, 물 준 지 이만큼 지나면 확인을 권해요'],
  ]],
  ['3D 생장 판단', '최근 3D 측정이 2번 이상 있으면 부피 변화로 생장을 먼저 판단하고, 정면 사진은 보조 근거로 써요.', [
    ['volume_slowdown_ratio', '부피 둔화 기준', '%', '최근 3D 구간의 부피 생장률이 그 전 구간보다 이만큼 줄면 "생장 둔화"'],
    ['volume_stagnation_rate', '부피 정체 기준', '%/일', '부피 생장률이 하루 이 값보다 낮으면 "정체". 모양이 그대로 커지면 부피는 면적보다 약 1.5배 빠르게 늘어요'],
  ]],
];

export async function speciesSettingsView({ key }) {
  const screen = document.getElementById('screen');
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

  const form = h('form', {
    oninput: drawHsv,
    onsubmit: async (e) => { e.preventDefault(); await save(); },
  },
  h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
    h('h1', { class: 'large-title' }, `${t.label} 기준`),
    h('p', { class: 'subtitle' }, '관리 추천 알고리즘이 쓰는 임계값이에요.'))),
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
  h('div', { class: 'cta' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '저장하기')));

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

  async function save(next) {
    const before = JSON.stringify([t.hsv_lower, t.hsv_upper]);
    try {
      const res = await api.saveSettings(next || collect(formValues(form)));
      const after = res.thresholds.species[key];
      toast('기준을 저장했어요');
      if (JSON.stringify([after.hsv_lower, after.hsv_upper]) !== before) {
        const ok = await confirmSheet({ title: '사진을 다시 분석할까요?', desc: `색상 범위가 바뀌었어요. ${t.label} 사진들을 새 범위로 다시 분석하면 그래프와 추천도 함께 바뀌어요.`, ok: '다시 분석' });
        if (ok) {
          const { plants } = await api.plants();
          let n = 0;
          for (const p of plants.filter((x) => x.species === key)) n += (await api.reanalyze(p.id)).ok;
          toast(`${n}장을 다시 분석했어요`);
        }
      }
      location.hash = '#/settings';
    } catch (err) { toast(err.message, { error: true }); }
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

// ------------------------------------------------------------ 공통 기준
export async function generalSettingsView() {
  const screen = document.getElementById('screen');
  const { thresholds } = await api.settings();
  const g = thresholds.general;
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const v = formValues(form);
      const next = structuredClone(thresholds);
      Object.assign(next.general, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)));
      try {
        await api.saveSettings(next);
        toast('기준을 저장했어요');
        location.hash = '#/settings';
      } catch (err) { toast(err.message, { error: true }); }
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
      '마지막 3D 측정이 이 기간 안에 있을 때만 부피 생장률로 판단해요. 오래된 3D 측정은 쓰지 않고 정면 사진으로 판단해요.')),
  h('div', { class: 'cta' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '저장하기')));
  screen.replaceChildren(topbar({ title: '' }), form);
}

// ------------------------------------------------------------ 알고리즘 설명
export async function algorithmView() {
  const screen = document.getElementById('screen');
  const { thresholds } = await api.settings();
  const b = thresholds.species.basil;
  const l = thresholds.species.lettuce;
  const both = (k, unit = '') => `바질 ${fmt(b[k], 0)}${unit} / 상추 ${fmt(l[k], 0)}${unit}`;
  const flow = ['사진 입력', '생육 지표 추출', '환경 데이터', '생장률 계산', '조건 비교', '상태 판단', '관리 추천'];
  const rules = [
    [`토양 수분 < ${both('soil_min', '%')}  그리고  최근 생장률 감소`, '수분 부족 가능성 → 물주기 확인', 'care'],
    ['토양 수분은 낮지만 높이·면적은 계속 증가', '바로 판단하지 않고 관찰', 'observe'],
    [`조도 < ${both('lux_min', ' lux')} 가 지속  그리고  생장률 감소`, '광환경 부족 가능성 → 위치·조명 확인', 'care'],
    ['온도·습도가 범위 밖으로 지속  그리고  생장 증가량 감소', '환경 조건 확인 필요', 'care'],
    [`토양 수분 > ${both('soil_max', '%')} 가 지속  그리고  생장률 감소`, '과습 가능성 → 물 주는 간격 늘리기', 'care'],
    [`한 번에 투영 면적이 ${fmt(b.drop_alert, 0)}% 이상 감소`, '시듦 또는 촬영 오류 확인', 'observe'],
    ['생장률이 감소했지만 환경으로 설명되지 않음', '원인 불명 → 관찰', 'observe'],
    ['환경 조건이 안정적  그리고  높이·면적이 계속 증가', '현재 관리 환경 유지', 'good'],
  ];
  const label = { care: '관리 필요', observe: '관찰 필요', good: '정상 생육' };
  screen.replaceChildren(
    topbar({ title: '' }),
    h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
      h('h1', { class: 'large-title' }, '추천 알고리즘'),
      h('p', { class: 'subtitle' }, '규칙 기반(IF → THEN)으로 판단해서 왜 그런 추천이 나왔는지 설명할 수 있어요.'))),
    h('h2', { class: 'section-title' }, '처리 과정'),
    h('section', { class: 'card' }, h('div', { class: 'flow' }, flow.flatMap((s, i) => [i ? h('span', { class: 'arrow' }, '→') : null, h('span', { class: 'step' }, s)]))),
    h('h2', { class: 'section-title' }, '생장률 계산'),
    h('section', { class: 'card stack' },
      h('div', null, h('div', { class: 'field-label' }, '변화량'), h('div', { class: 'num' }, 'X₂ − X₁')),
      h('div', null, h('div', { class: 'field-label' }, '생장률 (하루당)'), h('div', { class: 'num' }, '(X₂ − X₁) ÷ (t₂ − t₁)')),
      h('div', null, h('div', { class: 'field-label' }, '상대 생장률 (%/일)'), h('div', { class: 'num' }, '(X₂ − X₁) ÷ X₁ × 100 ÷ (t₂ − t₁)')),
      h('p', { class: 'caption', style: { margin: 0 } }, `X는 투영 면적·높이·폭, t는 촬영 시각이에요. 최근 ${thresholds.general.rate_window}구간과 그 이전 ${thresholds.general.rate_window}구간의 생장률을 비교해서 생장이 느려졌는지 판단해요.`)),
    h('h2', { class: 'section-title' }, '판단 규칙'),
    h('section', { class: 'card' }, rules.map(([cond, then, level]) => h('div', { class: 'rule' },
      h('div', { class: 'if' }, h('span', { class: 'kw' }, 'IF'), cond),
      h('div', { class: 'then' }, h('span', { class: 'kw' }, 'THEN'), then, h('span', { class: `badge badge-${level}` }, label[level]))))),
    h('h2', { class: 'section-title' }, '상태 구분'),
    h('div', { class: 'list' },
      [['good', '정상 생육', '높이와 투영 면적이 꾸준히 늘고, 생장률이 유지되고, 환경 변화가 크지 않아요.'],
        ['observe', '관찰 필요', '생장 증가량이 줄었거나 환경값이 변했지만 아직 원인을 단정하기 어려워요.'],
        ['care', '관리 필요', '생육 정체·감소와 좋지 않은 환경 조건이 함께 나타나요.']].map(([k, t, d]) =>
        h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('span', { class: `badge badge-${k}` }, t), h('div', { class: 'meta', style: { marginTop: '6px' } }, d))))),
    h('p', { class: 'caption', style: { margin: '20px 4px 0' } }, '추천은 식물 상태를 의학적·생물학적으로 진단하는 것이 아니라, 측정한 데이터로 관리 행동을 결정할 때 참고할 수 있는 보조 정보예요. 기준값은 설정에서 실험 데이터에 맞게 조정할 수 있어요.'));
}
