// ============================================================
// Lumina · 应用外壳
// 窗口级顶栏（红绿灯 / 收起导航 / 前进后退 + 页面名 / 右侧胶囊）
// + 导航栏（NavColumn，acrylic）+ 内容舞台。
//
// 顶栏属于**窗口**，不属于内容列（docs/04 §1）：
// 导航栏收起时内容列会变宽，顶栏如果跟着内容列走，标题会在第一帧瞬移。
// 所以顶栏挂在 .l-app 上，展开时靠标题组自己的 transform 右移。
// ============================================================

import { h } from '../core/dom.js';
import {
  NavItem,
  NavSection,
  NavGroup,
  NavColumn,
  NavInfo,
  Button,
  IconButton,
  Progress,
  TrafficLights,
  Toolbar,
  ToolbarTitle,
  NavPair,
  Capsule,
  disposeComponentTree,
  markNavMoving,
  openMenu,
} from '../ui/kit.js';
import { revealOnScroll } from '../core/scrollbar.js';
import { windowControls } from '../core/platform.js';
import { S, childAlbums, hasChildren, totalCount } from './state.js';
import { lastSegment, readDragKeys } from './util.js';

/** boot.js 注入的动作（避免 shell ←→ boot 循环 import） */
const hooks = {
  openProfile: null,
  addProfile: null,
  relocate: null,
  removeProfile: null,
  goto: null,
  onDropAlbum: null,
};

/** 相册树的展开状态：跨页面切换保留 */
const expanded = new Set();
/** 根节点的树是否展开（「相册」那一行自己的折叠开关） */
let albumsTreeOpen = true;

let els = null;
/** 顶栏与导航栏的节点引用 */
let appEl = null;
let topbarEl = null;
let navPair = null;
let leadTitle = null;
let leadSub = null;
let pillsHost = null;
let libraryChipEl = null;
let navEl = null;
let navBody = null;
let navGroupEl = null;
let footEl = null;
let statusWrap = null;
let statusText = null;
let statusBar = null;
let lightsEl = null;
let detachScroll = null;

/* ---------------- 导航选中：点击立刻染色 + 上锁 ---------------- */

let selKey = '';
let lockUntil = 0;

const KEY_OF_ROUTE = (r) => {
  if (r.page === 'albums') return r.view && r.view !== 'albums' ? `album:${r.view}` : 'albums';
  return r.page;
};

function paintSelection() {
  if (!navGroupEl) return;
  for (const item of navGroupEl.querySelectorAll('[data-navkey]')) {
    const on = item.dataset.navkey === selKey;
    item.setAttribute('aria-selected', String(on));
  }
}

/**
 * 立刻把某一项点亮，并上锁 700ms。
 * 锁内不做「按路由重算」——否则异步渲染完成后的 syncNav 会把刚点的覆盖掉。
 */
export function selectNav(key, { lock = true } = {}) {
  if (lock) lockUntil = performance.now() + 700;
  selKey = key;
  paintSelection();
}

/* ---------------- 相册树展开 ---------------- */

function ancestorsOf(path) {
  const segs = String(path || '').split('/').filter(Boolean);
  const out = [];
  let cur = '';
  for (let i = 0; i < segs.length - 1; i += 1) {
    cur = cur ? `${cur}/${segs[i]}` : segs[i];
    out.push(cur);
  }
  return out;
}

function syncExpandedFromRoute() {
  if (S.route.page !== 'albums') return;
  const view = S.route.view;
  if (!view || view === 'albums') return;
  // 祖先 + 自己都展开：选中一个相册时，它的子相册应当直接可见
  for (const a of ancestorsOf(view)) expanded.add(a);
  expanded.add(view);
}

function toggleExpanded(path, open) {
  if (open) expanded.add(path);
  else expanded.delete(path);
  rebuildNav();
}

/* ---------------- 导航栏 ---------------- */

