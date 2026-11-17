import { api } from '../api.js';
import { h, icons, topbar, segmented, numberInput, toast, confirmSheet, fmt, formValues, skeleton } from '../ui.js';
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
  const { thresholds } = await api.settings();
  const sp = thresholds.species;
  const desc = (t) => `온도 ${fmt(t.temp_min)}–${fmt(t.temp_max)}℃ · 토양 ${fmt(t.soil_min, 0)}% 이상 · 조도 ${fmt(t.lux_min, 0)} lux 이상`;

  screen.replaceChildren(head,
    h('h2', { class: 'section-title' }, '화면'),
    h('section', { class: 'card' },
      h('div', { class: 'field-label' }, '테마'),
      segmented([['system', '시스템'], ['light', '라이트'], ['dark', '다크']], getTheme(), (v) => setTheme(v))),
    h('h2', { class: 'section-title' }, '추천 기준'),
    h('p', { class: 'caption', style: { margin: '-4px 4px 12px' } }, '관리 추천 규칙의 기준값은 개발자가 정하며 앱에서는 확인만 할 수 있어요. 식물 영역 색상(HSV) 범위는 각 식물 기준 화면에서 바꿀 수 있어요.'),
    h('div', { class: 'list' },
      row({ href: '#/settings/species/basil', icon: 'leaf', accent: true, title: '바질', meta: desc(sp.basil) }),
      row({ href: '#/settings/species/lettuce', icon: 'sprout', accent: true, title: '상추', meta: desc(sp.lettuce) }),
      row({ href: '#/settings/species/other', icon: 'sprout', title: '기타 식물', meta: desc(sp.other) }),
      row({ href: '#/settings/general', icon: 'sliders', title: '공통 판단 기준', meta: `생장률 계산 간격 ${thresholds.general.rate_window}회 · 환경 지속 ${thresholds.general.persist_count}/${thresholds.general.env_lookback}회` }),
      row({ href: '#/settings/symptoms', icon: 'warn', title: '특이 사항 키워드', meta: '증상 키워드와 증상 → 병해충 연결표' })),
    h('h2', { class: 'section-title' }, '데이터'),
    h('div', { class: 'list' },
      h('a', { class: 'list-item', href: '/api/export.csv', download: '' },
        h('div', { class: 'list-icon', html: icons.download }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, 'CSV로 내보내기'), h('div', { class: 'meta' }, '모든 측정·환경·관리 기록'))),
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
      row({ href: '#/settings/algorithm', icon: 'book', title: '추천 알고리즘 살펴보기', meta: '상태 판단 규칙과 생장률 계산 방법' })),
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
];

const lockNotice = () => h('div', { class: 'notice', style: { marginTop: '16px' } },
  h('span', { html: icons.info, style: { display: 'contents' } }),
  h('div', { class: 'grow' }, '관리 추천 규칙은 개발자가 실험 데이터를 바탕으로 정해요. 앱에서는 확인만 할 수 있어요.'));

const valueRow = (label, value, hint) => h('div', { class: 'list-item' },
  h('div', { class: 'grow' }, h('div', { class: 'title' }, label), hint ? h('div', { class: 'meta' }, hint) : null),
  h('span', { class: 'value num' }, value));

export async function speciesSettingsView({ key }) {
  const screen = document.getElementById('screen');
  const { thresholds, defaults } = await api.settings();
  const t = thresholds.species[key];
  if (!t) { location.replace('#/settings'); return; }

  const show = (k, unit) => {
    if (['temp', 'humidity', 'soil'].includes(k)) return `${fmt(t[`${k}_min`])} ~ ${fmt(t[`${k}_max`])} ${unit}`;
    return `${fmt(t[k])} ${unit}`;
  };

  // 식물 영역 색상(HSV)은 추천 규칙이 아니라 사진 분석 설정이라 이용자가 바꿀 수 있어요.
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
    h('p', { class: 'subtitle' }, '관리 추천 알고리즘이 쓰는 임계값과 사진 분석 색상 범위예요.'))),
  lockNotice(),
  SECTIONS.map(([title, desc, items]) => [
    h('h2', { class: 'section-title' }, title),
    h('p', { class: 'caption', style: { margin: '-4px 4px 12px' } }, desc),
    h('div', { class: 'list' }, items.map(([k, label, unit, hint]) =>
      valueRow(['temp', 'humidity', 'soil'].includes(k) ? `${label} 범위` : label, show(k, unit), hint))),
  ]),
  h('h2', { class: 'section-title' }, '식물 영역 색상 (HSV)'),
  h('section', { class: 'card' },
    h('p', { class: 'card-sub', style: { marginBottom: '16px' } }, '사진에서 이 범위의 색을 식물로 인식해요. 잎이 잘 잡히지 않으면 범위를 넓히고, 배경이 섞이면 좁혀 보세요.'),
    hsvBox),
  h('button', { class: 'btn btn-text', type: 'button', style: { margin: '20px auto 0', display: 'flex' }, onclick: resetSpecies }, '색상 범위 기본값으로 되돌리기'),
  h('div', { class: 'cta' }, h('button', { class: 'btn btn-primary', type: 'submit' }, '색상 범위 저장하기')));

  function collect(v) {
    const next = structuredClone(thresholds);
    const s = next.species[key];
    s.hsv_lower = [v.h_min, v.s_min, v.v_min].map((x, i) => x ?? t.hsv_lower[i]);
    s.hsv_upper = [v.h_max, v.s_max, v.v_max].map((x, i) => x ?? t.hsv_upper[i]);
    return next;
  }

  async function save(next) {
    const before = JSON.stringify([t.hsv_lower, t.hsv_upper]);
    try {
      const res = await api.saveSettings(next || collect(formValues(form)));
      const after = res.thresholds.species[key];
      toast('색상 범위를 저장했어요');
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
    const ok = await confirmSheet({ title: `${t.label} 색상 범위를 기본값으로 되돌릴까요?`, ok: '되돌리기' });
    if (!ok) return;
    const next = structuredClone(thresholds);
    next.species[key].hsv_lower = structuredClone(defaults.species[key].hsv_lower);
    next.species[key].hsv_upper = structuredClone(defaults.species[key].hsv_upper);
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
  screen.replaceChildren(topbar({ title: '' }),
    h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
      h('h1', { class: 'large-title' }, '공통 판단 기준'),
      h('p', { class: 'subtitle' }, '모든 식물에 똑같이 적용돼요.'))),
    lockNotice(),
    h('div', { class: 'list', style: { marginTop: '16px' } },
      valueRow('생장률 계산 간격', `${g.rate_window}회`,
        '최근 몇 번의 측정 구간을 묶어 생장률을 계산할지예요. 2이면 최근 사진 3장의 처음과 끝을 비교해요.'),
      valueRow('환경을 볼 기록 수', `${g.env_lookback}회`, '최근 몇 번의 환경 기록을 함께 볼지예요.'),
      valueRow('"지속"으로 볼 횟수', `${g.persist_count}회`,
        '그중 몇 번 이상 기준을 벗어나야 "계속 벗어남"으로 판단할지예요. 센서 값이 한 번 튀어서 잘못 추천하는 것을 막아요.')));
}

