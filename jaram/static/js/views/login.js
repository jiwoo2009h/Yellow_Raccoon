// 팀 비밀번호 로그인 화면 (서버에 JARAM_PASSWORD 가 설정된 경우에만 나타남)

import { api } from '../api.js';
import { h } from '../ui.js';

export function loginView(onSuccess) {
  const screen = document.getElementById('screen');
  document.getElementById('tabbar').hidden = true;
  screen.className = 'screen no-tab';

  const input = h('input', {
    class: 'input', type: 'password', name: 'password', autocomplete: 'current-password',
    placeholder: '팀 비밀번호', required: true, 'aria-label': '팀 비밀번호',
  });
  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const button = h('button', { class: 'btn btn-primary', type: 'submit' }, '들어가기');

  const form = h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hidden = true;
      button.disabled = true;
      try {
        await api.login(input.value);
        onSuccess();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
        input.select();
      }
    },
  },
  h('img', { class: 'login-logo', src: '/static/icons/icon.svg', alt: '' }),
  h('h1', { class: 'large-title', style: { textAlign: 'center' } }, '자람'),
  h('p', { class: 'subtitle', style: { textAlign: 'center', margin: '6px 0 32px' } }, '팀 비밀번호를 입력하면 기록을 볼 수 있어요.'),
  input,
  error,
  h('div', { style: { height: '16px' } }),
  button,
  h('p', { class: 'caption', style: { textAlign: 'center', marginTop: '20px' } }, '한 번 들어오면 이 휴대폰에서는 로그인이 유지돼요.'));

  screen.replaceChildren(form);
  setTimeout(() => input.focus(), 200);
}
