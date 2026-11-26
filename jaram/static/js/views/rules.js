// 행동 추천 규칙 보기·시험 (규칙 파일 rules.md 와 같은 형식)
// 관리 추천 규칙은 개발자만 rules.md 에서 바꿔요. 여기서는 읽고, 고친 글을 검사·미리 보기·파일로 받기만 해요.

import { api } from '../api.js';
import { h, icons, topbar, toast, confirmSheet, statusBadge, skeleton, withBusy, chips, goBack } from '../ui.js';

const LEVEL = { care: '관리', observe: '관찰', good: '정상', info: '참고' };

export async function rulesView() {
  const screen = document.getElementById('screen');
  screen.append(topbar({ title: '' }), skeleton(120, 8), skeleton(420));
  const [data, plantRes] = await Promise.all([api.rules(), api.plants()]);
  const plants = plantRes.plants || [];
  const current = data;
  const saved = data.text;
  let previewId = plants.length ? plants[0].id : null;

  const isDirty = () => editor.value !== saved;
  const editor = h('textarea', {
    class: 'input rules-editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
    'aria-label': '추천 규칙 글', oninput: () => renderState(),
  });
  editor.value = data.text;

  // ------------------------------------------------------------ 상태 안내
  const stateBox = h('div');
  function renderState() {
    const dirty = isDirty();
    stateBox.replaceChildren(h('div', { class: 'notice', style: { marginTop: '4px' } },
      h('span', { html: icons.info, style: { display: 'contents' } }),
      h('span', { class: 'grow' },
        h('b', null, '관리 추천 규칙은 개발자가 규칙 파일(rules.md)에서 정해요. '),
        `모든 계정이 같은 규칙 ${current.check?.count ?? 0}개를 써요. `,
        dirty
          ? '고친 글은 저장되지 않아요. 검사·미리 보기로 시험해 보고, 바꾸면 좋겠다면 "파일로 받기"로 받아 개발자에게 전해 주세요.'
          : '아래 글을 고쳐 검사·미리 보기로 시험해 볼 수 있지만 저장되지는 않아요.')));
  }

  // ------------------------------------------------------------ 검사 결과
  const checkBox = h('div', { class: 'rules-check', 'aria-live': 'polite' });
  function showCheck(res) {
    if (res.ok) {
      checkBox.replaceChildren(h('div', { class: 'notice accent' },
        h('span', { html: icons.check, style: { display: 'contents' } }),
        h('span', { class: 'grow' }, `고칠 곳이 없어요. 규칙 ${res.count}개를 읽었어요.`)));
      return;
    }
    checkBox.replaceChildren(
      h('div', { class: 'notice warn' },
        h('span', { html: icons.warn, style: { display: 'contents' } }),
        h('span', { class: 'grow' }, `고칠 곳이 ${res.errors.length}군데 있어요. 누르면 그 줄로 가요.`)),
      h('div', { class: 'list rules-errors' }, res.errors.slice(0, 30).map((e) => h('button', {
        class: 'list-item', type: 'button', onclick: () => jumpTo(e.line),
      },
      h('div', { class: 'list-icon observe', html: icons.warn }),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, e.line ? `${e.line}번째 줄` : '규칙 파일'),
        h('div', { class: 'meta' }, e.message))))));
  }

  function jumpTo(line) {
    if (!line) return;
    const lines = editor.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    const end = start + (lines[line - 1] || '').length;
    // 긴 줄이 화면에서 접혀도 정확한 위치로: 그 줄 앞까지만 넣어 높이를 잰 뒤 되돌려요
    const full = editor.value;
    editor.value = full.slice(0, start);
    const before = editor.scrollHeight;
    editor.value = full;
    editor.scrollIntoView({ block: 'nearest' });
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(start, end);
    editor.scrollTop = Math.max(0, before - editor.clientHeight / 3);
  }

  function insert(text) {
    const { selectionStart: a, selectionEnd: b } = editor;
    editor.setRangeText(text, a, b, 'end');
    editor.focus();
    renderState();
  }

  // ------------------------------------------------------------ 버튼
  const checkBtn = h('button', {
    class: 'btn btn-secondary btn-md', type: 'button',
    onclick: () => withBusy(checkBtn, async () => showCheck(await api.checkRules(editor.value))),
  }, h('span', { html: icons.check, style: { display: 'contents' } }), '검사하기');

  const fileInput = h('input', {
    type: 'file', accept: '.md,.txt,text/markdown,text/plain', hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 200000) { toast('파일이 너무 커요', { error: true }); return; }
      editor.value = await f.text();
      renderState();
      showCheck(await api.checkRules(editor.value));
      toast(`${f.name}을(를) 불러왔어요. 미리 보기로 시험해 보세요`);
    },
  });
  const downloadBtn = h('button', {
    class: 'btn btn-secondary btn-md', type: 'button',
    onclick: () => {
      const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/markdown;charset=utf-8' }));
      const a = h('a', { href: url, download: 'rules.md' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  }, h('span', { html: icons.download, style: { display: 'contents' } }), '파일로 받기');
  const uploadBtn = h('button', { class: 'btn btn-secondary btn-md', type: 'button', onclick: () => fileInput.click() },
    h('span', { html: icons.note, style: { display: 'contents' } }), '파일 불러오기');

  const restoreBtn = h('button', {
    class: 'btn btn-secondary btn-md', type: 'button',
    onclick: () => { editor.value = saved; renderState(); showCheck(current.check); previewBox.replaceChildren(); },
  }, h('span', { html: icons.refresh, style: { display: 'contents' } }), '원래 규칙으로');

  // ------------------------------------------------------------ 미리 보기
  const previewBox = h('div', { class: 'rules-preview', 'aria-live': 'polite' });
  const previewBtn = h('button', {
    class: 'btn btn-soft btn-md', type: 'button', disabled: !plants.length,
    onclick: () => withBusy(previewBtn, async () => {
      try {
        renderPreview(await api.previewRules(editor.value, previewId));
      } catch (err) {
        if (err.data?.errors) showCheck({ ok: false, errors: err.data.errors });
        throw err;
      }
    }),
  }, h('span', { html: icons.eye, style: { display: 'contents' } }), '이 글로 미리 보기');

  function renderPreview(res) {
    const plant = plants.find((p) => p.id === previewId);
    previewBox.replaceChildren(
      h('div', { class: 'status-head', style: { marginTop: '16px' } }, statusBadge(res.status, res.status_label),
        h('span', { class: 'caption' }, `${plant?.name || ''} · ${isDirty() ? '고친 글로 미리 보기' : '지금 규칙으로 미리 보기'}`)),
      ...res.recs.map((r) => h('div', { class: 'rec' },
        h('h3', { class: 'rec-title' }, statusBadge(r.level === 'info' ? 'info' : r.level, LEVEL[r.level] || r.level), r.title),
        h('p', { class: 'status-body' }, r.body),
        h('details', { class: 'why' },
          h('summary', null, '근거와 규칙', h('span', { html: icons.chevronDown, style: { display: 'contents' } })),
          h('ul', null, ...(r.reasons || []).map((x) => h('li', null, x)),
            r.rule ? h('li', { class: 'muted' }, `규칙: ${r.rule} (${r.code})`) : null)))),
      h('details', { class: 'why', style: { marginTop: '14px' } },
        h('summary', null, `이 식물에서 지금 참인 사실 ${res.true_facts.length}개`, h('span', { html: icons.chevronDown, style: { display: 'contents' } })),
        h('div', { class: 'rules-names' }, res.true_facts.map((f) => h('button', {
          class: 'chip', type: 'button', title: '누르면 규칙 글에 넣어요', onclick: () => insert(f),
        }, f)))));
  }

  // ------------------------------------------------------------ 쓸 수 있는 이름
  const ref = data.reference;
  const refGroup = (title, items, wrap = (x) => x, open = false) => h('details', { class: 'why rules-ref', open },
    h('summary', null, `${title} ${items.length}개`, h('span', { html: icons.chevronDown, style: { display: 'contents' } })),
    h('div', { class: 'list rules-ref-list' }, items.map((it) => h('button', {
      class: 'list-item', type: 'button', title: '누르면 규칙 글의 커서 위치에 넣어요', onclick: () => insert(wrap(it.name)),
    },
    h('div', { class: 'grow' }, h('div', { class: 'title rules-name' }, wrap(it.name)), h('div', { class: 'meta' }, it.desc)),
    h('span', { html: icons.plus, style: { display: 'contents' } })))));

  screen.replaceChildren(
    topbar({
      title: '',
      onBack: async () => {
        if (isDirty() && !(await confirmSheet({ title: '고친 글을 두고 나갈까요?', desc: '고친 글은 저장되지 않아요. 필요하면 먼저 "파일로 받기"로 받아 두세요.', ok: '나가기', danger: true }))) return;
        goBack('#/settings');
      },
    }),
    h('div', { class: 'page-head', style: { paddingTop: '8px' } }, h('div', null,
      h('h1', { class: 'large-title' }, '추천 규칙'),
      h('p', { class: 'subtitle' }, '어떤 조건에서 어떤 행동 추천이 나오는지 글로 읽고, 고친 글을 내 식물로 시험해 볼 수 있어요.'))),
    stateBox,
    h('section', { class: 'card', style: { marginTop: '12px' } },
      h('h2', { class: 'card-title' }, '규칙 글'),
      h('p', { class: 'card-sub', style: { marginBottom: '14px' } },
        '"## 이름 (코드)" 하나가 규칙 하나예요. 맨 위의 "읽는 법"을 먼저 읽어 보세요. 아래 이름 목록을 누르면 커서 위치에 넣어 줘요.'),
      editor,
      h('div', { class: 'btn-row rules-tools' }, checkBtn, downloadBtn, uploadBtn, restoreBtn),
      fileInput,
      checkBox),
    h('h2', { class: 'section-title' }, '미리 보기', h('small', null, '이 글로 내 식물을 판단해 보기')),
    h('section', { class: 'card' },
      plants.length
        ? [chips(plants.map((p) => [p.id, p.name]), previewId, (v) => { previewId = v; previewBox.replaceChildren(); }, 'chips in-card wrap'),
          h('div', { style: { marginTop: '12px' } }, previewBtn)]
        : h('p', { class: 'card-sub' }, '식물을 등록하고 사진을 찍으면 미리 볼 수 있어요.'),
      previewBox),
    h('h2', { class: 'section-title' }, '쓸 수 있는 이름'),
    h('section', { class: 'card' },
      refGroup('사실 (조건에 써요)', ref.facts, (x) => x, true),
      refGroup('특별한 이름 (조건에 써요)', ref.dynamic.filter((d) => !d.name.includes('코드'))),
      refGroup('값 (제목·내용에 써요)', ref.values, (x) => `{${x}}`),
      refGroup('근거 묶음 (근거에 써요)', ref.reasons),
      ref.generated?.length ? refGroup('코드 추천 (코드 추천에 써요)', ref.generated) : null,
      h('p', { class: 'caption', style: { margin: '14px 0 0' } },
        `단계: ${ref.levels.join(' · ')}  /  행동: ${ref.actions.join(' · ')}  /  조건 잇기: 그리고 · 또는 · 아님 · ( )`,
        h('br'), '이미 나온 추천 확인: 추천:코드  ·  관리추천:코드 (예: 추천:water_needed,water_done)')));
  renderState();
  showCheck(data.check);
  return { cleanup: () => {} };
}