// ------------------------------------------------------------ 특이 사항 키워드
export async function symptomSettingsView() {
  const screen = document.getElementById('screen');
  const { symptoms } = await api.settings();
  const { rules } = symptoms;
  const groups = [...new Set(symptoms.symptoms.map((x) => x.group))];
  const pestList = h('div');
  const symptomList = h('div');

  symptomList.append(
    h('p', { class: 'caption', style: { margin: '12px 4px 0' } },
      '띄어쓰기는 무시해요. "/"는 또는, "+"는 같은 글에 함께 있어야 한다는 뜻이에요. "반점 없음"처럼 뒤에 부정하는 말이 오면 증상으로 보지 않아요.'),
    groups.map((g) => [
      h('h2', { class: 'section-title' }, g),
      h('div', { class: 'list' }, symptoms.symptoms.filter((x) => x.group === g).map((x) =>
        h('div', { class: 'list-item' }, h('div', { class: 'grow' },
          h('div', { class: 'title' }, x.label),
          h('div', { class: 'meta' }, x.keywords.join('  ·  ')))))),
    ]));

  pestList.append(
    h('p', { class: 'caption', style: { margin: '12px 4px 0' } },
      `찾은 증상의 점수를 병해충마다 더해요(특징 증상 4점, 함께 나타나는 증상 1~3점). ${rules.min_score}점 이상이면 후보가 되고, `
      + `${rules.care_score}점 이상이거나 ${rules.supported_score}점 이상이면서 잘 생기는 환경·생장 둔화가 함께 확인되면 관리 필요로 판단해요. `
      + '증상이 하나뿐이라 후보가 없으면 관련 병해충과 구분하는 방법을 안내해요.'),
    symptoms.pests.map((r) => [
      h('h2', { class: 'section-title' }, `${r.name} · ${r.kind}`),
      h('div', { class: 'list' },
        r.symptoms.map((k) => valueRow(k.label, `${k.weight}점`)),
        r.env.length ? valueRow('잘 생기는 환경', '', r.env.join(' · ')) : null),
      h('p', { class: 'caption', style: { margin: '8px 4px 0' } }, `출처: ${r.source}`),
    ]));

  let tab = 'symptoms';
  const body = h('div');
  const draw = () => body.replaceChildren(tab === 'symptoms' ? symptomList : pestList);
  screen.replaceChildren(topbar({ title: '' }),
    h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
      h('h1', { class: 'large-title' }, '특이 사항 키워드'),
      h('p', { class: 'subtitle' }, '특이 사항에서 증상을 찾고, 증상 조합으로 의심되는 병해충을 골라 관리 방법을 추천해요.'))),
    lockNotice(),
    h('div', { style: { marginTop: '16px' } },
      segmented([['symptoms', '증상 키워드'], ['pests', '증상 → 병해충']], tab, (v) => { tab = v; draw(); })),
    body);
  draw();
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
    ['특이 사항의 증상 조합 (예: 갈색 반점+겹무늬, 밑동 물러짐+악취, 구멍+애벌레)', '의심 병해충 + 자료 기반 관리 방법 (환경·생장과 함께 판단)', 'care'],
    ['특이 사항에 증상이 하나뿐 (예: 변색, 반점)', '관련 병해충과 구분 방법 안내 → 관찰', 'observe'],
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
    h('p', { class: 'caption', style: { margin: '20px 4px 0' } }, '추천은 식물 상태를 의학적·생물학적으로 진단하는 것이 아니라, 측정한 데이터로 관리 행동을 결정할 때 참고할 수 있는 보조 정보예요. 기준값은 개발자가 실험 데이터를 바탕으로 정해요.'));
}