/** 相册树是照片拖拽的落点：拖到某个相册名上就移动到那个相册 */
function wireNavDrop(nav) {
  const clear = () => nav.querySelectorAll('[data-over="1"]').forEach((el) => delete el.dataset.over);

  nav.addEventListener('dragover', (e) => {
    const item = e.target.closest('[data-navkey^="album:"]');
    if (!item) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clear();
    item.dataset.over = '1';
  });

  nav.addEventListener('dragleave', (e) => {
    if (!nav.contains(e.relatedTarget)) clear();
  });

  nav.addEventListener('drop', (e) => {
    const item = e.target.closest('[data-navkey^="album:"]');
    clear();
    if (!item) return;
    e.preventDefault();
    const folder = item.dataset.navkey.slice('album:'.length);
    const keys = readDragKeys(e);
    if (keys.length) hooks.onDropAlbum?.(keys, folder);
  });
}

function profileLabel() {
  if (!S.profileId) return '还没有图库';
  return S.profileName || lastSegment(S.profileFolder) || '未命名图库';
}

/**
 * 图库选择器：一枚文字胶囊，挂在顶栏右侧。
 * 它切的是「整个图库」，不属于任何一页 —— 所以不进导航栏（导航栏只做切页）。
 * 顺带解决一个材质问题：顶栏压在内容区上（不透明），胶囊弹的菜单有东西可采样，
 * 液态玻璃才成立；放在 acrylic 导航栏上时菜单下面是透明窗口，采不到任何东西。
 */
function libraryChip() {
  const btn = Button({
    icon: 'folder',
    label: profileLabel(),
    variant: 'plain',
    className: 'app-libchip',
    title: S.profileFolder || '选择图库文件夹',
    onClick: () => openProfileMenu(btn),
  });
  const wrap = Capsule({ children: [btn] });
  wrap.dataset.libchip = '1';
  return wrap;
}

/** 图库换了之后只改文字，不重建顶栏（避免菜单的 anchor 失效） */
export function refreshProfile() {
  const label = profileLabel();
  for (const el of document.querySelectorAll('[data-libchip] .c-btn__label')) {
    el.textContent = label;
  }
  const b = document.querySelector('[data-libchip] .c-btn');
  if (b) b.title = S.profileFolder || '选择图库文件夹';
  const sub = navEl?.querySelector('.c-navinfo__sub');
  if (sub) sub.textContent = label;
}

function openProfileMenu(anchor) {
  const items = [{ header: '图库' }];

  const sorted = [...S.profiles].sort((a, b) => (b.last_access || 0) - (a.last_access || 0));
  for (const p of sorted) {
    items.push({
      label: p.unavailable ? `${p.name}（文件夹不可用）` : p.name,
      icon: p.unavailable ? 'x-circle' : 'folder',
      checked: p.id === S.profileId,
      onClick: () => hooks.openProfile?.(p.id),
    });
  }

  items.push(
    { sep: true },
    { label: '添加图库…', icon: 'folder-plus', onClick: () => hooks.addProfile?.() }
  );

  if (S.profileId) {
    items.push(
      { label: '重新定位当前图库…', icon: 'move', onClick: () => hooks.relocate?.(S.profileId) },
      {
        label: '在资源管理器中打开',
        icon: 'external-link',
        onClick: () => globalThis.__TAURI__?.core?.invoke('open_in_explorer', { path: S.profileFolder }),
      },
      { sep: true },
      { label: '移除这个图库', icon: 'trash', danger: true, onClick: () => hooks.removeProfile?.(S.profileId) }
    );
  }

  openMenu({ anchor, items });
}

