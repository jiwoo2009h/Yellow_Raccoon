// 앱 시작 + 화면 이동(해시 라우터) + 하단 탭바

import { h, icons, toast } from './ui.js';
import { applyTheme } from './theme.js';
import { api } from './api.js';
import { loginView } from './views/login.js';
import { homeView } from './views/home.js';
import { plantView } from './views/plant.js';
import { captureView, pickPlantAndCapture } from './views/capture.js';
import { resultView } from './views/result.js';
import { plantFormView } from './views/plantForm.js';
import { calibrateView } from './views/calibrate.js';
import { roiView } from './views/roi.js';
import { reportView } from './views/report.js';
import { settingsView, speciesSettingsView, generalSettingsView, algorithmView } from './views/settings.js';

const routes = [
  ['/', homeView, 'home'],
  ['/report', reportView, 'report'],
  ['/settings', settingsView, 'settings'],
  ['/settings/species/:key', speciesSettingsView],
  ['/settings/general', generalSettingsView],
  ['/settings/algorithm', algorithmView],
  ['/plant/new', plantFormView],
  ['/plant/:id', plantView],
  ['/plant/:id/edit', plantFormView],
  ['/plant/:id/capture', captureView],
  ['/plant/:id/calibrate', calibrateView],
  ['/plant/:id/roi', roiView],
  ['/m/:id', resultView],
];

function match(path) {
  for (const [pattern, view, tab] of routes) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(re);
    if (m) return { view, tab, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

const screen = document.getElementById('screen');
const tabbar = document.getElementById('tabbar');
let cleanup = null;

function renderTabbar(active) {
  const tab = (key, href, label, ic) => h('a', {
    class: 'tab', href, 'aria-current': active === key ? 'page' : null,
  }, h('span', { html: icons[ic], style: { display: 'contents' } }), label);
  tabbar.replaceChildren(
    tab('home', '#/', '홈', 'home'),
    h('button', { class: 'tab tab-capture', type: 'button', onclick: () => pickPlantAndCapture() },
      h('span', { class: 'bubble', html: icons.camera }), '촬영'),
    tab('report', '#/report', '리포트', 'chart'),
    tab('settings', '#/settings', '설정', 'settings'),
  );
  tabbar.hidden = !active;
}

async function router() {
  if (showingLogin) return;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const found = match(path) || match('/');
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch { /* 이전 화면 정리 실패는 무시 */ }
  }
  cleanup = null;
  document.getElementById('layer').querySelectorAll('.backdrop').forEach((b) => b.remove());
  renderTabbar(found.tab);
  screen.className = 'screen' + (found.tab ? '' : ' no-tab push');
  screen.replaceChildren();
  window.scrollTo(0, 0);
  try {
    const result = await found.view(found.params, { screen });
    if (result && typeof result === 'object') {
      if (result.cleanup) cleanup = result.cleanup;
      if (result.className) screen.className = 'screen ' + result.className;
    }
  } catch (err) {
    if (err.status === 401) return; // 로그인 화면이 대신 표시됨
    console.error(err);
    screen.replaceChildren(
      h('div', { class: 'empty' },
        h('div', { class: 'art', html: icons.warn }),
        h('h2', null, '화면을 불러오지 못했어요'),
        h('p', null, err.message || '잠시 후 다시 시도해 주세요.'),
        h('button', { class: 'btn btn-secondary', onclick: () => router() }, '다시 시도')));
  }
}

// 앱 안에서 이동한 기록이 있을 때만 '뒤로'가 브라우저 뒤로가기로 동작하도록 표시
window.addEventListener('hashchange', () => {
  sessionStorage.setItem('jaram-nav', '1');
  router();
});

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.message && e.reason.status !== 401) toast(e.reason.message, { error: true });
});

// 로그인이 필요하면 (서버에 팀 비밀번호가 설정된 경우) 로그인 화면부터
let showingLogin = false;
function showLogin() {
  if (showingLogin) return;
  showingLogin = true;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* 무시 */ } }
  cleanup = null;
  document.getElementById('layer').querySelectorAll('.backdrop').forEach((b) => b.remove());
  loginView(() => { showingLogin = false; router(); });
}
window.addEventListener('jaram:login-required', showLogin);

applyTheme();
api.auth()
  .then((a) => (a.required && !a.authenticated ? showLogin() : router()))
  .catch(() => router());
