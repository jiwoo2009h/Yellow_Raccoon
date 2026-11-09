// 앱 시작 + 화면 이동(해시 라우터) + 하단 탭바

import { h, icons, toast } from './ui.js';
import { applyTheme } from './theme.js';
import { homeView } from './views/home.js';
import { plantView } from './views/plant.js';
import { photoView } from './views/photo.js';
import { recordView } from './views/record.js';
import { graphView } from './views/graph.js';
import { plantFormView } from './views/plantForm.js';
import { calibrateView } from './views/calibrate.js';
import { settingsView, speciesSettingsView, generalSettingsView, algorithmView } from './views/settings.js';

// [경로, 화면, 하단 탭에서 켜질 메뉴]
const routes = [
  ['/', homeView, 'home'],
  ['/photo', photoView, 'photo'],
  ['/record', recordView, 'record'],
  ['/graph', graphView, 'graph'],
  ['/settings', settingsView, 'settings'],
  ['/settings/species/:key', speciesSettingsView],
  ['/settings/general', generalSettingsView],
  ['/settings/algorithm', algorithmView],
  ['/plant/new', plantFormView],
  ['/plant/:id', plantView, 'home'],
  ['/plant/:id/edit', plantFormView],
  ['/plant/:id/calibrate', calibrateView],
  // 예전 주소 호환
  ['/report', graphView, 'graph'],
  ['/m/:m', photoView, 'photo'],
];

const TABS = [
  ['home', '#/', '홈', 'home'],
  ['photo', '#/photo', '사진', 'camera'],
  ['record', '#/record', '기록', 'clipboard'],
  ['graph', '#/graph', '그래프', 'graph'],
  ['settings', '#/settings', '설정', 'sliders'],
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
  tabbar.replaceChildren(...TABS.map(([key, href, label, ic]) => h('a', {
    class: 'tab', href, 'aria-current': active === key ? 'page' : null,
  }, h('span', { class: 'pill', html: icons[ic] }), label)));
  tabbar.hidden = !active;
}

async function router() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const found = match(path || '/') || match('/');
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
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const result = await found.view({ ...query, ...found.params }, { screen });
    if (result && typeof result === 'object') {
      if (result.cleanup) cleanup = result.cleanup;
      if (result.className) screen.className = 'screen ' + result.className;
    }
  } catch (err) {
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
  if (e.reason && e.reason.message) toast(e.reason.message, { error: true });
});

applyTheme();
router();