/** 导航分组：只负责分页（docs/06 ⑫）。页内分段导航属于波浪条，不进这里。 */
function buildNav() {
  const nav = NavGroup();

  const add = (item) => {
    if (item.classList.contains('c-nav__item')) item.dataset.navkey = item.dataset.navkey || '';
    nav.append(item);
    return item;
  };

  const mk = (key, opts) => {
    const el = NavItem({
      ...opts,
      onClick: () => {
        selectNav(key, { lock: true });
        opts.onClick?.();
      },
    });
    el.dataset.navkey = key;
    return el;
  };

  // 分类标题用控件库的 NavSection：它和 NavItem 共用 --nav-indent，
  // 所以标题左缘和图标左缘严格齐平。分组本身自带上方 --s-7 留白，不要另塞空隙。
  const section = (label) => add(NavSection({ label }));

  section('图库');
  add(
    mk('home', {
      icon: 'house',
      label: '主页',
      onClick: () => hooks.goto?.({ page: 'home' }),
    })
  );

  add(
    mk('library', {
      icon: 'images',
      label: '全部照片',
      count: totalCount() || null,
      onClick: () => hooks.goto?.({ page: 'library' }),
    })
  );

  add(
    mk('discover', {
      icon: 'compass',
      label: '发现',
      onClick: () => hooks.goto?.({ page: 'discover', tab: S.route.tab || 'waterfall' }),
    })
  );

  section('相册');
  const albumsRoot = mk('albums', {
    icon: 'album',
    label: '相册',
    count: S.albumFolders.length || null,
    hasChildren: S.albumFolders.length > 0,
    open: albumsTreeOpen,
    onClick: () => hooks.goto?.({ page: 'albums', view: 'albums' }),
    onToggle: (open) => {
      // 根节点的箭头只负责「显示/隐藏树」，不改变当前页
      albumsTreeOpen = open;
      rebuildNav();
    },
  });
  add(albumsRoot);

  if (S.albumFolders.length && albumsTreeOpen) {
    // 目录树：只画展开路径上的节点，深度决定缩进（NavItem 的 depth）
    const walk = (parent, depth) => {
      for (const folder of childAlbums(parent)) {
        const kids = hasChildren(folder);
        const isOpen = expanded.has(folder);
        add(
          mk(`album:${folder}`, {
            icon: kids ? 'folder-tree' : 'folder',
            label: lastSegment(folder),
            count: (S.albumImages[folder] || []).length || null,
            depth,
            hasChildren: kids,
            open: isOpen,
            onClick: () => hooks.goto?.({ page: 'albums', view: folder }),
            onToggle: (open) => toggleExpanded(folder, open),
          })
        );
        if (kids && isOpen) walk(folder, depth + 1);
      }
    };
    walk('', 1);
  }

  section('收藏');
  add(
    mk('favorites', {
      icon: 'star',
      label: '收藏',
      count: S.favoriteSet.size || null,
      onClick: () => hooks.goto?.({ page: 'favorites' }),
    })
  );

  add(
    mk('trash', {
      icon: 'trash',
      label: '回收站',
      count: S.trashCount || null,
      onClick: () => hooks.goto?.({ page: 'trash' }),
    })
  );

  // 设置也是「一个页面」，就跟其它页一起排在导航里：
  // 同样的 28px 行高、同样的选中底、选中时图标同样染成强调色。
  add(
    mk('settings', {
      icon: 'settings',
      label: '设置',
      onClick: () => hooks.goto?.({ page: 'settings' }),
    })
  );

  return nav;
}

/* ---------------- 任务状态区（空闲时不存在） ----------------
   导航栏底部不常驻「就绪 / 60 张 · 3 个相册」这类装饰性信息。
   只保留「正在做某件事」时的临时反馈：一行 11px 文案 + 4px 进度条，
   任务结束（文案回到"就绪"）就整块消失，导航栏回到干净状态。 */

let jobText = '';

export function setStatus(text) {
  jobText = !text || text === '就绪' ? '' : text;
  paintStatus();
}

/** 数据变了之后重画一次任务区（生成缩略图的进度也走这里） */
export function refreshStatus() {
  paintStatus();
}

function paintStatus() {
  if (!statusWrap) return;
  const running = !!S.gen.running;
  if (running) statusBar.set(S.gen.total ? (S.gen.done / S.gen.total) * 100 : 0);
  statusBar.style.display = running ? '' : 'none';
  const text = jobText || (running ? `生成缩略图 ${S.gen.done}/${S.gen.total}` : '');
  statusText.firstChild.textContent = text;
  const show = !!text || running;
  statusWrap.style.display = show ? '' : 'none';
  // 整条脚注一起收掉：.l-nav__foot 自带内边距，只藏内容会留下一条空白
  if (footEl) footEl.style.display = show ? '' : 'none';
}

