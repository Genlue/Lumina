// ============================================================
// Lumina · 启动
// 顺序：注册页面 → 搭外壳 → 绑钩子 → 读图库 → 打开上次的图库。
// theme.init() 已经在 index.html 里先跑过了（必须在建 UI 之前）。
// ============================================================

import { h } from '../core/dom.js';
import { Button, Badge, Card, Empty, Spinner, toast } from '../ui/kit.js';
import { revealOnScroll } from '../core/scrollbar.js';
import { S } from './state.js';
import * as api from './api.js';
import * as shell from './shell.js';
import * as router from './router.js';
import * as session from './session.js';
import * as actions from './actions.js';
import * as materials from './materials.js';
import { emit } from './bus.js';
import { fmtDate } from './util.js';

import * as pageHome from './pages/home.js';
import * as pageLibrary from './pages/library.js';
import * as pageAlbums from './pages/albums.js';
import * as pageFavorites from './pages/favorites.js';
import * as pageDiscover from './pages/discover.js';
import * as pageTrash from './pages/trash.js';
import * as pageSettings from './pages/settings.js';

let booting = true;

/* ==========================================================================
   欢迎 / 无图库
   ========================================================================== */

function mountWelcome(ctx) {
  const page = h('div', { class: 'app-page' });
  ctx.stage.append(page);
  const detach = revealOnScroll(ctx.stage);

  // 页面名归顶栏（docs/04 §3）—— 欢迎页是「选择图库」，标题就写在这里，
  // 正文不再另起一行大标题。
  shell.pageTopbar({
    title: '选择图库',
    subtitle: '上次打开过的排在前面',
    nav: router.navState(),
  });

  const addBtn = () =>
    Button({
      label: '选择文件夹',
      variant: 'primary',
      icon: 'folder-plus',
      onClick: () => session.addProfile(),
    });

  if (!api.isDesktop) {
    page.append(
      Empty({
        icon: 'monitor',
        title: '需要 Lumina 桌面端',
        desc: '当前是浏览器预览，读不到本地图库。请用 Tauri 启动 Lumina。',
      })
    );
    return { destroy: detach };
  }

  if (booting) {
    page.append(h('div', { class: 'l-center', style: { minHeight: '40vh' } }, Spinner()));
    return { destroy: detach };
  }

  const profiles = [...S.profiles].sort((a, b) => (b.last_access || 0) - (a.last_access || 0));

  if (!profiles.length) {
    page.append(
      Empty({
        icon: 'images',
        title: '欢迎使用 Lumina',
        desc: '选一个文件夹作为图库。照片留在原地，Lumina 只负责索引、缩略图和组织。',
        action: addBtn(),
      })
    );
    return { destroy: detach };
  }

  // 一组同构的行 = 一张卡（docs/04 §4 的 CardGroup 用法）；
  // 不要每行各套一张 .c-card —— 那样圆角会一层层缩进去，且行间没有发丝线。
  page.append(
    Card({
      children: profiles.map((p) =>
        h(
          'div',
          {
            class: 'c-row c-row--interactive',
            onclick: () => (p.unavailable ? session.relocateProfile(p.id) : session.loadProfile(p.id)),
          },
          h(
            'div',
            { class: 'c-row__label' },
            p.name,
            h('span', { class: 'c-row__hint' }, p.folder_path)
          ),
          p.unavailable
            ? Badge({ label: '文件夹不可用', variant: 'danger' })
            : h('span', { class: 'c-subtitle' }, p.last_access ? fmtDate(p.last_access) : '从未打开')
        )
      ),
    }),
    h(
      'div',
      { class: 'l-row l-row--3' },
      addBtn(),
      Button({
        label: '重新定位不可用的图库',
        icon: 'move',
        variant: 'plain',
        onClick: () => {
          const bad = S.profiles.find((p) => p.unavailable);
          if (!bad) {
            toast('没有不可用的图库', { icon: 'check' });
            return;
          }
          session.relocateProfile(bad.id);
        },
      })
    )
  );

  return { destroy: detach };
}

/* ==========================================================================
   窗口焦点（红绿灯与侧栏选中态都要跟着）
   ========================================================================== */


