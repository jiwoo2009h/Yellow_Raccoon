// 앱 시작 + 화면 이동(해시 라우터) + 하단 탭바(넓은 화면에서는 왼쪽 사이드바)

import { h, icons, toast, friendlyError, closeAllSheets, topbar } from './ui.js';
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
import { scanView } from './views/scan.js';
import { scanResultView } from './views/scanResult.js';
import { reportView } from './views/report.js';
import { validationView } from './views/validation.js';
import { settingsView, speciesSettingsView, generalSettingsView, algorithmView } from './views/settings.js';
import { rulesView } from './views/rules.js';

const routes = [
  ['/', homeView, 'home'],
  ['/report', reportView, 'report'],
  ['/report/validation', validationView],
  ['/settings', settingsView, 'settings'],
  ['/settings/species/:key', speciesSettingsView],
  ['/settings/general', generalSettingsView],
  ['/settings/algorithm', algorithmView],
  ['/settings/rules', rulesView],
  ['/plant/new', plantFormView],
  ['/plant/:id', plantView],
  ['/plant/:id/edit', plantFormView],
  ['/plant/:id/capture', captureView],
  ['/plant/:id/calibrate', calibrateView],
  ['/plant/:id/roi', roiView],
  ['/plant/:id/scan', scanView],
  ['/scan/:id', scanResultView],
  ['/m/:id', resultView],
];

function match(path) {
  for (const [pattern, view, tab] of routes) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(re);
    if (m) {
      try {
        return { view, tab, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      } catch { return null; } // 잘못된 %인코딩
    }
  }
  return null;
}

/** 하위 화면이 어느 메뉴에 속하는지 (넓은 화면 사이드바에서 표시) */
const sectionOf = (path) => (path.startsWith('/report') ? 'report' : path.startsWith('/settings') ? 'settings' : 'home');

const tabbar = document.getElementById('tabbar');
const layer = document.getElementById('layer');
let cleanup = null;
let navId = 0;
let showingLogin = false;

function runCleanup() {
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch { /* 이전 화면 정리 실패는 무시 */ }
  }
  cleanup = null;
}

/**
 * 화면을 옮길 때마다 #screen 을 새 요소로 바꿉니다.
 * 이전 화면이 늦게 응답을 받아도 화면에서 떨어진 옛 요소만 고치게 되어, 지금 화면을 덮어쓰지 않아요.
 * (요소가 새로 생기므로 등장 애니메이션도 매번 다시 재생돼요)
 */
function freshScreen(className) {
  const old = document.getElementById('screen');
  const next = h('main', { id: 'screen', class: className, tabindex: '-1' });
  old.replaceWith(next);
  return next;
}

const captureNow = (() => {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try { await pickPlantAndCapture(); } catch (err) { toast(friendlyError(err), { error: true }); } finally { busy = false; }
  };
})();

function renderTabbar(active, push) {
  const tab = (key, href, label, ic) => h('a', {
    class: `tab tab-${key}`, href, 'aria-current': active === key ? 'page' : null,
  }, h('span', { class: 'tab-icon', html: icons[ic] }), h('span', { class: 'tab-label' }, label));
  tabbar.replaceChildren(
    h('a', { class: 'tab-brand', href: '#/', 'aria-label': '자람 홈' },
      h('img', { src: '/static/icons/icon.svg', alt: '' }), h('span', null, '자람')),
    tab('home', '#/', '홈', 'home'),
    h('button', { class: 'tab tab-capture', type: 'button', onclick: captureNow },
      h('span', { class: 'bubble', html: icons.camera }),
      h('span', { class: 'tab-label' }, '촬영'), h('span', { class: 'tab-label-wide' }, '사진 찍기')),
    tab('report', '#/report', '리포트', 'chart'),
    tab('settings', '#/settings', '설정', 'settings'),
  );
  tabbar.hidden = false;
  // 하위 화면에서는 휴대폰에서만 탭바를 숨기고, 넓은 화면에서는 사이드바로 계속 보여 줘요
  tabbar.classList.toggle('tabbar--push', push);
}

function errorView(screen, err, push, retry) {
  screen.replaceChildren(
    push ? topbar({ title: '' }) : null,
    h('div', { class: 'empty' },
      h('div', { class: 'art warn', html: icons.warn }),
      h('h2', null, '화면을 불러오지 못했어요'),
      h('p', null, friendlyError(err)),
      h('div', { class: 'empty-actions' },
        h('button', { class: 'btn btn-primary btn-md', type: 'button', onclick: retry }, '다시 시도'),
        push ? h('a', { class: 'btn btn-secondary btn-md', href: '#/' }, '홈으로') : null)));
}

async function router() {
  if (showingLogin) return;
  const id = ++navId;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const found = match(path) || match('/');
  runCleanup();
  closeAllSheets();
  const push = !found.tab;
  renderTabbar(found.tab || sectionOf(path), push);
  const screen = freshScreen('screen' + (push ? ' no-tab push' : ''));
  screen.setAttribute('aria-busy', 'true');
  document.documentElement.classList.remove('is-scrolled');
  window.scrollTo(0, 0);
  try {
    const result = await found.view(found.params, { screen });
    if (id !== navId) {
      // 기다리는 사이 다른 화면으로 이동함: 이 화면이 연 카메라 등을 바로 정리
      if (result && typeof result.cleanup === 'function') { try { result.cleanup(); } catch { /* 무시 */ } }
      return;
    }
    if (result && typeof result === 'object') {
      if (result.cleanup) cleanup = result.cleanup;
      if (result.className) screen.className = 'screen ' + result.className;
    }
  } catch (err) {
    if (id !== navId || (err && err.status === 401)) return; // 로그인 화면이 대신 표시됨
    if (!(err && err.userFacing)) console.error(err);
    errorView(screen, err, push, () => router());
  } finally {
    if (id === navId) screen.removeAttribute('aria-busy');
  }
}

// 앱 안에서 이동한 기록이 있을 때만 '뒤로'가 브라우저 뒤로가기로 동작하도록 표시
window.addEventListener('hashchange', () => {
  try { sessionStorage.setItem('jaram-nav', '1'); } catch { /* 저장 공간이 막혀도 이동은 계속 */ }
  router();
});

window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (!err || err.status === 401) return;
  if (!err.userFacing) console.error(err);
  toast(friendlyError(err), { error: true });
});

// 스크롤하면 상단 바에 얇은 경계선 표시
let scrollFrame = 0;
window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    document.documentElement.classList.toggle('is-scrolled', window.scrollY > 4);
  });
}, { passive: true });

// 인터넷 연결 상태 알림
window.addEventListener('offline', () => toast('인터넷 연결이 끊겼어요. 연결되면 다시 시도해 주세요.', { error: true }));
window.addEventListener('online', () => toast('인터넷에 다시 연결됐어요'));

// 로그인이 필요하면 (서버에 팀 비밀번호가 설정된 경우) 로그인 화면부터
function showLogin() {
  if (showingLogin) return;
  showingLogin = true;
  navId += 1;
  runCleanup();
  closeAllSheets();
  layer.querySelectorAll('.camera, .analyzing').forEach((el) => el.remove());
  freshScreen('screen no-tab');
  loginView(() => { showingLogin = false; router(); });
}
window.addEventListener('jaram:login-required', showLogin);

applyTheme();
api.auth()
  .then((a) => (a.required && !a.authenticated ? showLogin() : router()))
  .catch(() => router());