/* ---------------- 顶栏 ---------------- */

/** 收起 / 展开导航栏：整根滑出，不是图标轨道（docs/06 ⑭） */
function toggleNav() {
  if (!appEl) return;
  // 开合期导航栏压在内容上：系统 Acrylic 压不到 webview 里的内容，
  // 必须自己补一层真模糊（见 layout.css「覆盖期材质」）。
  markNavMoving(appEl);
  const hidden = appEl.classList.toggle('l-app--nav-hidden');
  const btn = topbarEl?.querySelector('.l-chrome__toggle .c-iconbtn');
  const label = hidden ? '展开导航栏' : '收起导航栏';
  if (btn) {
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
}

function buildChrome() {
  // 窗口是无边框的（decorations: false），红绿灯是唯一的窗口按钮
  lightsEl = TrafficLights({
    focused: true,
    onClose: () => windowControls.close(),
    onMinimize: () => windowControls.minimize(),
    onZoom: () => windowControls.toggleMaximize(),
  });
  lightsEl.dataset.lights = '1';

  // 收起/展开按钮是「会移动的」按钮：展开时停在导航栏右上角，收起时滑回红绿灯右侧。
  // 它是点击事件，不是开关 —— 不给 c-iconbtn--on。
  const toggle = Capsule({
    round: true,
    className: 'l-chrome__toggle',
    children: IconButton({
      icon: 'panel-left',
      label: '收起导航栏',
      onClick: () => toggleNav(),
    }),
  });

  return [lightsEl, toggle];
}

function buildTopbar() {
  navPair = NavPair({
    canBack: false,
    canForward: false,
    onBack: () => {},
    onForward: () => {},
  });

  const titleNode = ToolbarTitle({ title: '', subtitle: '' });
  leadTitle = titleNode.querySelector('.c-title');
  leadSub = titleNode.querySelector('.c-subtitle');
  // ToolbarTitle 在没有副标题时不会建这个 span；顶栏是常驻的，
  // 后续页面可能随时补上副标题，所以这里把槽位先留出来。
  if (!leadSub) {
    leadSub = h('span', { class: 'c-subtitle' });
    titleNode.append(leadSub);
  }
  leadSub.style.display = 'none';

  topbarEl = Toolbar({
    chrome: buildChrome(),
    lead: [navPair, titleNode],
    pills: [],
  });
  topbarEl.id = 'topbar';
  // 顶栏空白处可以拖窗、双击最大化：Tauri 原生拖拽区（裸属性 = 只有点在顶栏本身才拖，
  // 点在胶囊/按钮上照常点击）。
  topbarEl.setAttribute('data-tauri-drag-region', '');

  pillsHost = topbarEl.querySelector('.c-topbar__pills');
  return topbarEl;
}

/**
 * 设置当前页的顶栏内容。
 * 顶栏是窗口级的，切页只换里面的标题与胶囊 —— 不重建整条，避免布局跳动。
 *
 * @param {object} o
 * @param {string} o.title 页面名（顶栏是唯一的页面名）
 * @param {string} [o.subtitle]
 * @param {HTMLElement[]} [o.pills] 右侧胶囊
 * @param {{canBack:boolean,canForward:boolean,onBack:Function,onForward:Function}} [o.nav]
 * @returns {{ el: HTMLElement, subEl: HTMLElement, setSubtitle: (t:string)=>void }}
 */
export function pageTopbar({ title = '', subtitle = '', pills = [], nav = {} } = {}) {
  leadTitle.textContent = title;
  leadSub.textContent = subtitle || '';
  leadSub.style.display = subtitle ? '' : 'none';

  const nextPair = NavPair({
    canBack: !!nav.canBack,
    canForward: !!nav.canForward,
    onBack: nav.onBack,
    onForward: nav.onForward,
  });
  disposeComponentTree(navPair);
  navPair.replaceWith(nextPair);
  navPair = nextPair;

  // 图库选择器排在最前：它切的是「整个图库」，是全局的，不属于任何一页。
  // 没有图库时（欢迎页）不出现 —— 那时候连切的对象都没有。
  if (S.profileId && !libraryChipEl) libraryChipEl = libraryChip();
  if (!S.profileId) libraryChipEl = null;
  // 换页前先释放上一组页面胶囊的玻璃渲染层（图库胶囊要复用，不能一起销毁）
  for (const child of [...pillsHost.children]) {
    if (child !== libraryChipEl) disposeComponentTree(child);
  }
  pillsHost.replaceChildren(...[...(libraryChipEl ? [libraryChipEl] : []), ...pills]);
  return {
    el: topbarEl,
    subEl: leadSub,
    setSubtitle(t) {
      leadSub.textContent = t || '';
      leadSub.style.display = t ? '' : 'none';
    },
  };
}

/* ---------------- 组装 ---------------- */

export function build() {
  appEl = document.getElementById('app');
  els = {
    app: appEl,
    main: document.getElementById('main'),
    stage: document.getElementById('stage'),
  };

  // 任务状态区：默认 display:none，只有扫描 / 生成缩略图时才出现（见 paintStatus）
  statusText = h('div', { class: 'app-status__line' }, '');
  statusBar = Progress({ value: 0 });
  statusWrap = h('div', { class: 'app-status' }, statusText, statusBar);
  statusWrap.style.display = 'none';

  navGroupEl = buildNav();
  wireNavDrop(navGroupEl);

  // 导航栏：头 / 可滚的中间 / 脚 三区，外加一层顶部渐进模糊（NavColumn 自带）。
  // 头部是红绿灯那一行的高度预留 —— 红绿灯在窗口顶栏里，不跟着导航栏走。
  navEl = NavColumn({
    className: 'app-nav',
    label: '主导航',
    children: [
      // 用软件自己的图标文件，不要拿字形拼一个圆底假图标 ——
      // 任务栏、窗口、导航栏必须是同一张图。
      NavInfo({
        iconSrc: './assets/icons/icon-128.png',
        title: 'Lumina',
        subtitle: profileLabel(),
      }),
      navGroupEl,
    ],
    foot: statusWrap,
  });
  navBody = navEl.body;
  footEl = navEl.querySelector('.l-nav__foot');
  navEl.dataset.nav = '1';
  els.nav = navEl;

  appEl.insertBefore(navEl, els.main);
  appEl.insertBefore(buildTopbar(), navEl);

  // 导航自己滚：滚动条改成覆盖层，左右内边距才对称
  detachScroll = revealOnScroll(navBody);

  refreshStatus();
  syncWindowChrome();
  return els;
}

/** 窗口焦点变化：红绿灯与导航栏选中图标一起收敛 */
export function setWindowFocused(focused) {
  document.documentElement.dataset.focused = focused ? '1' : '0';
  // 契约由控件自己维护（TrafficLights 写的是 "1"/"0"，与 CSS 的 [data-focused="0"] 对齐）
  lightsEl?.setFocused(focused);
}

function syncWindowChrome() {
  setWindowFocused(document.hasFocus());
}

/** 重建导航（计数、相册树、选中态一起刷新） */
export function rebuildNav() {
  if (!navGroupEl) return;
  const top = navBody ? navBody.scrollTop : 0;
  syncExpandedFromRoute();
  const next = buildNav();
  navGroupEl.replaceWith(next);
  navGroupEl = next;
  wireNavDrop(navGroupEl);
  if (navBody) navBody.scrollTop = top;

  if (performance.now() >= lockUntil) selKey = KEY_OF_ROUTE(S.route);
  paintSelection();
}

/** 路由变化后调用：重建结构 + 同步选中 */
export function syncNav() {
  rebuildNav();
  refreshProfile();
  refreshStatus();
}

export { hooks, els };