function watchWindowFocus() {
  const sync = (f) => shell.setWindowFocused(!!f);

  // ① DOM 焦点：切换应用 / 点窗口外时一定触发，最可靠
  window.addEventListener('focus', () => sync(true));
  window.addEventListener('blur', () => sync(false));
  sync(document.hasFocus());

  // ② Tauri 的窗口事件：最小化、被别的窗口盖住时也能拿到
  const win = globalThis.__TAURI__?.window?.getCurrentWindow?.();
  if (!win) return;
  try {
    win.isFocused?.().then((f) => sync(!!f)).catch(() => {});
    win.onFocusChanged?.((e) => sync(!!e?.payload));
  } catch {
    // 旧版 API：忽略
  }
}

/* ==========================================================================
   后端事件
   ========================================================================== */

async function watchBackendEvents() {
  await api.listen('scan-progress', (p) => {
    if (!p) return;
    if (p.phase === 'scanning') shell.setStatus(`正在扫描：${p.current_dir || '…'}`);
    else if (p.phase === 'syncing') shell.setStatus('正在同步数据库…');
    else if (p.phase === 'done') shell.setStatus(`扫描完成：${p.files_found ?? 0} 张`);
  });

  await api.listen('cache-gen-progress', (p) => {
    if (!p) return;
    if (p.phase === 'running') {
      S.gen = { running: true, done: p.done || 0, total: p.total || 0 };
    } else {
      const wasRunning = S.gen.running;
      S.gen = { running: false, done: p.done || 0, total: p.total || 0 };
      api.clearThumbCache();
      if (wasRunning) {
        toast(
          p.phase === 'done'
            ? `缩略图缓存已生成（${p.total || 0} 张）`
            : `已取消生成（完成 ${p.done || 0}/${p.total || 0}）`,
          { icon: p.phase === 'done' ? 'check' : 'info' }
        );
      }
      actions.refreshCacheInfo();
    }
    emit('gen');
    shell.refreshStatus();
  });
}

/* ==========================================================================
   boot
   ========================================================================== */

export async function boot() {
  // 页面注册
  router.register('welcome', { mount: mountWelcome });
  router.register('home', pageHome);
  router.register('library', pageLibrary);
  router.register('albums', pageAlbums);
  router.register('favorites', pageFavorites);
  router.register('discover', pageDiscover);
  router.register('trash', pageTrash);
  router.register('settings', pageSettings);

  shell.build();

  // 外壳 → 应用动作
  shell.hooks.goto = (route) => {
    if (!S.profileId && route.page !== 'settings') {
      toast('先选择一个图库', { icon: 'info' });
      router.go({ page: 'welcome' });
      return;
    }
    router.go(route);
  };
  shell.hooks.openProfile = (id) => session.loadProfile(id);
  shell.hooks.addProfile = () => session.addProfile();
  shell.hooks.relocate = (id) => session.relocateProfile(id);
  shell.hooks.removeProfile = (id) => session.removeProfile(id);
  shell.hooks.onDropAlbum = (keys, folder) => actions.dropIntoAlbum(keys, folder);

  materials.startThemeWatch();
  // 窗口材质在首帧就定下来：欢迎页和应用页用同一种（系统 Acrylic / 壁纸），
  // 否则打开图库的瞬间窗口会从 10px 留边跳到贴边。
  materials.applyBackdrop();
  watchWindowFocus();

  // 全局：屏蔽浏览器右键菜单（输入框保留原生菜单）
  document.addEventListener('contextmenu', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
  });

  // 先挂欢迎页（此时显示加载态）
  router.start({ page: 'welcome' });

  if (!api.isDesktop) {
    booting = false;
    router.go({ page: 'welcome' }, { replace: true });
    return;
  }

  await watchBackendEvents();

  try {
    await session.loadProfiles();
  } catch (e) {
    booting = false;
    toast(`读取图库失败：${e.message || e}`, { icon: 'x-circle', tone: 'danger', duration: 3200 });
    router.go({ page: 'welcome' }, { replace: true });
    return;
  }

  booting = false;

  const last = session.lastUsedProfile();
  if (!last) {
    router.go({ page: 'welcome' }, { replace: true });
    return;
  }

  await session.loadProfile(last.id);

}
