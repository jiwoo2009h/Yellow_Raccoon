// 라이트 / 다크 / 시스템 테마

const KEY = 'jaram-theme';

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function setTheme(value) {
  try {
    if (value === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* 저장이 막혀 있어도 이번 화면에는 적용 */ }
  applyTheme(value);
}

export function applyTheme(value = getTheme()) {
  const root = document.documentElement;
  if (value === 'light' || value === 'dark') root.dataset.theme = value;
  else delete root.dataset.theme;
  updateThemeColor();
}

function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) meta.setAttribute('content', bg);
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => updateThemeColor());
