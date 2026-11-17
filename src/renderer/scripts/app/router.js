// ============================================================
// Lumina · 路由
// 不引路由库：location.hash + 一个 renderPage()。
// 每个页面模块导出 mount(ctx) → { destroy }，切换时先销毁上一页的 DOM 与观察器。
// ============================================================

import { fill } from '../core/dom.js';
import { closeMenu } from '../ui/overlays/menu.js';
import { closeDialog } from './dialog.js';
import { S } from './state.js';
import * as shell from './shell.js';

const pages = new Map();
const scrollMemo = new Map();

let current = null; // { destroy }
let stack = [];
let cursor = -1;
let currentHash = '';
let suppressHash = false;

export function register(name, mod) {
  pages.set(name, mod);
}

function normalize(route = {}) {
  const page = pages.has(route.page) ? route.page : 'home';
  return {
    page,
    view: route.view ?? (page === 'albums' ? 'albums' : 'all'),
    tab: route.tab ?? 'waterfall',
  };
}

export function toHash(route) {
  const r = normalize(route);
  if (r.page === 'albums') {
    if (!r.view || r.view === 'albums') return '#/albums';
    return `#/albums/${r.view.split('/').map(encodeURIComponent).join('/')}`;
  }
  if (r.page === 'discover') return `#/discover/${r.tab || 'waterfall'}`;
  return `#/${r.page}`;
}

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  if (!raw) return normalize({ page: 'home' });
  const [head, ...rest] = raw.split('/');
  if (head === 'albums') {
    const view = rest.length ? rest.map(decodeURIComponent).join('/') : 'albums';
    return normalize({ page: 'albums', view });
  }
  if (head === 'discover') return normalize({ page: 'discover', tab: rest[0] || 'waterfall' });
  return normalize({ page: head });
}

/* ---------------- 挂载 / 卸载 ---------------- */

function unmount() {
  current?.destroy?.();
  current = null;
  closeMenu();
  closeDialog();
}

function mount(route) {
  unmount();

  const { stage, main } = shell.els;
  fill(stage);

  const page = pages.get(route.page) || pages.get('home');
  current = page.mount({ stage, main, go, refresh }) || {};

  shell.syncNav();

  // 回到该路由上次的滚动位置（相册之间来回跳时不丢上下文）
  const y = scrollMemo.get(toHash(route)) ?? 0;
  requestAnimationFrame(() => {
    stage.scrollTop = y;
  });
}

/* ---------------- 对外 API ---------------- */

export function go(route, { replace = false, fromHash = false } = {}) {
  const next = normalize(route);
  const hash = toHash(next);
  const prev = currentHash;

  if (prev && shell.els?.stage) scrollMemo.set(prev, shell.els.stage.scrollTop);

  if (!fromHash) {
    if (!prev || hash === prev) {
      // 同一路由：不压栈，只重挂（用于刷新数据）
    } else if (replace) {
      if (cursor >= 0) stack[cursor] = next;
      else {
        stack = [next];
        cursor = 0;
      }
    } else {
      stack = stack.slice(0, cursor + 1);
      stack.push(next);
      cursor = stack.length - 1;
    }
  } else if (cursor < 0) {
    stack = [next];
    cursor = 0;
  }

  S.route = next;
  currentHash = hash;

  if (location.hash !== hash) {
    suppressHash = true;
    location.hash = hash;
  }

  mount(next);
}

/** 重新挂载当前页（数据刷新后调用，保留滚动位置） */
export function refresh() {
  const y = shell.els?.stage?.scrollTop ?? 0;
  mount(S.route);
  requestAnimationFrame(() => {
    if (shell.els?.stage) shell.els.stage.scrollTop = y;
  });
}

export const canBack = () => cursor > 0;
export const canForward = () => cursor >= 0 && cursor < stack.length - 1;

export function back() {
  if (!canBack()) return;
  if (shell.els?.stage) scrollMemo.set(currentHash, shell.els.stage.scrollTop);
  cursor -= 1;
  const route = stack[cursor];
  S.route = route;
  currentHash = toHash(route);
  if (location.hash !== currentHash) {
    suppressHash = true;
    location.hash = currentHash;
  }
  mount(route);
}

export function forward() {
  if (!canForward()) return;
  if (shell.els?.stage) scrollMemo.set(currentHash, shell.els.stage.scrollTop);
  cursor += 1;
  const route = stack[cursor];
  S.route = route;
  currentHash = toHash(route);
  if (location.hash !== currentHash) {
    suppressHash = true;
    location.hash = currentHash;
  }
  mount(route);
}

/** 导航胶囊用的 { canBack, canForward, onBack, onForward } */
export const navState = () => ({
  canBack: canBack(),
  canForward: canForward(),
  onBack: back,
  onForward: forward,
});

/**
 * 启动路由。
 * @param {object} [initial] 首屏路由；不给就按当前 hash（空 hash → 主页）
 */
export function start(initial) {
  window.addEventListener('hashchange', () => {
    if (suppressHash) {
      suppressHash = false;
      return;
    }
    const route = parseHash(location.hash);
    if (toHash(route) === currentHash) return;
    go(route, { fromHash: true });
  });

  go(initial || parseHash(location.hash), { replace: true });
}
