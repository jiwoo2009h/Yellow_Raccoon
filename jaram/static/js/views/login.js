// 로그인 / 계정 만들기 화면 (서버에 가입 코드(JARAM_PASSWORD)가 설정된 '계정 모드'에서만 나타남)
// 각자 계정으로 로그인하면 자기 식물만 보여요.

import { api } from '../api.js';
import { h, friendlyError, segmented, field, toast } from '../ui.js';

export function loginView(onSuccess) {
  const screen = document.getElementById('screen');
  document.getElementById('tabbar').hidden = true;
  screen.className = 'screen no-tab';
  let mode = 'login';

  const input = (attrs) => h('input', { class: 'input', required: true, ...attrs });
  const username = input({ name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 20, placeholder: '아이디' });
  const password = input({ name: 'password', type: 'password', autocomplete: 'current-password', maxlength: 128, placeholder: '비밀번호' });
  const password2 = input({ name: 'password2', type: 'password', autocomplete: 'new-password', maxlength: 128, placeholder: '비밀번호 한 번 더' });
  const code = input({ name: 'code', type: 'password', autocomplete: 'off', placeholder: '팀에서 받은 가입 코드' });
  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const button = h('button', { class: 'btn btn-primary', type: 'submit' });
  const signupFields = h('div', null,
    h('div', { class: 'field-gap' }),
    field('비밀번호 확인', password2),
    h('div', { class: 'field-gap' }),
    field('가입 코드', code, '지금까지 쓰던 팀 비밀번호예요. 처음 가입한 사람이 관리자가 되고, 그동안 기록한 식물을 가져가요.'));
  const subtitle = h('p', { class: 'subtitle', style: { textAlign: 'center', margin: '6px 0 24px' } });

  const showError = (msg) => { error.textContent = msg; error.hidden = false; };
  const setMode = (m) => {
    mode = m;
    error.hidden = true;
    signupFields.hidden = m !== 'signup';
    password2.required = m === 'signup';
    code.required = m === 'signup';
    password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    password.placeholder = m === 'signup' ? '6자 이상' : '비밀번호';
    username.placeholder = m === 'signup' ? '2~20자 한글·영문·숫자' : '아이디';
    button.textContent = m === 'signup' ? '계정 만들기' : '로그인';
    subtitle.textContent = m === 'signup'
      ? '계정을 만들면 내 식물만 따로 기록하고 볼 수 있어요.'
      : '내 계정으로 로그인하면 내 식물을 볼 수 있어요.';
  };

  const form = h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hidden = true;
      if (mode === 'signup' && password.value !== password2.value) {
        showError('비밀번호 두 칸이 서로 달라요.');
        password2.select();
        return;
      }
      button.disabled = true;
      button.classList.add('is-loading');
      try {
        if (mode === 'signup') {
          const res = await api.signup({ username: username.value.trim(), password: password.value, code: code.value });
          toast(res.claimed ? `환영해요! 그동안 기록한 식물 ${res.claimed}개를 가져왔어요` : '환영해요! 첫 식물을 등록해 보세요');
        } else {
          await api.login(username.value.trim(), password.value);
        }
        onSuccess();
      } catch (err) {
        showError(friendlyError(err));
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    },
  },
  h('img', { class: 'login-logo', src: '/static/icons/icon.svg', alt: '' }),
  h('h1', { class: 'large-title', style: { textAlign: 'center' } }, '자람'),
  subtitle,
  segmented([['login', '로그인'], ['signup', '계정 만들기']], mode, setMode),
  h('div', { style: { height: '20px' } }),
  field('아이디', username),
  h('div', { class: 'field-gap' }),
  field('비밀번호', password),
  signupFields,
  error,
  h('div', { style: { height: '20px' } }),
  button,
  h('p', { class: 'caption', style: { textAlign: 'center', marginTop: '20px' } }, '한 번 로그인하면 이 휴대폰에서는 로그인이 유지돼요. 비밀번호를 잊으면 관리자에게 초기화를 부탁하세요.'));

  setMode('login');
  screen.replaceChildren(form);
  setTimeout(() => username.focus(), 200);
}
