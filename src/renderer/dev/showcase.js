import { icon } from '../scripts/core/icons.js';
import { h } from '../scripts/core/dom.js';
import { theme, GLASS_SURFACES } from '../scripts/core/theme.js';
import { mountGlassSurfaces, supportsNativeGlass } from '../scripts/core/glass-lens.js';
import { GLASS_PARAM_DEFS } from '../scripts/core/glass-schema.js';
import { revealOnScroll } from '../scripts/core/scrollbar.js';
import { isDesktop, currentBackdrop } from '../scripts/core/platform.js';
import {
  Button, IconButton, Segmented, Switch, Slider, Field, SearchField, Select,
  Checkbox, RadioGroup, Card, CardGroup, Row, SectionTitle, Divider,
  NavItem, NavGroup, NavSection, NavCard, NavColumn, NavSearch, NavInfo, SectionWave,
  NavDock, NavDockItem, NavDockSep,
  MediaTile, Tile, Thumb, Badge, Empty, Spinner, Progress, ProgressRing, Skeleton,
  List, ListRow, ListHeader, Table, Tabs, TextArea, Stepper, Avatar, Chip,
  Disclosure, Breadcrumb, Dialog, confirmDialog, openPopover, closePopover, tip, Drawer, Resizer,
  Toolbar, ToolbarTitle, openMenu, toast,
  Swatches, Capsule, TopVeil, TrafficLights, NavPair, disposeComponentTree, markNavMoving,
  Inspector, OutlineItem, PropList, PropGroup, PropRow,
  TreeView, CollectionView, DataTable, Form, FormField, Combobox, NumberField,
  DatePicker, TimePicker, FilePicker, DropZone, TokenField, SplitView, Sheet,
  ToolbarOverflow, InlineMessage,
  ColorWell, RangeSlider, Pagination, StatusBar, DocumentTabs, ToolbarCustomization,
} from '../scripts/ui/kit.js';

const root = document.documentElement;
const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
theme.init();
document.documentElement.dataset.focused = '1';
const paramTheme = params.get('theme');
if (paramTheme === 'dark' || paramTheme === 'light') theme.setMode(paramTheme, { persist: false });

/* ---------------- 占位照片 ---------------- */
const photo = (a, b, seed = 0) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
      </linearGradient></defs>
      <rect width="200" height="200" fill="url(#g)"/>
      <circle cx="${120 + seed * 12}" cy="${64 - seed * 6}" r="36" fill="rgba(255,255,255,.16)"/>
      <path d="M0 150 Q 60 ${110 + seed * 8} 110 148 T 200 140 V200 H0 Z" fill="rgba(0,0,0,.18)"/>
    </svg>`
  )}`;

/* ---------------- 侧栏 ---------------- */
const sections = [
  ['buttons', '按钮', 'square-pen', '动作'],
  ['iconbuttons', '图标按钮', 'plus-circle', '动作'],
  ['segmented', '分段控件', 'columns-2', '选择与输入'],
  ['scale', '自适应尺寸', 'move', '选择与输入'],
  ['switch', '开关', 'sliders', '选择与输入'],
  ['slider', '滑块', 'minus', '选择与输入'],
  ['inputs', '输入', 'keyboard', '选择与输入'],
  ['select', '下拉选择', 'list-filter', '选择与输入'],
  ['checkbox', '复选', 'square-check', '选择与输入'],
  ['choice', '单选组', 'circle-check', '选择与输入'],
  ['textareas', '多行输入与步进', 'square-pen', '选择与输入'],
  ['tabs', '页签', 'columns-2', '导航'],
  ['appearance', '外观与强调色', 'palette', '外观与容器'],
  ['surfaces', '卡片与设置行', 'layers', '外观与容器'],
  ['nav', '导航栏', 'panel-left', '导航'],
  ['navforms', '导航栏的模块', 'panel-left', '导航'],
  ['dock', '悬浮导航栏', 'square-dashed', '导航'],
  ['crumbs', '面包屑', 'chevron-right', '导航'],
  ['inspector', '右侧栏', 'panel-left', '外观与容器'],
  ['thumb', '媒体格与内容卡', 'images', '内容'],
  ['lists', '列表与表格', 'list', '内容'],
  ['badges', '徽标', 'star', '内容'],
  ['chips', '标签片', 'sparkles', '内容'],
  ['avatar', '头像', 'sparkles', '内容'],
  ['menus', '菜单与提示', 'more', '浮层与状态'],
  ['overlays', '模态与浮层', 'layers', '浮层与状态'],
  ['resizer', '分隔条', 'move', '外观与容器'],
  ['drawer', '抽屉', 'panel-left', '浮层与状态'],
  ['states', '空状态与进度', 'loader', '浮层与状态'],
  ['disclosure', '折叠与占位', 'chevron-down', '内容'],
  ['glass', '材质对照', 'eye', '材质与窗口'],
  ['chrome', '顶栏与红绿灯', 'monitor', '材质与窗口'],
  ['tree', '树与虚拟集合', 'folder-tree', '集合与数据'],
  ['datatable', '数据表', 'columns-2', '集合与数据'],
  ['form2', '表单与校验', 'square-check', '选择与输入'],
  ['datetime', '日期与时间', 'calendar-range', '选择与输入'],
  ['filesinput', '文件与标签', 'upload', '选择与输入'],
  ['split', '分栏与流程面板', 'panel-left', '外观与容器'],
  ['messaging', '提示与溢出', 'info', '浮层与状态'],
  ['colorwell', '颜色与取色', 'palette', '选择与输入'],
  ['range', '双端区间', 'minus', '选择与输入'],
  ['pagination', '分页与状态栏', 'columns-2', '集合与数据'],
  ['doctabs', '文档页签', 'columns-2', '导航'],
  ['toolbarcustom', '工具栏自定义', 'sliders', '导航'],
];

/* ---------------- 分页 + 页内波浪条 ----------------

   侧栏只放"页面级"导航：实心 pill，点了右侧整页换掉。
   页内目录不占侧栏 —— 连续页的目录挂在右侧滚动条左边，是一排横条，
   当前那根放大并把邻近的挤开，形成波浪（见 SectionWave）。
   -------------------------------------------------------------------------- */

// 真分页：点了右侧整页换掉。导航栏只建一次，切换页面只改 aria-selected。
let sideEl = null;

const PAGES = [
  {
    id: 'components', label: '控件陈列', icon: 'square-pen',
    title: '控件陈列', subtitle: '控件与交互样例',
    wave: true,     // 连续页，开波浪条
    sections: sections.map(([id, label, , group]) => ({ id, label, group })),
  },
  {
    id: 'optics', label: '参数', icon: 'sliders',
    title: '参数', subtitle: '七块玻璃，各调各的',
    wave: false,    // 参数页是一整页，不分节
    sections: [],
  },
];

// 每个页面一个容器，同一时刻只挂一个，各自记住滚动位置
const pageEls = new Map();
const pagesHost = h('div', { class: 'demo-pages' });
for (const p of PAGES) {
  const el = h('div', { class: 'demo-page', dataset: { page: p.id } });
  pageEls.set(p.id, el);
  pagesHost.append(el);
}

let activePage = PAGES[0].id;

/** 点击后这段时间内，滚动联动不接管高亮 —— 否则平滑滚动途中会被沿途分区抢走 */
let navLockUntil = 0;
const NAV_LOCK_MS = 700;

const wave = SectionWave({
  onPick: (i) => {
    const page = PAGES.find((p) => p.id === activePage);
    const s = page?.sections[i];
    if (!s) return;
    navLockUntil = performance.now() + NAV_LOCK_MS;
    wave.setCurrent(i);
    document.getElementById(`sec-${s.id}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});

/** 判定线：分区顶边越过这条线就算"当前" */
const SPIKE = 140;

/** 按当前滚动位置反推该高亮第几根横条 —— 换页回来时要接上，不能重置成第一节 */
const pickIndex = (page) => {
  let idx = 0;
  page.sections.forEach((s, i) => {
    const el = document.getElementById(`sec-${s.id}`);
    if (el && el.getBoundingClientRect().top < SPIKE) idx = i;
  });
  return idx;
};

const activatePage = (id) => {
  const page = PAGES.find((p) => p.id === id);
  if (!page) return;
  activePage = id;
  for (const p of PAGES) {
    pageEls.get(p.id).dataset.active = p.id === id ? '1' : '0';
  }
  // 导航栏可能被重建过，所以按数据属性找，不持有节点引用
  for (const el of navHost.querySelectorAll('[data-page]')) {
    el.setAttribute('aria-selected', String(el.dataset.page === id));
  }
  dockNav?.setSelected(PAGES.findIndex((p) => p.id === id));
  // 目录跟着换页重建，当前横条按该页自己的滚动位置接上
  wave.setItems(page.sections.map((s) => ({ label: s.label })));
  wave.setCurrent(pickIndex(page));
  wave.setEnabled(!!page.wave);
  document.querySelector('.demo-main').dataset.wave = page.wave ? '1' : '0';
  document.querySelector('.c-topbar .c-title').textContent = page.title;
  document.querySelector('.c-topbar .c-subtitle').textContent = page.subtitle;
};

/* ---------------- 导航栏 ----------------
   侧边导航栏只负责**分页**。同一页里的分段导航交给右侧的波浪条，绝不进这块地方。
   导航栏里只有四样东西：搜索模块（可选）、信息模块（可选）、列表项、卡片模块。 */

const navHost = h('div', { class: 'demo-nav' });

const makePageItem = (p) => {
  const item = NavItem({
    icon: p.icon,
    label: p.label,
    selected: p.id === activePage,
    onClick: () => activatePage(p.id),
  });
  item.dataset.page = p.id;
  return item;
};

// 搜索模块：全局搜索。结果内联展开在导航栏里 —— 导航栏上不许开浮层。
const navSearch = NavSearch({
  placeholder: '搜索全部内容',
  search: (q) => {
    const kw = q.trim().toLowerCase();
    if (!kw) return [];
    return PAGES.flatMap((p) =>
      p.sections
        .filter((sec) => sec.label.toLowerCase().includes(kw))
        .slice(0, 3)
        .map((sec) => ({
          label: sec.label,
          hint: p.title,
          onPick: () => {
            activatePage(p.id);
            navLockUntil = performance.now() + NAV_LOCK_MS;
            requestAnimationFrame(() => {
              document.getElementById(`sec-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          },
        }))
    ).slice(0, 6);
  },
  onPick: (item) => item.onPick?.(),
});

navHost.append(
  navSearch,
  // 信息模块：导航栏顶部的「我是谁」。整行一个跳转目标，不是分组。
  NavInfo({
    avatar: photo('#c9b48a', '#5f7f5a', 2),
    title: 'Golden Gate',
    subtitle: '设计系统 · v3',
    onClick: () => toast('打开账户设置', { icon: 'person' }),
  }),
  NavGroup({
    children: [NavSection({ label: '页面' }), ...PAGES.map(makePageItem)],
  }),
  // 卡片模块 · 实心：整块就是一个跳转目标
  NavCard({
    variant: 'solid',
    icon: 'circle-check',
    title: '自测页',
    desc: '152 条断言，改完跑一遍',
    onClick: () => { location.href = 'selftest.html'; },
  }),
  // 卡片模块 · 半透明：容器，里面放若干跳转项（不是分组！）
  NavCard({
    title: '资源',
    children: [
      NavItem({ icon: 'list', label: '组件目录', onClick: () => { location.href = '../docs/03-components.md'; } }),
      NavItem({ icon: 'square-check', label: '设计规则', onClick: () => { location.href = '../docs/06-rules.md'; } }),
      NavItem({ icon: 'eye', label: '原型溯源', onClick: () => { location.href = '../docs/07-coverage.md'; } }),
    ],
  })
);

/* ---------------- 导航栏收起 / 展开 ----------------
   收起 = 整根消失，不是收成图标轨道。红绿灯和开关在 .l-chrome 里，位置不动。 */
/* 导航形态：side = 侧边导航栏，dock = 悬浮导航栏。
   两种形态共用同一份 PAGES —— 换的是「怎么排」，不是「有哪些页」。
   悬浮形态下侧边栏永远收着（内容整幅铺开），所以收起态是两个独立的变量，
   切换形态时不能互相污染。 */
let navForm = 'side';
let navHidden = false;   // 侧边形态的收起态
let dockHidden = false;  // 悬浮形态的收起态
let dockNav = null;

function syncNav() {
  app.dataset.navform = navForm;
  app.dataset.dockEdge = dockNav?.dataset.edge || 'left';
  if (dockEdgeCapsule) dockEdgeCapsule.style.display = navForm === 'dock' ? '' : 'none';
  // 开合前先挂覆盖期材质，否则那 380ms 里内容会原样透出来。
  // 只在状态真的变了才挂 —— syncNav 在初始化和换形态时也会被调。
  const wasHidden = app.classList.contains('l-app--nav-hidden');
  const nextHidden = navForm === 'dock' ? true : navHidden;
  if (navForm !== 'dock' && wasHidden !== nextHidden) markNavMoving(app);
  app.classList.toggle('l-app--nav-hidden', nextHidden);
  dockNav?.setHidden(navForm !== 'dock' || dockHidden);
  const btn = app.querySelector('.l-chrome__toggle .c-iconbtn');
  const hidden = navForm === 'dock' ? dockHidden : navHidden;
  if (btn) {
    const label = hidden ? '展开导航栏' : '收起导航栏';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
  requestAnimationFrame(() => wave.setCurrent(pickIndex(PAGES.find((p) => p.id === activePage))));
}

function setNavForm(form) {
  navForm = form;
  navFormSeg.set(form);
  if (form === 'side') {
    navHidden = false;
    dockHidden = false;
  }
  syncNav();
}

const toggleNav = () => {
  if (navForm === 'dock') dockHidden = !dockHidden;
  else navHidden = !navHidden;
  syncNav();
};

/* ---------------- 工具栏 ---------------- */

let maxed = false;
const traffic = TrafficLights({
  focused: true,
  maximized: false,
  onZoom: () => {
    maxed = !maxed;
    traffic.setMaximized(maxed);
  },
  onMinimize: () => toast('最小化（桌面运行时生效）', { icon: 'minus' }),
  onClose: () => toast('关闭窗口（桌面运行时生效）', { icon: 'x' }),
});

const topModeSeg = Segmented({
  value: theme.mode,
  options: [
    { value: 'light', icon: 'sun', title: '浅色' },
    { value: 'dark', icon: 'moon', title: '深色' },
    { value: 'system', icon: 'monitor', title: '跟随系统' },
  ],
  onChange: (v) => theme.setMode(v),
});

/* 停靠边开关：只在悬浮形态下出现 —— 侧边形态谈不上海拔哪边 */
const dockEdgeSeg = Segmented({
  value: 'left',
  options: [
    { value: 'left', label: '左' },
    { value: 'right', label: '右' },
    { value: 'bottom', label: '底' },
  ],
  onChange: (v) => {
    dockNav?.setEdge(v);
    app.dataset.dockEdge = v;
  },
});

/* 导航形态开关：不然悬浮导航栏只能在样张里看，体验不到 */
const navFormSeg = Segmented({
  value: 'side',
  options: [
    { value: 'side', icon: 'panel-left', title: '侧边导航栏' },
    { value: 'dock', icon: 'square-dashed', title: '悬浮导航栏' },
  ],
  onChange: (v) => setNavForm(v),
});

const dockEdgeCapsule = Capsule({ children: [dockEdgeSeg], className: 'demo-dockedge' });
dockEdgeCapsule.style.display = 'none';

/* 窗口 chrome：红绿灯 + 导航栏开关。它是顶栏的第一个 flex 子项 ——
   不是另挂一层绝对定位。所以开关一隐藏（悬浮形态），标题组会自己往前挪。 */
const chrome = [
  traffic,
  Capsule({
    round: true,
    className: 'l-chrome__toggle',
    children: IconButton({
      icon: 'panel-left',
      label: '收起导航栏',
      onClick: () => toggleNav(),
    }),
  }),
];

const toolbar = Toolbar({
  chrome,
  lead: [
    // 前进 / 后退一枚胶囊，没有选中块；右边紧跟当前页面名称
    NavPair({ canBack: true, canForward: true, onBack: () => {}, onForward: () => {} }),
    ToolbarTitle({ title: '控件库', subtitle: 'Golden Gate' }),
  ],
  pills: [
    Capsule({
      children: [navFormSeg],
    }),
    dockEdgeCapsule,
    Capsule({
      children: [topModeSeg],
    }),
    Capsule({ round: true, children: IconButton({ icon: 'search', label: '搜索' }) }),
  ],
});

const sideFoot = h(
  'div',
  { class: 'demo-foot', style: { flex: 'none', padding: '12px 14px 18px', boxShadow: 'inset 0 0.5px 0 var(--line-soft)' } },
  h('div', { class: 'demo-cap', style: { marginBottom: '8px', color: 'var(--text-secondary)' } },
    '全局外观与参数页同步；布局示例仅改局部状态'),
  Button({
    label: '去调参数',
    icon: 'sliders',
    size: 'sm',
    variant: 'tonal',
    onClick: () => activatePage('optics'),
  })
);

/* ---------------- 内容 ---------------- */
const content = h('div', { class: 'demo-stage' });

/* 说明里的 **强调** 走真 <b>：直接印出两个星号是最容易被忽略的那种脏 */
const richText = (text) =>
  String(text)
    .split('**')
    .map((part, i) => (i % 2 ? h('b', null, part) : part))
    .filter((part) => part !== '');

function sec(id, title, desc, body) {
  return h(
    'section',
    { class: 'demo-sec', id: `sec-${id}` },
    h('h2', { class: 'demo-sec__title' }, title),
    desc ? h('p', { class: 'demo-sec__desc' }, richText(desc)) : null,
    body
  );
}

const cell = (cap, node) => h('div', { class: 'demo-cell' }, h('div', { class: 'demo-cap' }, cap), node);

/* 满幅横幅：顶到窗口上沿，让顶栏下面压的是真实内容而不是壁纸 */
content.append(
  h('div', { class: 'demo-banner' },
    h('h1', { class: 'demo-banner__title' }, '控件陈列'),
    h('p', { class: 'demo-banner__desc' }, 'Golden Gate 设计系统 · 控件、交互与液态玻璃材质')
  )
);

/* 1. 按钮 */
content.append(
  sec('buttons', '按钮', '四种视觉权重：主操作、次级、无边框、破坏性。按下即缩放，不等抬起。',
    h('div', { class: 'demo-grid' },
      cell('Primary · 主操作', h('div', { class: 'demo-inline' },
        Button({ label: '导入图片', variant: 'primary' }),
        Button({ label: '处理中', variant: 'primary', disabled: true }),
      )),
      cell('Tonal · 次级', h('div', { class: 'demo-inline' },
        Button({ label: '新建相册', icon: 'folder-plus' }),
        Button({ label: '禁用', disabled: true }),
      )),
      cell('Plain · 无边框', h('div', { class: 'demo-inline' },
        Button({ label: '取消', variant: 'plain' }),
        Button({ label: '更多', variant: 'plain', icon: 'more' }),
      )),
      cell('Danger · 破坏性', h('div', { class: 'demo-inline' },
        Button({ label: '清空回收站', variant: 'danger', icon: 'trash' }),
      )),
      cell('尺寸', h('div', { class: 'demo-inline', style: { alignItems: 'center' } },
        Button({ label: '小', size: 'sm' }),
        Button({ label: '中' }),
        Button({ label: '大', size: 'lg' }),
      )),
    )
  )
);

/* 2. 图标按钮 */
content.append(
  sec('iconbuttons', '图标按钮', '工具栏与行内操作的默认形态。三档尺寸，三种权重。',
    h('div', { class: 'demo-grid' },
      cell('Plain', h('div', { class: 'demo-inline' },
        IconButton({ icon: 'search', label: '搜索' }),
        IconButton({ icon: 'sort', label: '排序' }),
        IconButton({ icon: 'info', label: '信息' }),
        IconButton({ icon: 'more', label: '更多' }),
      )),
      cell('Tonal', h('div', { class: 'demo-inline' },
        IconButton({ icon: 'grid-2x2', label: '网格', variant: 'tonal', active: true }),
        IconButton({ icon: 'list', label: '列表', variant: 'tonal' }),
      )),
      cell('状态', h('div', { class: 'demo-inline' },
        IconButton({ icon: 'star', label: '收藏' }),
        IconButton({ icon: 'star', label: '已收藏', variant: 'on' }),
        IconButton({ icon: 'trash', label: '禁用', disabled: true }),
      )),
      cell('尺寸', h('div', { class: 'demo-inline' },
        IconButton({ icon: 'check', label: '小', size: 'sm' }),
        IconButton({ icon: 'check', label: '中' }),
        IconButton({ icon: 'check', label: '大', size: 'lg' }),
      )),
    )
  )
);

/* 3. 分段控件 */
const segState = h('span', { class: 'c-badge' }, 'waterfall');
content.append(
  sec('segmented', '分段控件', '等价于单选组。选中块用强调色实心填充——深色模式下灰对灰根本看不出选没选。',
    h('div', { class: 'demo-grid' },
      cell('图标型', Segmented({
        value: 'grid',
        options: [
          { value: 'grid', icon: 'grid-2x2', title: '网格' },
          { value: 'list', icon: 'list', title: '列表' },
          { value: 'flow', icon: 'columns-2', title: '瀑布流' },
        ],
      })),
      cell('文字型', Segmented({
        value: 'waterfall',
        options: [
          { value: 'waterfall', label: '瀑布流' },
          { value: 'draw', label: '抽卡' },
          { value: 'random', label: '幻灯片' },
        ],
        onChange: (v) => (segState.textContent = v),
      })),
      cell('大号 · 页面级切换', Segmented({
        size: 'lg',
        value: 'all',
        options: [
          { value: 'all', label: '全部' },
          { value: 'fav', label: '收藏' },
          { value: 'recent', label: '最近' },
        ],
      })),
      cell('装进胶囊（尺寸自动跟上）', Capsule({ children: [
        Segmented({
          value: 'grid',
          options: [
            { value: 'grid', icon: 'grid-2x2', title: '网格' },
            { value: 'list', icon: 'list', title: '列表' },
            { value: 'flow', icon: 'columns-2', title: '瀑布流' },
          ],
        }),
      ] })),
      cell('当前值', segState),
    )
  )
);

/* 3.5 自适应尺寸 */
content.append(
  sec('scale', '自适应尺寸', '控件不在自己身上写死高度、图标和圆角，而是从容器继承一组 --ctl-* 变量。同一段代码放进任何容器都会自动对齐，不需要覆盖规则。',
    h('div', { class: 'l-stack l-stack--6' },
      h('div', { class: 'demo-grid' },
        cell('紧凑 22 / 13 / 5', h('div', { class: 'demo-inline' },
          Button({ label: '按钮', size: 'sm' }),
          Segmented({
            value: 'a',
            options: [
              { value: 'a', icon: 'grid-2x2', title: '网格' },
              { value: 'b', icon: 'list', title: '列表' },
            ],
          }),
          IconButton({ icon: 'more', label: '更多', size: 'sm' }),
        )),
        cell('默认 28 / 16 / 7', h('div', { class: 'demo-inline' },
          Button({ label: '按钮' }),
          Segmented({
            value: 'a',
            options: [
              { value: 'a', icon: 'grid-2x2', title: '网格' },
              { value: 'b', icon: 'list', title: '列表' },
            ],
          }),
          IconButton({ icon: 'more', label: '更多' }),
        )),
        cell('胶囊容器 28 / 14 / pill', h('div', { class: 'demo-inline' },
          Capsule({ children: [
            Button({ label: '按钮' }),
            Segmented({
              value: 'a',
              options: [
                { value: 'a', icon: 'grid-2x2', title: '网格' },
                { value: 'b', icon: 'list', title: '列表' },
              ],
            }),
            IconButton({ icon: 'more', label: '更多' }),
          ] }),
        )),
      ),
      CardGroup({ children: [
        Row({ label: '高度', hint: '--ctl-h 决定按钮、图标按钮、分段选项的高度；图标按钮的宽度也跟着它走', control: h('code', { class: 'demo-code' }, '--ctl-h') }),
        Row({ label: '图标', hint: '--ctl-ic 决定控件内图标的边长，几何居中由 flex 保证', control: h('code', { class: 'demo-code' }, '--ctl-ic') }),
        Row({ label: '圆角', hint: '--ctl-r 与高度成对出现：28 高配 14 半径，34 高外壳配 17', control: h('code', { class: 'demo-code' }, '--ctl-r') }),
        Row({ label: '内边距 / 间距 / 字号', hint: '同一套继承链，避免每个容器各写一份', control: h('code', { class: 'demo-code' }, '--ctl-pad · --ctl-gap · --ctl-fs') }),
      ] })
    )
  )
);

/* 4. 开关 */
const swState = h('span', { class: 'c-badge' }, 'on');
content.append(
  sec('switch', '开关', '立即生效的操作。拇指在按下时会轻微拉伸，松手回弹。',
    h('div', { class: 'demo-grid' },
      cell('关', Switch({ checked: false })),
      cell('开', Switch({ checked: true })),
      cell('带反馈', h('div', { class: 'demo-inline' },
        Switch({ checked: true, onChange: (v) => (swState.textContent = v ? 'on' : 'off') }),
        swState,
      )),
    )
  )
);

/* 5. 滑块 */
const sliderVal = h('span', { class: 'c-badge', id: 'slider-val' }, '60');
const glassDemoOut = h('span', { class: 'c-badge' }, `${Math.round(theme.glass * 100)}%`);
const glassSliderDemo = Slider({
  min: 0, max: 100, value: Math.round(theme.glass * 100), notched: true,
  marks: ['超透明', '中', '饱和'],
  onInput: (v) => { theme.setGlass(v / 100); glassDemoOut.textContent = `${v}%`; },
});
content.append(
  sec('slider', '滑块', '按住时放大到两倍：交互膜（若启用）90ms 淡出、背景模糊同步收到 0，后景仍由 SDF 位移贴图弯折；松手后按既有曲线恢复。',
    h('div', { class: 'l-stack l-stack--6', style: { maxWidth: '560px' } },
      h('div', { class: 'l-stack l-stack--2' },
        h('div', { class: 'demo-cap' }, '普通 · 局部示例，即时值见下方'),
        Slider({ min: 0, max: 100, value: 60, onInput: (v) => (sliderVal.textContent = v) }),
      ),
      h('div', { class: 'l-stack l-stack--2' },
        h('div', { class: 'demo-cap' }, '带刻度 · 全局 Liquid Glass 通透度（与参数页同步）'),
        glassSliderDemo,
      ),
      h('div', { class: 'l-row l-row--3' },
        h('span', { class: 'demo-cap' }, '普通滑块局部值'), sliderVal,
        h('span', { class: 'demo-cap' }, '全局通透度'), glassDemoOut),
    )
  )
);

/* 6. 输入 */
content.append(
  sec('inputs', '输入', '默认沉在界面里，聚焦时才浮起来：底色转为实心白并加上焦点环。',
    h('div', { class: 'demo-grid' },
      cell('文本框', Field({ placeholder: '相册名称' })),
      cell('带图标', Field({ placeholder: '搜索标签', icon: 'search' })),
      cell('搜索框（聚焦会展开）', SearchField({ placeholder: '搜索图片' })),
      cell('只读数值', Field({ value: '1,284 张', type: 'text' })),
    )
  )
);

/* 7. 下拉 */
content.append(
  sec('select', '下拉选择', '点击后在锚点下方展开，越界自动翻转。菜单是 L3 材质，比它盖住的表面更重。',
    h('div', { class: 'demo-grid' },
      cell('排序', Select({
        width: '170px',
        value: 'date-desc',
        options: [
          { value: 'date-desc', label: '最新优先' },
          { value: 'date-asc', label: '最旧优先' },
          { value: 'name-asc', label: '名称 A→Z' },
          { value: 'name-desc', label: '名称 Z→A' },
        ],
      })),
      cell('视图密度', Select({
        width: '150px',
        value: 'm',
        options: [
          { value: 's', label: '小图' },
          { value: 'm', label: '中图' },
          { value: 'l', label: '大图' },
        ],
      })),
    )
  )
);

/* 8. 复选 */
const cbState = h('span', { class: 'c-badge' }, '2 项已选');
content.append(
  sec('checkbox', '复选', '整行都是热区：点框、点文字都能切换，且只切换一次。',
    h('div', { class: 'l-stack l-stack--3' },
      Checkbox({ checked: true, label: '包含子相册', onChange: () => {} }),
      Checkbox({ checked: false, label: '只显示原图' }),
      h('div', { class: 'l-row l-row--3', style: { marginTop: '6px' } }, cbState),
    )
  )
);

/* 8.5 单选组 */
const radioState = h('span', { class: 'c-badge' }, 'auto');
content.append(
  sec('choice', '单选组', '复选是「可以多选」，单选是「必须选一个」。语义不同就不共用外观：圆的、选中是实心点。',
    h('div', { class: 'demo-grid' },
      cell('纵向', RadioGroup({
        value: 'auto',
        options: [
          { value: 'auto', label: '自动' },
          { value: 'manual', label: '手动' },
          { value: 'off', label: '关闭' },
        ],
        onChange: (v) => { radioState.textContent = v; },
      })),
      cell('横向', RadioGroup({
        inline: true,
        value: 'day',
        options: [
          { value: 'day', label: '浅色' },
          { value: 'night', label: '深色' },
        ],
      })),
      cell('当前值', radioState),
    )
  )
);

/* 8.6 多行输入与步进 */
const stepperOut = h('span', { class: 'c-badge' }, '3');
const stepperField = Field({ value: '3', width: '56px' });
const stepperV = Stepper({
  value: 3,
  min: 0,
  max: 12,
  onChange: (v) => {
    stepperField.set(String(v));
    stepperOut.textContent = String(v);
  },
});

content.append(
  sec('textareas', '多行输入与步进', '多行输入和单行共用一套材质与聚焦环，⌘↵ 提交、单 ↵ 换行。步进器按 NSStepper 复刻：两枚小箭头叠在一颗小井里，贴在数值右边。',
    h('div', { class: 'demo-grid' },
      cell('多行输入', TextArea({
        rows: 3,
        placeholder: '写点什么…',
        onEnter: () => toast('已提交', { icon: 'check' }),
      })),
      cell('步进器 · NSStepper', h('div', { class: 'demo-inline', style: { gap: '4px' } },
        stepperField,
        stepperV,
      )),
      cell('横排变体 · 工具栏', h('div', { class: 'demo-inline' },
        Stepper({ orientation: 'horizontal', value: 3, min: 0, max: 12 }),
      )),
      cell('到达下界', h('div', { class: 'demo-inline', style: { gap: '4px' } },
        Field({ value: '0', width: '56px' }),
        Stepper({ value: 0, min: 0, max: 10 }),
      )),
      cell('当前值', stepperOut),
    )
  )
);

/* 8.7 页签 */
content.append(
  sec('tabs', '页签', '按 macOS 文档页签复刻（Safari / 终端那一排）：一条浅色轨道，选中那颗抬起来，关闭钮长在页签里。和分段控件的分工是——分段换「看法」，页签换「对象」。',
    h('div', { class: 'l-stack l-stack--7' },
      h('div', { style: { maxWidth: '520px' } }, Tabs({
        value: 'overview',
        tabs: [
          { value: 'overview', label: '概览' },
          { value: 'activity', label: '活动' },
          { value: 'settings', label: '设置' },
        ],
      })),
      h('div', { style: { maxWidth: '520px' } }, Tabs({
        closable: true,
        value: 'a',
        tabs: [
          { value: 'a', label: '未命名 1' },
          { value: 'b', label: '未命名 2' },
          { value: 'c', label: '未命名 3' },
        ],
        onClose: (v) => toast(`关闭 ${v}`, { icon: 'x' }),
      })),
      h('div', { style: { maxWidth: '520px' } }, Tabs({
        className: 'c-tabs--plain',
        value: 'all',
        tabs: [
          { value: 'all', label: '全部' },
          { value: 'unread', label: '未读', icon: 'circle-check' },
        ],
      })),
    )
  )
);

/* 9. 外观与强调色：全局项与参数页共用 theme；材质切换仅是局部示例。 */
const demoNote = h('div', { class: 'demo-cap', style: { color: 'var(--text-tertiary)' } },
  '外观、强调色、阴影、线宽和通透度是真实全局设置；侧栏材质仅演示局部选中态。');

const appearanceDemo = Segmented({
  value: theme.mode,
  options: [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
    { value: 'system', label: '跟随系统' },
  ],
  onChange: (v) => theme.setMode(v),
});

const backdropOut = h('span', { class: 'c-badge' }, currentBackdrop());
const backdropDemo = Segmented({
  value: currentBackdrop(),
  options: [
    { value: 'system', label: '系统 Acrylic' },
    { value: 'css', label: 'CSS 玻璃' },
  ],
  onChange: (v) => { backdropOut.textContent = v; },
});

const accentDemo = Swatches({
  value: theme.accent, multi: false,
  onChange: (hex) => theme.setAccent(hex),
});
const strokeDemoOut = h('span', { class: 'c-subtitle', style: { width: '48px', textAlign: 'right', flex: 'none' } }, `${theme.stroke.toFixed(2)}px`);
const strokeSliderDemo = Slider({
  min: 0.6, max: 2.2, step: 0.05, value: theme.stroke, marks: ['细', '标准', '粗'],
  onInput: (v) => { theme.setStroke(v); strokeDemoOut.textContent = `${v.toFixed(2)}px`; },
});
const shadowDemoOut = h('span', { class: 'c-subtitle', style: { width: '48px', textAlign: 'right', flex: 'none' } }, `${Math.round(theme.shadow * 100)}%`);
const shadowSliderDemo = Slider({
  min: 0, max: 160, step: 5, value: Math.round(theme.shadow * 100), marks: ['无', '标准', '重'],
  onInput: (v) => { theme.setShadow(v / 100); shadowDemoOut.textContent = `${v}%`; },
});

content.append(
  sec('appearance', '外观与强调色', '全局外观与参数页实时同步；唯一例外是下方明确标注的侧栏材质局部示例。',
    h('div', { class: 'l-stack l-stack--7', style: { maxWidth: '560px' } },
      CardGroup({ children: [
        Row({ label: '外观', control: appearanceDemo }),
        Row({
          label: '强调色',
          hint: 'macOS 系统色盘；最后一格是自定义',
          stack: true,
          control: accentDemo,
        }),
        Row({
          label: '侧栏材质 · 局部示例',
          hint: `${isDesktop ? '桌面运行时可另接系统 Acrylic；' : '浏览器预览只能使用 CSS 玻璃；'}此处只切换示例选中态，即时值：`,
          control: h('div', { class: 'l-row l-row--3' }, backdropDemo, backdropOut),
        }),
      ] }),
      CardGroup({
        title: '描边与阴影',
        children: [
          Row({
            label: '图标线条',
            hint: '所有尺寸的图标共用同一条物理线宽，不随图标大小缩放',
            stack: true,
            control: h('div', { class: 'l-row l-row--3', style: { width: '100%' } },
              h('div', { class: 'l-fill' }, strokeSliderDemo),
              strokeDemoOut),
          }),
          Row({
            label: '浓度',
            hint: '全局乘算：窗口、卡片、菜单、胶囊、滑块都挂在这一个系数上',
            stack: true,
            control: h('div', { class: 'l-row l-row--3', style: { width: '100%' } },
              h('div', { class: 'l-fill' }, shadowSliderDemo),
              shadowDemoOut),
          }),
          Row({
            label: '真的想改',
            hint: '外观、强调色、阴影、线宽、七块玻璃的光学参数，全在「参数」页',
            control: Button({
              label: '打开参数页',
              icon: 'sliders',
              size: 'sm',
              variant: 'tonal',
              onClick: () => activatePage('optics'),
            }),
          }),
        ],
      }),
      CardGroup({
        title: '液态玻璃 · 七块玻璃各一套参数',
        children: [
          Row({
            label: '参数口径',
            hint: 'band / amount / depth / dispersion / vibrancy / coating / stroke / falloff / light',
            control: Badge({ label: 'DeskCanvas LiquidGlassParams', variant: 'accent' }),
          }),
          Row({
            label: '各面独立',
            hint: '顶栏、侧栏、胶囊、菜单、提示条、模态、滑块拇指互不影响；想统一就显式「完整复制到全部」',
            control: Badge({ label: '8 个材质面' }),
          }),
        ],
      }),
      demoNote
    )
  )
);

/* 9. 卡片与设置行：这里全部是局部示例，不冒充全局设置。 */
const demoLocalOut = (text) => h('span', {
  class: 'c-subtitle',
  style: { width: '48px', flex: 'none', textAlign: 'right' },
}, text);
const demoSegOut = demoLocalOut('中');
const demoSize = Segmented({
  value: 'm',
  options: [
    { value: 's', label: '小' },
    { value: 'm', label: '中' },
    { value: 'l', label: '大' },
  ],
  onChange: (v) => { demoSegOut.textContent = { s: '小', m: '中', l: '大' }[v]; },
});
const demoBlurOut = demoLocalOut('16px');
const demoBlur = Slider({
  min: 0, max: 50, value: 16,
  onInput: (v) => { demoBlurOut.textContent = `${v}px`; },
});
const demoWidthOut = demoLocalOut('224px');
const demoWidth = Slider({
  min: 190, max: 340, value: 224,
  onInput: (v) => { demoWidthOut.textContent = `${v}px`; },
});
content.append(
  sec('surfaces', '卡片与设置行', '设置页的基本单元。下列「局部示例」只演示控件本身和即时值，不读写全局主题；全局设置请去参数页。',
    h('div', { style: { maxWidth: '540px' } },
      CardGroup({ children: [
        Row({ label: '缩略图大小 · 局部示例', control: h('div', { class: 'l-row l-row--3' }, demoSize, demoSegOut) }),
        Row({
          label: '面板模糊 · 局部示例',
          hint: '示例即时值；不修改任何真实面板',
          control: h('div', { class: 'l-row l-row--3', style: { width: '180px' } }, demoBlur, demoBlurOut),
        }),
        Row({
          label: '侧栏宽度 · 局部示例',
          hint: '示例即时值；不改当前窗口布局',
          control: h('div', { class: 'l-row l-row--3', style: { width: '180px' } }, demoWidth, demoWidthOut),
        }),
        Row({
          label: '在资源管理器中打开',
          control: Button({ label: '打开', size: 'sm', icon: 'external-link' }),
        }),
      ] }),
    )
  )
);

/* 10. 导航栏（列表式） */
content.append(
  sec('nav', '导航栏', '导航栏不是「侧栏」的同义词 —— 列表式只是它最常见的一种形态。选中只染图标，文字始终是黑/白。',
    h('div', { style: { maxWidth: '240px', padding: '0 0 6px', borderRadius: '10px', background: 'var(--surface-sunken)' } },
      NavGroup({ children: [
        NavSection({ label: '收件箱' }),
        NavItem({ icon: 'house', label: '收件箱', badge: '12', selected: true }),
        NavItem({ icon: 'star', label: '已加星标', count: '3' }),
        NavItem({ icon: 'clock', label: '稍后处理' }),
        NavSection({ label: '项目' }),
        NavItem({ icon: 'folder', label: 'Golden Gate', count: '48', hasChildren: true, open: true }),
        NavItem({ icon: 'folder', label: '设计稿', depth: 1, count: '12' }),
        NavItem({ icon: 'folder', label: '文档', depth: 1 }),
        NavSection({ label: '归档' }),
        NavItem({ icon: 'hard-drive', label: '本地存档' }),
        NavItem({ icon: 'trash', label: '废纸篓', count: '4' }),
      ] }),
    )
  )
);

/* 10.5 导航栏的模块 */
const navSample = (cap, node) =>
  h('div', { class: 'demo-navcell' },
    h('div', { class: 'demo-cap' }, cap),
    node
  );

const demoSearch = NavSearch({
  placeholder: '搜索全部内容',
  search: (q) => {
    const kw = q.trim().toLowerCase();
    if (!kw) return [];
    return [
      { label: '滑块', hint: '控件陈列' },
      { label: '分段控件', hint: '控件陈列' },
      { label: '材质参数', hint: '参数' },
    ].filter((it) => it.label.toLowerCase().includes(kw));
  },
});

content.append(
  sec('navforms', '导航栏的模块', '侧边导航栏只有四样东西：搜索模块（可选）、信息模块（可选）、列表项、卡片模块。卡片是**模块**，不是一种排布方式 —— 它的作用只有一个：跳转。同一页里的分段导航不在这里，交给右侧波浪条。',
    h('div', { class: 'demo-navstage' },
      navSample('搜索模块 · 全局搜索，结果内联展开', NavColumn({
        veil: false,
        style: { '--nav-head-h': '0px' },
        children: [demoSearch, NavGroup({ children: [
          NavSection({ label: '页面' }),
          NavItem({ icon: 'square-pen', label: '控件陈列', selected: true }),
          NavItem({ icon: 'sliders', label: '参数' }),
        ] })],
      })),

      navSample('列表项 · 分类标题分组', NavColumn({
        veil: false,
        style: { '--nav-head-h': '0px' },
        children: [NavGroup({ children: [
          NavSection({ label: '资料库' }),
          NavItem({ icon: 'house', label: '首页', selected: true }),
          NavItem({ icon: 'clock', label: '最近添加', count: '12' }),
          NavItem({ icon: 'heart', label: '收藏' }),
        ] })],
      })),

      navSample('信息模块 · 头像 + 名称 + 副标题', NavColumn({
        veil: false,
        style: { '--nav-head-h': '0px' },
        children: [
          NavInfo({
            avatar: photo('#c9b48a', '#5f7f5a', 2),
            title: '小 Q',
            subtitle: 'Apple 账户',
          }),
          NavInfo({
            stack: [photo('#e8a0a8', '#7c3550', 0), photo('#7ea6d8', '#2c3f6e', 1), photo('#9fd2b5', '#2f6b52', 2)],
            title: '家人共享',
          }),
          NavGroup({ children: [
            NavItem({ icon: 'person', label: '账户' }),
            NavItem({ icon: 'cloud', label: 'iCloud' }),
            NavItem({ icon: 'users', label: '家人共享' }),
          ] }),
        ],
      })),

      navSample('信息模块 · 应用图标 + 名称', NavColumn({
        veil: false,
        style: { '--nav-head-h': '0px' },
        children: [
          NavInfo({
            icon: 'sliders',
            iconBg: '#5b8def',
            title: '参数',
            subtitle: '应用设置',
          }),
          NavGroup({ children: [
            NavItem({ icon: 'palette', label: '外观', selected: true }),
            NavItem({ icon: 'layers', label: '材质' }),
            NavItem({ icon: 'move', label: '度量' }),
          ] }),
        ],
      })),

      navSample('卡片模块 · 实心（整卡跳转）', NavColumn({
        veil: false,
        style: { '--nav-head-h': '0px' },
        children: [
          NavGroup({ children: [
            NavSection({ label: '页面' }),
            NavItem({ icon: 'house', label: '首页', selected: true }),
          ] }),
          NavCard({
            variant: 'solid',
            icon: 'sparkles',
            title: '新发现',
            desc: '本周精选的 24 个控件',
          }),
          NavCard({
            variant: 'solid',
            tone: 'neutral',
            icon: 'download',
            title: '更新到 v4',
            desc: '材质系统重写',
          }),
        ],
      })),

      navSample('卡片模块 · 半透明（容器，内含跳转项）', NavColumn({
        veil: false,
        style: { '--nav-head-h': '0px' },
        children: [
          NavGroup({ children: [
            NavSection({ label: '页面' }),
            NavItem({ icon: 'house', label: '首页', selected: true }),
          ] }),
          NavCard({
            title: '资源',
            children: [
              NavItem({ icon: 'list', label: '组件目录' }),
              NavItem({ icon: 'square-check', label: '设计规则' }),
              NavItem({ icon: 'eye', label: '原型溯源' }),
            ],
          }),
        ],
      })),
    )
  )
);

/* 10.6 悬浮导航栏 */
const dockMock = () => h('div', { class: 'demo-dockmock' }, h('span'), h('span'), h('span'), h('span'), h('span'));

const dockSample = (cap, edge, node) =>
  h('div', { class: 'demo-dockcell' },
    h('div', { class: 'demo-cap' }, cap),
    h('div', { class: 'demo-dockstage' }, dockMock(), node)
  );

const dockItems = (n) => [
  NavDockItem({ icon: 'house', label: '首页', selected: true }),
  NavDockItem({ icon: 'search', label: '搜索' }),
  NavDockItem({ icon: 'play', label: '媒体库' }),
  NavDockItem({ icon: 'star', label: '收藏' }),
  NavDockItem({ icon: 'clock', label: '最近' }),
  ...(n > 5 ? [NavDockSep(), NavDockItem({ icon: 'sun', label: '外观' }), NavDockItem({ icon: 'settings', label: '设置' })] : [NavDockSep(), NavDockItem({ icon: 'settings', label: '设置' })]),
];

content.append(
  sec('dock', '悬浮导航栏', '侧边导航栏的另一种形态：一根浮在内容上的玻璃药丸，里面是一颗颗圆钮。**它是液态玻璃，不是 acrylic** —— 贴壁纸的长期占位走磨砂，浮在内容上的临时层走玻璃。可停靠左 / 右 / 底，悬浮时显示按钮名。',
    h('div', { class: 'demo-dockrow' },
      dockSample('左侧停靠 · 竖排 + 脚注圆钮', 'left', NavDock({
        edge: 'left',
        children: dockItems(6),
        foot: NavDockItem({ icon: 'rotate-ccw', label: '重做' }),
      })),
      dockSample('右侧停靠 · 提示往左长', 'right', NavDock({
        edge: 'right',
        children: dockItems(6),
      })),
      dockSample('底部停靠 · 横排', 'bottom', NavDock({
        edge: 'bottom',
        children: dockItems(5),
      })),
    )
  )
);

/* 10.7 面包屑 */
content.append(
  sec('crumbs', '面包屑', '层级比页签深、比导航栏浅的地方用它：当前路径一行说完，不占一列。',
    h('div', { class: 'l-stack l-stack--7' },
      Breadcrumb({ items: [
        { label: '项目', icon: 'folder' },
        { label: 'Golden Gate' },
        { ellipsis: true },
        { label: 'components.html' },
      ] }),
      Breadcrumb({ items: [
        { label: '根目录', icon: 'hard-drive' },
        { label: '设计系统' },
        { label: '控件' },
      ] }),
    )
  )
);

/* 10.8 右侧栏 */
const demoOutline = h('div', { class: 'c-outline' },
  OutlineItem({ label: '安装', level: 1, active: true }),
  OutlineItem({ label: '从源码构建', level: 2 }),
  OutlineItem({ label: '依赖', level: 3 }),
  OutlineItem({ label: '常见问题', level: 2 }),
  OutlineItem({ label: '许可', level: 1 })
);

const demoProps = PropList({ children: [
  PropGroup({ title: '统计', children: [
    PropRow({ label: '字数', value: '1,204' }),
    PropRow({ label: '阅读时长', value: '约 3 分钟' }),
  ] }),
  PropGroup({ title: '位置', children: [
    PropRow({ label: '路径', value: 'Notes/设计/液态玻璃.md', mono: true }),
  ] }),
] });

const demoInspector = Inspector({
  views: [
    { id: 'outline', label: '大纲', node: demoOutline },
    { id: 'info', label: '信息', node: demoProps },
  ],
  value: 'outline',
  onCollapse: () => toast('收起（示例）'),
  label: '大纲与信息',
});

content.append(
  sec('inspector', '右侧栏', '外壳只有视图切换和收起按钮；里面放什么由视图决定 —— 大纲、属性、AI 面板都只是它的一个视图。',
    h('div', { class: 'l-row l-row--7', style: { alignItems: 'flex-start' } },
      h('div', {
        style: {
          width: '280px',
          height: '340px',
          borderRadius: '10px',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card)',
          background: 'var(--surface-sunken)',
        },
      }, demoInspector)
    )
  )
);

/* 11. 媒体格与内容卡 */
content.append(
  sec('thumb', '媒体格与内容卡', '格子不知道里面放的是照片还是应用 —— 媒体格只画图，内容卡多两行字。相册只是它们的一个用例。',
    h('div', { class: 'l-stack l-stack--7' },
      h('div', { class: 'demo-thumbs' },
        MediaTile({ src: photo('#f3b27a', '#8a4b6b', 0) }),
        MediaTile({ src: photo('#7ea6d8', '#2c3f6e', 1), selected: true }),
        MediaTile({ src: photo('#9fd2b5', '#2f6b52', 2), multi: true }),
        MediaTile({ src: photo('#e8a0a8', '#7c3550', 3), fav: true }),
      ),
      h('div', { class: 'demo-tiles' },
        Tile({ media: { icon: 'folder' }, title: '设计系统', subtitle: '24 项' }),
        Tile({ media: { icon: 'layers' }, title: '组件库', subtitle: '控件与交互', selected: true }),
        Tile({ media: { icon: 'image' }, title: '素材', subtitle: '1,284 张' }),
        Tile({ media: { icon: 'download' }, title: '下载', subtitle: '已完成' }),
      ),
    )
  )
);

/* 11.5 列表与表格 */
const MAIL = [
  { id: 'inbox', icon: 'house', title: '收件箱', subtitle: 'Golden Gate 团队 · 12 个会话', meta: '12' },
  { id: 'star', icon: 'star', title: '已加星标', subtitle: '3 个会话', meta: '3' },
  { id: 'draft', icon: 'square-pen', title: '草稿', subtitle: '上次编辑于昨天 18:20', meta: '1' },
  { id: 'trash', icon: 'trash', title: '废纸篓', subtitle: '30 天后自动清空', meta: '4' },
];
let listActive = 'inbox';
const listHost = h('div', { class: 'l-stack l-stack--3', style: { maxWidth: '380px' } });
const paintList = () => {
  listHost.replaceChildren(
    ListHeader('邮箱'),
    List({
      variant: 'inset',
      children: MAIL.map((m) =>
        ListRow({
          icon: m.icon,
          title: m.title,
          subtitle: m.subtitle,
          meta: m.meta,
          chevron: true,
          selected: listActive === m.id,
          onClick: () => { listActive = m.id; paintList(); },
        })
      ),
    })
  );
};
paintList();

const FILES = [
  { name: 'components.html', kind: 'HTML', size: 168, date: '11-02 15:43' },
  { name: 'kit.js', kind: 'JavaScript', size: 78, date: '11-02 15:49' },
  { name: 'components.css', kind: 'CSS', size: 62, date: '11-02 15:41' },
  { name: 'tokens.css', kind: 'CSS', size: 9, date: '11-01 20:06' },
  { name: 'README.md', kind: 'Markdown', size: 9, date: '11-02 13:59' },
];
let fileSort = { key: 'name', dir: 'asc' };
const tableHost = h('div');
const paintTable = () => {
  const rows = [...FILES].sort((a, b) => {
    const va = a[fileSort.key];
    const vb = b[fileSort.key];
    const r = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'zh');
    return fileSort.dir === 'asc' ? r : -r;
  });
  tableHost.replaceChildren(
    Table({
      sort: fileSort,
      onSort: (s) => { fileSort = s; paintTable(); },
      columns: [
        { key: 'name', label: '名称', sortable: true },
        { key: 'kind', label: '类型', width: '96px' },
        { key: 'size', label: '大小', width: '80px', align: 'right', sortable: true },
        { key: 'date', label: '修改日期', width: '112px', align: 'right' },
      ],
      rows,
      rowKey: (r) => r.name,
      selectedKey: 'components.html',
      onSelect: (r) => toast(`选中 ${r.name}`, { icon: 'check' }),
      dense: true,
    })
  );
};
paintTable();

content.append(
  sec('lists', '列表与表格', '列表是「一条一条读」，表格是「一列一列比」。这套库以前只有照片格子，任何非相册的页面都得手写列表 —— 这是最大的泛化缺口。',
    h('div', { class: 'demo-grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } },
      cell('列表 · inset 分组', listHost),
      cell('表格 · 可排序', Card({ children: h('div', { style: { padding: '2px 0 6px' } }, tableHost) })),
    )
  )
);

/* 12. 徽标 */
content.append(
  sec('badges', '徽标', '只承载数字或极短状态，绝不放句子。',
    h('div', { class: 'demo-inline' },
      Badge({ label: '1,284' }),
      Badge({ label: '12.4 GB' }),
      Badge({ label: '已同步', variant: 'accent', icon: 'circle-check' }),
      Badge({ label: '4 项待清理', variant: 'danger' }),
    )
  )
);

/* 12.5 标签片 */
const chipRow = h('div', { class: 'demo-inline' });
const CHIPS = ['设计', '前端', '文档', '待评审'];
let chipOn = new Set(['设计']);
const paintChips = () => {
  chipRow.replaceChildren();
  for (const c of CHIPS) {
    chipRow.append(Chip({
      label: c,
      selected: chipOn.has(c),
      onClick: () => {
        chipOn.has(c) ? chipOn.delete(c) : chipOn.add(c);
        paintChips();
      },
    }));
  }
};
paintChips();

content.append(
  sec('chips', '标签片', '徽标是「只读的状态」，标签片是「可操作的对象」：能点、能选、能删。',
    h('div', { class: 'l-stack l-stack--7' },
      h('div', { class: 'demo-inline' },
        Chip({ label: '只读' }),
        Chip({ label: '带图标', icon: 'star' }),
        Chip({ label: '小号', size: 'sm', icon: 'check' }),
        Chip({ label: '可删除', removable: true, onRemove: () => toast('已移除', { icon: 'x' }) }),
      ),
      chipRow,
    )
  )
);

/* 12.6 头像 */
content.append(
  sec('avatar', '头像', '有图用图，没图用首字：中文取首字，西文取首字母缩写。方形头像的圆角按边长比例给，换尺寸不跑形。',
    h('div', { class: 'demo-inline', style: { gap: '16px' } },
      Avatar({ name: '林', size: 'sm' }),
      Avatar({ name: '林知远' }),
      Avatar({ name: 'Ada Lovelace', size: 'lg' }),
      Avatar({ name: 'Grace Hopper', size: 'xl', square: true }),
      Avatar({ name: '陈', status: 'online' }),
      Avatar({ name: '周', status: 'busy' }),
      Avatar({ name: '吴', status: 'away' }),
    )
  )
);

/* 13. 菜单与提示 */
const menuBtn = Button({ label: '打开菜单', icon: 'more' });
menuBtn.addEventListener('click', () => {
  openMenu({
    anchor: menuBtn,
    items: [
      { header: '视图' },
      { label: '网格', icon: 'grid-2x2', key: '⌘1', checked: true, onClick: () => toast('已切到网格', { icon: 'check' }) },
      { label: '列表', icon: 'list', key: '⌘2', onClick: () => toast('已切到列表', { icon: 'list' }) },
      { sep: true },
      { label: '在资源管理器中打开', icon: 'external-link', onClick: () => toast('正在打开…', { icon: 'folder-open' }) },
      { label: '从回收站移除', icon: 'trash', danger: true, onClick: () => toast('需要确认', { icon: 'info' }) },
    ],
  });
});

content.append(
  sec('menus', '菜单与提示', '菜单从锚点长出、回锚点收起；提示条从底部淡起，新的压上来时旧的那条会被弹簧顶开。',
    h('div', { class: 'demo-inline' },
      menuBtn,
      Button({ label: '发一条提示', variant: 'plain', onClick: () => toast('已加入收藏', { icon: 'heart' }) }),
      Button({ label: '错误提示', variant: 'plain', onClick: () => toast('无法读取该文件', { icon: 'x-circle', tone: 'danger' }) }),
      Button({
        label: '连发三条',
        variant: 'plain',
        onClick: () => {
          // 间隔 260ms，能看清下面两条被顶上去的过程
          ['正在读取 1284 张照片', '已生成缩略图', '导入完成'].forEach((m, i) =>
            setTimeout(() => toast(m, { icon: 'check' }), i * 260)
          );
        },
      }),
    )
  )
);

/* 13.5 模态与浮层 */
const dlgBtn = Button({
  label: '打开对话框',
  icon: 'square-pen',
  onClick: () => {
    let ctl;
    ctl = Dialog({
      title: '重命名项目',
      desc: '名称会同步给所有协作者，历史记录保留 30 天。',
      icon: 'square-pen',
      body: Field({ value: 'Golden Gate', width: '100%' }),
      actions: [
        Button({ label: '取消', variant: 'plain', onClick: () => ctl.close() }),
        Button({ label: '保存', variant: 'primary', onClick: () => { ctl.close(); toast('已保存', { icon: 'check' }); } }),
      ],
    });
  },
});

// 二级弹窗：从一级对话框里再开一层。它盖在上面、四周压暗，下面那层变暗并 inert。
const subBtn = Button({
  label: '二级弹窗',
  icon: 'layers',
  onClick: () => {
    let lvl1 = null;
    let lvl2 = null;

    const openLevel2 = () => {
      lvl2 = Dialog({
        title: '再确认一次',
        desc: '这一层压在刚才那个对话框上。按 Esc 或点遮罩只会关掉这一层，下面的「导出项目」还在。',
        icon: 'info',
        width: '300px',
        actions: [
          Button({ label: '返回', variant: 'plain', onClick: () => lvl2.close() }),
          Button({
            label: '开始导出',
            variant: 'primary',
            onClick: () => {
              lvl2.close();
              lvl1.close();
              toast('已开始导出', { icon: 'download' });
            },
          }),
        ],
      });
    };

    lvl1 = Dialog({
      title: '导出项目',
      desc: '先选格式；下一步再挑位置。',
      icon: 'download',
      body: RadioGroup({
        value: 'pdf',
        options: [
          { value: 'pdf', label: 'PDF 文档' },
          { value: 'html', label: 'HTML 单页' },
        ],
      }),
      actions: [
        Button({ label: '取消', variant: 'plain', onClick: () => lvl1.close() }),
        Button({ label: '下一步…', variant: 'primary', onClick: openLevel2 }),
      ],
    });
  },
});

const dangerBtn = Button({
  label: '删除…',
  variant: 'danger',
  icon: 'trash',
  onClick: async () => {
    const ok = await confirmDialog({
      title: '删除这个项目？',
      desc: '其中的 48 个文件会一起移到废纸篓，30 天后永久删除。',
      confirmLabel: '删除',
      tone: 'danger',
    });
    toast(ok ? '已移到废纸篓' : '已取消', { icon: ok ? 'trash' : 'info' });
  },
});

const popBtn = Button({ label: '弹出浮层', icon: 'sliders' });
popBtn.addEventListener('click', () => {
  if (popBtn.dataset.open === '1') {
    closePopover();
    return;
  }
  popBtn.dataset.open = '1';
  openPopover({
    anchor: popBtn,
    width: 250,
    onClose: () => { delete popBtn.dataset.open; },
    content: h('div', { class: 'l-stack l-stack--4' },
      h('div', { class: 'c-section' }, '视图'),
      Row({ label: '显示导航栏', control: Switch({ checked: true }) }),
      Row({ label: '紧凑密度', control: Switch({ checked: false }) }),
    ),
  });
});

const tipBtn = IconButton({ icon: 'info', label: '悬停看提示' });
tip(tipBtn, '悬停 0.4 秒才出现，比 title 快，也能换行');

content.append(
  sec('overlays', '模态与浮层', '模态是「必须先回答」（L4 + 遮罩），浮层是「顺带看一眼」（同样 L4，但不拦人）。**二级弹窗**在已有模态上再压一层：四周继续压暗、下面那层变暗并失去交互，Esc 和点遮罩都只关最上面一层。',
    h('div', { class: 'demo-inline' }, dlgBtn, subBtn, dangerBtn, popBtn, tipBtn)
  )
);

/* 13.6 抽屉 */
const drawerStage = h(
  'div',
  { class: 'demo-drawer-stage' },
  h(
    'div',
    { class: 'demo-drawer-stage__ghost' },
    h('div', { class: 'demo-drawer-stage__title' }, '最近打开'),
    h('div', { class: 'demo-drawer-stage__hint' }, '把灰条往上拖，或者点一下')
  )
);

let drawerCtl = null;
const mountDrawer = (side) => {
  drawerCtl?.dispose();
  drawerCtl = Drawer({
    side,
    peek: 28,
    size: side === 'left' || side === 'right' ? '66%' : '62%',
    label: '最近打开',
    children: [
      h(
        'div',
        { class: 'demo-drawer-list' },
        ['欢迎使用 Inkdown', 'Markdown 语法速查', '周会纪要 · 11 月 3 日'].map((t, i) =>
          ListRow({
            title: t,
            subtitle: i === 0 ? '2 分钟前' : i === 1 ? '昨天' : '3 天前',
            icon: 'file-text',
            onClick: () => toast(`打开 ${t}`, { icon: 'file-text' }),
          })
        )
      ),
    ],
  });
  drawerStage.append(drawerCtl);
};
mountDrawer('bottom');

const drawerSide = Segmented({
  options: [
    { value: 'bottom', label: '下' },
    { value: 'left', label: '左' },
    { value: 'top', label: '上' },
    { value: 'right', label: '右' },
  ],
  value: 'bottom',
  size: 'sm',
  onChange: (v) => mountDrawer(v),
});

const drawerToggle = Button({
  label: '展开 / 收起',
  variant: 'plain',
  size: 'sm',
  onClick: () => drawerCtl?.toggle(),
});

/* 13.7 分隔条 */
const rzStage = h('div', { class: 'demo-resizer-stage', style: { '--demo-w': '200px' } });
const rzLeftPane = h('div', { class: 'demo-resizer-pane' }, '拖右边这条缝 →');
const rzRightPane = h('div', { class: 'demo-resizer-pane' }, '← 也可以拖回来');
let rzW = 0;

const rz = Resizer({
  axis: 'x',
  label: '调整分栏宽度',
  className: 'demo-resizer',
  onDelta(dx, phase) {
    if (phase === 'start' || phase === 'key') rzW = rzLeftPane.getBoundingClientRect().width;
    const w = Math.max(140, Math.min(360, rzW + dx));
    rzLeftPane.style.flexBasis = `${Math.round(w)}px`;
    rzStage.style.setProperty('--demo-w', `${Math.round(w)}px`);
  },
  onReset() {
    rzLeftPane.style.flexBasis = '';
    rzStage.style.setProperty('--demo-w', '200px');
  },
});

rzStage.append(rzLeftPane, rz, rzRightPane);

content.append(
  sec(
    'resizer',
    '分隔条',
    '栏与栏之间那条 9px 的缝。命中区 9px、视觉只有 1px，平时完全透明。拖动跟手，方向键按 16px 步进，双击复位。',
    rzStage
  )
);

content.append(
  sec(
    'drawer',
    '抽屉',
    '贴边拉出的面板：只有**拉出那一侧**有圆角，另一侧和容器齐平。拉出侧留一条灰条（抓握带），点一下切换、拖一段跟手 —— 位移过中线或甩一下都能决定去向。材质是 L4 液态玻璃，和模态同一档。',
    h(
      'div',
      { class: 'demo-stack' },
      h('div', { class: 'demo-inline' }, drawerSide, drawerToggle),
      drawerStage
    )
  )
);

/* 14. 空状态与进度 */
const prog = Progress({ value: 34 });
content.append(
  sec('states', '空状态与进度', '空状态要解释「为什么空」和「下一步做什么」，不只写一句话。',
    h('div', { class: 'demo-grid' },
      h('div', { class: 'demo-cell', style: { gridColumn: 'span 2' } },
        h('div', { class: 'demo-cap' }, '空状态'),
        h('div', { style: { border: '0.5px solid var(--line)', borderRadius: '12px' } },
          Empty({
            title: '这里还什么都没有',
            desc: '拖入文件，或选择一个文件夹开始。',
            action: Button({ label: '选择文件夹', variant: 'primary', size: 'sm' }),
          })
        )
      ),
      cell('进度', h('div', { class: 'l-stack l-stack--3', style: { paddingTop: '8px' } },
        prog,
        h('div', { class: 'l-row l-row--3' }, Spinner(), h('span', { class: 'c-subtitle' }, '正在生成缩略图 34 / 100')),
      )),
      cell('加载中', h('div', { class: 'demo-inline' }, Spinner(), h('span', { class: 'c-subtitle' }, '扫描中…'))),
    )
  )
);

/* 14.5 折叠与占位 */
content.append(
  sec('disclosure', '折叠与占位', '折叠区用 grid-template-rows 0fr→1fr 做高度动画，不用量 scrollHeight，内容换了高度也不会算错。骨架屏只在「已经知道大概长什么样」时用。',
    h('div', { class: 'demo-grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } },
      cell('折叠区', h('div', null,
        Disclosure({
          title: '高级选项',
          hint: '2 项',
          open: true,
          children: h('div', { class: 'l-stack l-stack--4' },
            Row({ label: '保留原始文件', control: Switch({ checked: true }) }),
            Row({ label: '生成缩略图', control: Switch({ checked: false }) }),
          ),
        }),
        Disclosure({
          title: '网络',
          children: h('div', { class: 'l-stack l-stack--4' },
            Row({ label: '离线可用', control: Switch({ checked: false }) }),
          ),
        })
      )),
      cell('骨架屏', h('div', { class: 'l-stack l-stack--4' },
        h('div', { class: 'l-row l-row--4' },
          Skeleton({ width: '40px', height: '40px', circle: true }),
          h('div', { class: 'l-fill l-stack l-stack--3' },
            Skeleton({ width: '70%' }),
            Skeleton({ width: '45%' }),
          )
        ),
        Skeleton({ lines: 3 }),
      )),
      cell('环形进度', h('div', { class: 'demo-inline' },
        ProgressRing({ value: 68, size: 'lg' }),
        ProgressRing({ value: 32 }),
        ProgressRing({ value: 92 }),
      )),
    )
  )
);

/* 15. 材质对照 */
const spec = (name, cls, specText) =>
  h('div', { class: cls },
    h('div', { class: 'demo-glasscard__name' }, name),
    h('div', { class: 'demo-glasscard__spec' }, specText)
  );

content.append(
  sec('glass', '材质对照', '导航栏是 acrylic（磨砂 + 提饱和 + 染色，没有折射）；其余是液态玻璃，越大的表面越厚。两种材质不混用。',
    h('div', { class: 'l-stack l-stack--6' },
      h('div', { class: 'demo-glassstage' },
        spec('L1 chrome', 'c-glass-chrome', '工具栏 · 最轻'),
        spec('Acrylic', 'c-acrylic', '导航栏 · 磨砂，无折射'),
        spec('L3 popover', 'c-glass-sheet', '菜单 · 较重'),
        spec('L4 sheet', 'c-glass-sheet c-glass-edge', '模态 · 最重 + 高光边'),
      ),
      h('div', { class: 'l-row l-row--3' },
        Button({
          label: '去玻璃参数页', icon: 'sliders', size: 'sm',
          onClick: () => activatePage('optics'),
        }),
        h('span', { class: 'demo-cap' }, '8 个材质面分开调（7 块玻璃 + 1 块 acrylic），调完直接导出 CSS')
      )
    )
  )
);

/* 16. 顶栏与红绿灯 */
const tl = (opts) =>
  h('div', { style: { height: '30px', display: 'flex', alignItems: 'center' } }, TrafficLights(opts));

const focusBtn = Button({
  label: '模拟窗口失焦',
  variant: 'plain',
  size: 'sm',
  onClick: () => {
    const nowUnfocused = document.documentElement.dataset.focused === '0';
    const nextFocused = nowUnfocused;
    document.documentElement.dataset.focused = nextFocused ? '1' : '0';
    traffic.setFocused(nextFocused);
    focusBtn.querySelector('.c-btn__label').textContent = nextFocused
      ? '模拟窗口失焦'
      : '恢复聚焦';
  },
});

content.append(
  sec('chrome', '顶栏与红绿灯', '依 aw3r1se/macOS-traffic-lights：14pt 圆、28 单位栅格、外层 r14 深色描边。悬停才出图形，按下整组加深，失焦统一深灰。',
    h('div', { class: 'l-stack l-stack--7' },
      h('div', { class: 'l-row l-row--3' },
        h('div', { class: 'demo-cap' }, '失焦时，红绿灯与侧栏强调色一起收回'),
        h('div', { class: 'l-push' }, focusBtn)
      ),
      h('div', { class: 'demo-grid' },
        cell('默认（无图形）', tl({})),
        cell('悬停（三灯显形）', tl({ reveal: true })),
        cell('按下（整组加深）', tl({ reveal: true, active: true })),
        cell('未保存修改', tl({ dirty: true })),
        cell('窗口失焦', tl({ focused: false })),
      ),
      h('div', { class: 'l-stack l-stack--3' },
        h('div', { class: 'demo-cap' }, '细节 4× ：圆、描边、图形比例与系统一致'),
        h('div', { class: 'l-row l-row--7', style: { height: '70px', alignItems: 'center' } },
          h('div', { style: { transform: 'scale(4)', transformOrigin: 'left center' } }, TrafficLights({ reveal: true })),
          h('div', { style: { width: '240px' } }),
          h('div', { style: { transform: 'scale(4)', transformOrigin: 'left center' } }, TrafficLights({ reveal: true, active: true })),
        )
      ),
      h('div', { class: 'l-stack l-stack--3' },
        h('div', { class: 'demo-cap' }, '胶囊组合 · 工具栏就是这几颗拼起来的'),
        h('div', {
          class: 'demo-glassstage',
          style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '16px', borderRadius: '14px' },
        },
          NavPair({ canBack: true, canForward: true }),
          Capsule({ children: [
            Segmented({
              value: 'grid',
              options: [
                { value: 'grid', icon: 'grid-2x2', title: '网格' },
                { value: 'list', icon: 'list', title: '列表' },
              ],
            }),
          ] }),
          Capsule({ children: [IconButton({ icon: 'more', label: '更多' })] }),
          Capsule({ round: true, children: IconButton({ icon: 'search', label: '搜索' }) }),
        )
      )
    )
  )
);

/* ---------------- 集合与数据 ---------------- */

const treeDemo = TreeView({
  label: '项目文件',
  expandedKeys: ['src', 'src/ui'],
  nodes: [
    { id: 'src', label: 'src', icon: 'folder', children: [
      { id: 'src/ui', label: 'ui', icon: 'folder', children: [
        { id: 'ui/button', label: 'button.js', icon: 'file-text' },
        { id: 'ui/list', label: 'list.js', icon: 'file-text' },
        { id: 'ui/tree', label: 'tree-view.js', icon: 'file-text' },
      ] },
      { id: 'src/main', label: 'main.js', icon: 'file-text' },
      { id: 'src/kit', label: 'kit.js', icon: 'file-text' },
    ] },
    { id: 'docs', label: 'docs', icon: 'folder', children: [
      { id: 'docs/audit', label: '10-completeness-audit.md', icon: 'file-text' },
      { id: 'docs/rules', label: '06-rules.md', icon: 'file-text' },
    ] },
    { id: 'readme', label: 'README.md', icon: 'file-text' },
  ],
  onActivate: (key) => toast(`打开 ${key}`, { icon: 'file-text' }),
});
treeDemo.style.height = '228px';

const collectionItems = Array.from({ length: 1200 }, (_, i) => ({
  id: i,
  label: `素材 ${String(i + 1).padStart(4, '0')}`,
}));
const collectionOut = h('span', { class: 'c-badge' }, '0 项已选');
const collectionDemo = CollectionView({
  label: '素材集合',
  items: collectionItems,
  layout: 'grid',
  itemHeight: 72,
  itemWidth: 118,
  gap: 6,
  renderItem: (item, { selected }) =>
    h('div', { class: 'demo-swatchcard', dataset: { selected: selected ? '1' : '0' } },
      h('span', { class: 'demo-swatchcard__dot' }),
      h('span', { class: 'demo-swatchcard__label' }, item.label)),
  onSelectionChange: (keys) => { collectionOut.textContent = `${keys.length} 项已选`; },
});
collectionDemo.style.height = '228px';

content.append(
  sec('tree', '树与虚拟集合', '层级资源用 TreeView（→ 展开 / 进子级，← 收起 / 回父级）；平铺的大集合用 CollectionView —— 一千两百项只渲染窗口内的十几行，滚动位置与焦点都不会丢。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('TreeView · 键盘与异步加载', treeDemo),
      cell('CollectionView · 窗口化网格', h('div', { class: 'l-stack l-stack--3' }, collectionDemo, h('div', { class: 'l-row l-row--3' }, collectionOut, h('span', { class: 'demo-cap' }, '↑↓←→ / Space / Enter'))))
    ))
);

const tableRows = Array.from({ length: 40 }, (_, i) => ({
  id: `row-${i}`,
  name: ['设计稿', '接口文档', '周会纪要', '发布清单', '预算表'][i % 5] + ` ${i + 1}`,
  kind: ['目录', '文档', '表格'][i % 3],
  size: ((i * 37) % 900) + 12,
  modified: `11-${String((i % 28) + 1).padStart(2, '0')}`,
}));
const tableOut = h('span', { class: 'c-badge' }, '0 行已选');
const dataTableDemo = DataTable({
  label: '最近文件',
  columns: [
    { key: 'name', label: '名称', width: 220, sortable: true },
    { key: 'kind', label: '类型', width: 90 },
    { key: 'size', label: '大小', width: 90, align: 'right', sortable: true },
    { key: 'modified', label: '修改', width: 90, sortable: true },
  ],
  rows: tableRows,
  sort: { key: 'name', dir: 'asc' },
  multiple: true,
  resizable: true,
  editable: true,
  onCellEdit: ({ column, row, value }) => toast(`${row.name} · ${column.label} → ${value}`),
  onSelectionChange: (keys) => { tableOut.textContent = `${keys.length} 行已选`; },
});
dataTableDemo.style.height = '300px';

content.append(
  sec('datatable', '数据表', '列模型、排序、列宽拖动、二维键盘与单元格编辑都在一张表里。表头冻结，虚拟化按固定行高开窗；双击单元格或按 Enter 进入编辑，Enter 提交、Esc 取消。',
    h('div', { class: 'l-stack l-stack--3' },
      h('div', { class: 'l-row l-row--3' }, tableOut, h('span', { class: 'demo-cap' }, '拖列右缘改宽 · 双击单元格编辑')),
      dataTableDemo))
);

/* ---------------- 表单 ---------------- */

const projectName = Field({ placeholder: '例如：金门计划' });
const projectOwner = Field({ placeholder: 'you@example.com' });
const projectBudget = NumberField({ value: 1200, min: 0, max: 99999, step: 100, unit: '元' });
const budgetStandalone = NumberField({ value: 42.5, min: -100, max: 100, step: 0.5, precision: 1 });
const projectKind = Combobox({
  label: '类型',
  placeholder: '输入筛选，或选一项',
  options: [
    { value: 'design', label: '设计' },
    { value: 'doc', label: '文档' },
    { value: 'sheet', label: '表格' },
  ],
});
const formOut = h('span', { class: 'c-badge' }, '未提交');
const projectForm = Form({
  label: '新建项目',
  submitLabel: '保存',
  cancelLabel: '重置',
  onCancel: () => { projectForm.reset(); formOut.textContent = '已重置'; },
  onSubmit: (values) => { formOut.textContent = `已保存 ${Object.keys(values).length} 个字段`; },
  children: [
    FormField({
      id: 'gg-project-name',
      label: '名称',
      required: true,
      hint: '显示在窗口标题上',
      control: projectName,
      validate: (v) => (String(v).trim() ? null : '名称不能为空'),
    }),
    FormField({
      id: 'gg-project-owner',
      label: '负责人邮箱',
      control: projectOwner,
      validate: (v) => (String(v).includes('@') ? null : '需要一个邮箱地址'),
    }),
    FormField({ id: 'gg-project-kind', label: '类型', control: projectKind }),
    FormField({ id: 'gg-project-budget', label: '预算', layout: 'inline', labelWidth: '64px', control: projectBudget, hint: '↑↓ 按 100 元走，失焦才提交' }),
  ],
});

content.append(
  sec('form2', '表单与校验', '标签必须真的关联到 input：label[for] 指错，读屏和点击都会失效。校验分「失焦」「输入」「提交」三种时机，异步结果用版本号防覆盖；错误同时给图标、文案和描边，不只靠颜色。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('Form + FormField', h('div', { class: 'l-stack l-stack--5', style: { maxWidth: '380px' } }, projectForm, h('div', { class: 'l-row l-row--3' }, formOut))),
      cell('NumberField · 草稿与提交', h('div', { class: 'l-stack l-stack--4', style: { maxWidth: '220px' } },
        budgetStandalone,
        h('div', { class: 'demo-cap' }, '中间态（减号、1.）不会被吞；↑↓ 按 0.5 走，Shift ×10。'))))
    )
);

/* ---------------- 日期与时间 ---------------- */

const dateOut = h('span', { class: 'demo-cap' }, '值：2026-11-06');
const dateDemo = DatePicker({
  value: '2026-11-06',
  label: '截止日期',
  clearable: true,
  onChange: (v) => { dateOut.textContent = `值：${v || '（未选）'}`; },
});
const timeDemo = TimePicker({
  value: '09:30',
  label: '开始时间',
  step: 15,
  onChange: (v) => { dateOut.textContent = `值：${dateDemo.value() || '（未选）'} ${v}`; },
});

content.append(
  sec('datetime', '日期与时间', '日期只存 YYYY-MM-DD，时间只存 HH:mm —— 不经过 Date 的时区换算，也就不会在跨时区时前移一天。键盘网格：←→ 天、↑↓ 周、PageUp/PageDown 月、Enter 选择、Esc 收起。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('DatePicker', h('div', { class: 'l-stack l-stack--4', style: { maxWidth: '260px' } }, dateDemo, dateOut)),
      cell('TimePicker', h('div', { class: 'l-stack l-stack--4', style: { maxWidth: '260px' } }, timeDemo, h('div', { class: 'demo-cap' }, '↑↓ 步进 · PageUp/Down 小时 · 数字键直输'))))
    )
);

/* ---------------- 文件与标签 ---------------- */

const fileOut = h('span', { class: 'c-badge' }, '未选择');
const fileDemo = FilePicker({
  label: '选择图片',
  accept: 'image/*',
  multiple: true,
  maxFiles: 6,
  maxSize: 8 * 1024 * 1024,
  onFiles: (files) => { fileOut.textContent = `${files.length} 个文件`; },
  onError: (errors) => toast(errors[0].message, { tone: 'danger', icon: 'triangle-alert' }),
});
const dropDemo = DropZone({
  label: '把设计资源拖到这里',
  hint: '支持图片与 PDF，单个不超过 8 MB',
  accept: 'image/*,.pdf',
  maxFiles: 8,
  maxSize: 8 * 1024 * 1024,
  onFiles: (files) => { fileOut.textContent = `${files.length} 个文件`; },
  onError: (errors) => toast(errors[0].message, { tone: 'danger', icon: 'triangle-alert' }),
});
const tokenDemo = TokenField({
  label: '标签',
  placeholder: '输入后回车',
  tokens: [{ value: 'design', label: '设计' }, { value: 'frontend', label: '前端' }],
  suggest: async (q) => [
    { value: 'design', label: '设计' },
    { value: 'frontend', label: '前端' },
    { value: 'docs', label: '文档' },
  ].filter((o) => o.label.includes(q.trim())),
  onChange: (tokens) => { fileOut.textContent = `${tokens.length} 个标签`; },
});

content.append(
  sec('filesinput', '文件与标签', '文件入口必须同时有「拖」和「选」两条路，并且键盘能到。标签输入的分词只发生在输入法组合结束之后 —— 中文选词时按回车不会把半个词变成一个标签。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('FilePicker + DropZone', h('div', { class: 'l-stack l-stack--4' }, h('div', { class: 'l-row l-row--4' }, fileDemo, fileOut), dropDemo)),
      cell('TokenField', h('div', { class: 'l-stack l-stack--4' }, tokenDemo, h('div', { class: 'demo-cap' }, 'Backspace 两阶段：先选中，再删除'))))
    )
);

/* ---------------- 分栏与流程面板 ---------------- */

const splitDemo = SplitView({
  label: '三栏工作区',
  panes: [
    { id: 'side', min: 120, max: 260, size: 160, node: h('div', { class: 'demo-pane' }, '导航栏') },
    { id: 'main', min: 200, max: Infinity, size: 360, node: h('div', { class: 'demo-pane' }, '主内容') },
    { id: 'aside', min: 120, max: 280, size: 180, collapsible: true, node: h('div', { class: 'demo-pane' }, '检查器') },
  ],
});
splitDemo.style.height = '200px';

const openSheet = () => {
  const nameInput = Field({ placeholder: '新项目名称' });
  Sheet({
    title: '新建项目',
    description: '这是一个窗口归属的流程层：不是把抽屉换个位置。',
    body: h('div', { class: 'l-stack l-stack--5' },
      FormField({ id: 'gg-sheet-name', label: '名称', required: true, control: nameInput }),
      h('div', { class: 'demo-cap' }, '提交中 Esc / 点遮罩都关不掉；内容改动后也不会静默丢弃。')),
    submitLabel: '创建',
    onSubmit: async () => {
      await new Promise((r) => setTimeout(r, 700));
      toast('项目已创建', { icon: 'check' });
    },
  });
};

content.append(
  sec('split', '分栏与流程面板', 'SplitView 管的是真实尺寸而不是位移：拖动时相邻两栏互相补偿，最小/最大值有约束，收起后保留上次尺寸。Sheet 是流程层 —— 有标题栏、可滚动正文和固定动作区，提交中可以拒绝关闭。',
    h('div', { class: 'l-stack l-stack--5' },
      splitDemo,
      h('div', { class: 'l-row l-row--4' },
        Button({ label: '打开 Sheet', icon: 'layers', onClick: openSheet }),
        h('span', { class: 'demo-cap' }, '双击分隔条复位 · ←→ 微调 · Home/End 到极限')))
    )
);

/* ---------------- 提示与溢出 ---------------- */

const overflowItems = [
  { id: 'new', label: '新建', priority: 10, node: Button({ label: '新建', icon: 'plus' }) },
  { id: 'import', label: '导入', priority: 8, node: Button({ label: '导入', icon: 'arrow-up-from-line' }) },
  { id: 'export', label: '导出', priority: 6, node: Button({ label: '导出', icon: 'download' }) },
  { id: 'share', label: '共享', priority: 4, node: Button({ label: '共享', icon: 'external-link' }) },
  { id: 'history', label: '历史', priority: 2, node: Button({ label: '历史', icon: 'clock' }) },
];
const overflowDemo = ToolbarOverflow({ items: overflowItems, label: '文件操作' });
overflowDemo.style.width = '300px';

content.append(
  sec('messaging', '提示与溢出', '持续的错误留在任务旁边（InlineMessage），一次性的成功才用 toast。工具栏按优先级把放不下的动作收进「更多」，收进去的仍能从菜单里用键盘访问。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('InlineMessage · 三种语气', h('div', { class: 'l-stack l-stack--3' },
        InlineMessage({ tone: 'info', title: '已切换到离线模式', description: '改动会先存在本地，联网后再同步。' }),
        InlineMessage({ tone: 'warning', title: '这个文件被其他应用占用', description: '关闭对方后再试，或另存为副本。' }),
        InlineMessage({ tone: 'danger', title: '同步失败', description: '服务器返回 409：远端版本已更新。', actions: [{ label: '重试', onClick: () => toast('正在重试') }] }))),
      cell('ToolbarOverflow · 300px 容器', h('div', { class: 'demo-toolbar-stage' }, overflowDemo)))
    )
);

/* ---------------- 颜色与取色 ---------------- */

const colorReadout = h('span', { class: 'c-badge' }, '#0A84FF');
const colorWell = ColorWell({
  value: '#0a84ff',
  label: '强调色',
  onChange: (v) => {
    colorReadout.textContent = `${v.hex.toUpperCase()}${v.a < 1 ? ` · ${Math.round(v.a * 100)}%` : ''}`;
  },
});
const p3Well = ColorWell({
  value: { r: 255, g: 118, b: 84, a: 0.55, space: 'display-p3' },
  label: '标签色（P3，55%）',
});

content.append(
  sec('colorwell', '颜色与取色', '颜色是数据，不是一段 hex：色空间与 alpha 必须能表达。颜色井点开就是系统色盘的位置——饱和度/明度面板、色相、alpha、十六进制与 RGB 输入、预设色，以及只有浏览器真的支持时才出现的吸管。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('ColorWell · sRGB + alpha', h('div', { class: 'l-row l-row--4' }, colorWell, colorReadout)),
      cell('ColorWell · Display P3 半透明', p3Well))
  )
);

/* ---------------- 双端区间 ---------------- */

const rangeReadout = h('span', { class: 'c-badge' }, '20 – 80');
const rangeDemo = RangeSlider({
  value: [20, 80],
  showValue: true,
  ticks: 9,
  label: '价格区间',
  onInput: ([lo, hi]) => { rangeReadout.textContent = `${lo} – ${hi}`; },
});
const rangeClamp = RangeSlider({ value: [40, 60], crossing: 'clamp', step: 5, label: '夹取策略' });
const rangeSwap = RangeSlider({ value: [40, 60], crossing: 'swap', step: 5, label: '交换策略' });

content.append(
  sec('range', '双端区间', '一个轨道两个端点，两端各自有稳定的焦点与值。越过时发生什么必须显式定义：push 推着另一个走、swap 交换身份、clamp 挡住——三种都在下面，别让 clamp 变成默认的蒙混。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('RangeSlider · 拖动 / 键盘', h('div', { class: 'l-stack l-stack--4', style: { maxWidth: '360px' } },
        rangeDemo,
        h('div', { class: 'l-row l-row--3' }, rangeReadout, h('span', { class: 'demo-cap' }, 'Shift ×10 · PageUp/Down ±10%')))),
      cell('三种交叉策略', h('div', { class: 'l-stack l-stack--5', style: { maxWidth: '360px' } },
        h('div', { class: 'demo-cap' }, 'clamp · 挡住，不允许越过'), rangeClamp,
        h('div', { class: 'demo-cap' }, 'swap · 越过时交换身份'), rangeSwap)))
  )
);

/* ---------------- 分页与状态栏 ---------------- */

const pageReadout = h('span', { class: 'c-badge' }, '第 1 页 · 每页 20');
const pagerDemo = Pagination({
  page: 1,
  total: 412,
  pageSize: 20,
  label: '文件分页',
  onChange: (v) => { pageReadout.textContent = `第 ${v.page} 页 · 每页 ${v.pageSize}`; },
});
const cursorPager = Pagination({
  page: 3, mode: 'cursor', total: null, hasPrev: true, hasNext: true, compact: true, label: '日志游标分页',
});

let syncTimer = 0;
const syncTask = { id: 'sync-1', label: '同步「设计稿」', phase: 'running', progress: 0.08, cancel: true };
const statusDemo = StatusBar({
  items: [
    { id: 'count', label: '412 项' },
    { id: 'sel', icon: 'square-check', label: '已选 3 项' },
    { id: 'size', label: '18.4 GB', align: 'end' },
  ],
  tasks: [syncTask],
  label: '文件状态',
  onTaskAction: (id, action) => {
    if (action === 'cancel') {
      clearInterval(syncTimer);
      statusDemo.setTask(id, { phase: 'cancelled', progress: null, cancel: false, retry: true, detail: '已取消' });
    } else if (action === 'retry') {
      startSync();
    }
  },
});

function startSync() {
  clearInterval(syncTimer);
  const task = { id: `sync-${Date.now()}`, label: '同步「设计稿」', phase: 'running', progress: 0.06, cancel: true, detail: '' };
  statusDemo.setTasks([task]);
  syncTimer = setInterval(() => {
    const now = statusDemo.value().tasks.find((t) => t.id === task.id);
    if (!now || now.phase !== 'running') { clearInterval(syncTimer); return; }
    const next = Math.min(1, (Number(now.progress) || 0) + 0.07);
    if (next >= 1) {
      statusDemo.setTask(task.id, { phase: 'success', progress: 1, cancel: false, detail: '已完成' });
      clearInterval(syncTimer);
    } else {
      statusDemo.setTask(task.id, { progress: next, detail: `已传 ${Math.round(next * 48)} / 48 个文件` });
    }
  }, 900);
}
setTimeout(startSync, 600);

content.append(
  sec('pagination', '分页与状态栏', '分页是协议，不是皮肤：总数可能未知、条件要能进 URL、请求回来时用户可能已经翻了两页。状态栏是长任务的常驻位置——把进度塞进 toast，失败后就无处可回看。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('Pagination · 页码协议', h('div', { class: 'l-stack l-stack--5' },
        h('div', { class: 'l-row l-row--3' }, pageReadout, h('span', { class: 'demo-cap' }, '总计 412 项')),
        pagerDemo,
        h('div', { class: 'demo-cap', style: { marginTop: 'var(--s-4)' } }, '游标协议（总数未知，不能跳页）'),
        cursorPager)),
      cell('StatusBar · 任务与取消', h('div', { class: 'demo-statusbar-stage' }, statusDemo))
    )
  )
);

/* ---------------- 文档页签 ---------------- */

const docTabs = DocumentTabs({
  label: '打开的文档',
  activeId: 'readme',
  documents: [
    { id: 'readme', title: 'README.md', icon: 'file-text', dirty: true },
    { id: 'kit', title: 'kit.js', icon: 'file-text' },
    { id: 'shot', title: '材质对照.png', icon: 'image', pinned: true },
  ],
  onSelect: (id) => { if (id !== 'readme') toast(`切换到 ${id}`, { icon: 'file-text' }); },
  onNew: () => toast('新建文档（示例）', { icon: 'plus' }),
  onCloseRequest: (doc) => confirmDialog({
    title: `关闭「${doc.title}」？`,
    desc: '这份文档还有未保存的修改，关闭后修改会丢失。',
    confirmLabel: '不保存，关闭',
    cancelLabel: '继续编辑',
    tone: 'danger',
  }),
});

content.append(
  sec('doctabs', '文档页签', '文档页签不是换了皮的 Tabs：每颗都有 dirty、pinned、closable，关闭要走一次可能被拒绝的询问。固定页签排在最前、只显示图标、没有关闭钮；关掉当前页签后焦点落到右邻。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('DocumentTabs · 未保存与固定页签', h('div', { class: 'l-stack l-stack--4' },
        docTabs,
        h('span', { class: 'demo-cap' }, 'README.md 带未保存点 · 关闭会问 · 图片页签是固定的'))),
      cell('会话结构', h('div', { class: 'l-stack l-stack--3' },
        h('span', { class: 'demo-cap' }, 'serialize() 只存会话，不存文档内容：'),
        h('pre', { class: 'demo-codepane' }, JSON.stringify(docTabs.serialize(), null, 2)))))
  )
);

/* ---------------- 工具栏自定义 ---------------- */

const customItems = [
  { id: 'new', label: '新建', icon: 'plus' },
  { id: 'upload', label: '上传', icon: 'upload' },
  { id: 'share', label: '共享', icon: 'external-link' },
  { id: 'sort', label: '排序', icon: 'list-filter' },
  { id: 'filter', label: '筛选', icon: 'search', group: '查看' },
  { id: 'density', label: '紧凑', icon: 'list', group: '查看' },
];
let customPreview = null;
const customReadout = h('span', { class: 'c-badge' }, '新建 · 上传 · 共享');
const customPanel = ToolbarCustomization({
  items: customItems,
  visible: ['new', 'upload', 'share'],
  label: '自定义工具栏',
  onChange: (ids) => {
    customReadout.textContent = ids.map((id) => customItems.find((i) => i.id === id)?.label ?? id).join(' · ') || '（空）';
    paintCustom(ids);
  },
});
let customBtn;
customBtn = Button({
  label: '自定义工具栏',
  icon: 'sliders',
  onClick: () => customPanel.open(customBtn),
});

function paintCustom(ids) {
  if (!customPreview) return;
  customPreview.replaceChildren(
    ...customItems.filter((i) => ids.includes(i.id)).map((i) => Button({ label: i.label, icon: i.icon, variant: 'plain' }))
  );
  customPreview.dataset.empty = ids.length ? '0' : '1';
}
customPreview = h('div', { class: 'demo-toolbar-stage demo-toolbar-stage--tight' });
paintCustom(['new', 'upload', 'share']);

content.append(
  sec('toolbarcustom', '工具栏自定义', '溢出解决「放不下」，自定义解决「我想改」。两件事不能混：自定义决定有哪些、按什么顺序，溢出决定在当下宽度里放不放得下。面板实时生效，没有「应用 / 取消」。',
    h('div', { class: 'demo-grid demo-grid--2' },
      cell('ToolbarCustomization · 面板', h('div', { class: 'l-row l-row--4' }, customBtn, customReadout)),
      cell('自定义后的工具栏', customPreview))
  )
);

/* ---------------- 第二页：参数 ---------------- */

const opticsStage = h('div', { class: 'tune-stage' });
const opticsContent = h('div');
opticsStage.append(opticsContent);

const tuneHead = (title, desc) => h('div', { class: 'tune-head' },
  h('div', { class: 'tune-head__title' }, title),
  h('div', { class: 'tune-head__desc' }, desc));

const tuneSec = (title, desc, body) => h('section', { class: 'tune-sec' },
  h('div', { class: 'tune-sec__title' }, title),
  desc ? h('div', { class: 'tune-sec__desc' }, desc) : null,
  body);

const tuneOut = (text) => h('span', { class: 'tune-row__out' }, text);



/* —— A. 外观（全局，不属于某一块玻璃）—— */
const glassOut = tuneOut(`${Math.round(theme.glass * 100)}%`);
const glassSliderTune = Slider({
  min: 0, max: 100, value: Math.round(theme.glass * 100), notched: true,
  marks: ['超透明', '中', '饱和'],
  onInput: (v) => { theme.setGlass(v / 100); glassOut.textContent = `${v}%`; },
});

const shadowOut = tuneOut(`${Math.round(theme.shadow * 100)}%`);
const shadowSliderTune = Slider({
  min: 0, max: 160, step: 5, value: Math.round(theme.shadow * 100), marks: ['无', '标准', '重'],
  onInput: (v) => { theme.setShadow(v / 100); shadowOut.textContent = `${v}%`; },
});

const strokeOut = tuneOut(`${theme.stroke.toFixed(2)}px`);
const strokeSliderTune = Slider({
  min: 0.6, max: 2.2, step: 0.05, value: theme.stroke, marks: ['细', '标准', '粗'],
  onInput: (v) => { theme.setStroke(v); strokeOut.textContent = `${v.toFixed(2)}px`; },
});

const modeSeg = Segmented({
  value: theme.mode,
  options: [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
    { value: 'system', label: '跟随系统' },
  ],
  onChange: (v) => theme.setMode(v),
});

const accentSwatches = Swatches({
  value: theme.accent,
  multi: false,
  onChange: (hex) => theme.setAccent(hex),
});

const appearanceSec = tuneSec('外观', '这些是全局量：它们不属于某一块玻璃，而是整套界面的底子。',
  h('div', { class: 'l-stack l-stack--7', style: { maxWidth: '620px' } },
    CardGroup({ children: [
      Row({ label: '外观', control: modeSeg }),
      Row({ label: '强调色', hint: '只换一个值，整套控件跟着走', stack: true, control: accentSwatches }),
    ] }),
    CardGroup({ title: '材质与线', children: [
      Row({
        label: '通透度',
        hint: '全局倍率：它压的是涂层，不是折射。0 = 更透，1 = 定稿',
        stack: true,
        control: h('div', { class: 'l-row l-row--3', style: { width: '100%' } },
          h('div', { class: 'l-fill' }, glassSliderTune), glassOut),
      }),
      Row({
        label: '阴影浓度',
        hint: '全局乘算：窗口、卡片、菜单、胶囊、滑块都挂在这一个系数上',
        stack: true,
        control: h('div', { class: 'l-row l-row--3', style: { width: '100%' } },
          h('div', { class: 'l-fill' }, shadowSliderTune), shadowOut),
      }),
      Row({
        label: '图标线宽',
        hint: '物理像素，不随图标尺寸缩放',
        stack: true,
        control: h('div', { class: 'l-row l-row--3', style: { width: '100%' } },
          h('div', { class: 'l-fill' }, strokeSliderTune), strokeOut),
      }),
    ] })
  )
);

/* —— B. 玻璃面：一次调一块，参数是完整的一套 —— */

let activeSurface = 'capsule';

const surfaceSeg = Segmented({
  value: activeSurface,
  options: GLASS_SURFACES.map((s) => ({ value: s.id, label: s.short || s.label })),
  onChange: (v) => {
    activeSurface = v;
    renderPreview();
    renderParams();
  },
});

const surfaceNote = h('div', { class: 'tune-note' });
const renderModeNote = h('div', { class: 'tune-mode' });

const previewHost = h('div', { class: 'tune-stage--sample tune-stage--diagnostic' });
const previewCanvas = h('div', { class: 'tune-preview' },
  h('div', { class: 'tune-preview__grid', 'aria-hidden': 'true' },
    h('span', {}, 'GRID 20px · 文字锐边 · 明暗交界')),
  previewHost);

const menuSample = () => h('div', { class: 'c-menu tune-menu' },
  h('div', { class: 'c-menu__item' }, h('span', { class: 'c-menu__check' }), h('span', { html: icon('list', 14) }), '按名称排序', h('span', { class: 'c-menu__key' }, '⌘1')),
  h('div', { class: 'c-menu__item' }, h('span', { class: 'c-menu__check' }), h('span', { html: icon('calendar-range', 14) }), '按日期排序', h('span', { class: 'c-menu__key' }, '⌘2')),
  h('div', { class: 'c-menu__sep' }),
  h('div', { class: 'c-menu__item' }, h('span', { class: 'c-menu__check' }), h('span', { html: icon('trash', 14) }), '移到回收站'));

const SAMPLES = {
  chrome: () => h('div', { class: 'c-glass-chrome tune-sample' },
    h('div', { class: 'tune-sample__name' }, '顶栏'), h('div', { class: 'tune-sample__spec' }, 'L1 · 浮在内容之上')),
  panel: () => h('div', { class: 'c-acrylic tune-sample' },
    h('div', { class: 'tune-sample__name' }, '侧栏'), h('div', { class: 'tune-sample__spec' }, 'L2 · 大面积长驻')),
  capsule: () => Capsule({ children: [
    Segmented({ value: 'a', options: [{ value: 'a', label: '全部' }, { value: 'b', label: '收藏' }] }),
    IconButton({ icon: 'more', label: '更多' }),
  ] }),
  menu: menuSample,
  toast: () => h('div', { class: 'c-toast tune-toast' },
    h('span', { html: icon('check', 14) }), '已加入收藏'),
  sheet: () => h('div', { class: 'c-glass-sheet tune-sample tune-sample--card' },
    h('div', { class: 'tune-sample__name' }, '模态'), h('div', { class: 'tune-sample__spec' }, 'L4 · 最厚的一档')),
  thumb: () => h('div', { style: { width: '240px' } }, Slider({ min: 0, max: 100, value: 46 })),
};

const nativeCapable = supportsNativeGlass();
// CSS 无法真实表达这些参数；兜底模式下明确禁用，而不是留下空操作。
const NATIVE_ONLY_PARAMS = new Set([
  'band', 'amount', 'depth', 'dispersion', 'strokeHalf', 'strokeFeather', 'falloff', 'light',
]);

let previewRaf = 0;
function renderPreview() {
  const spec = GLASS_SURFACES.find((s) => s.id === activeSurface);
  surfaceNote.textContent = spec
    ? spec.material === 'acrylic'
      ? `${spec.cls} —— ${spec.note}（只有浓度 / 模糊 / 饱和度三个旋钮）`
      : `${spec.cls} —— ${spec.note}`
    : '';
  renderModeNote.dataset.mode = nativeCapable ? 'native' : 'fallback';
  renderModeNote.textContent = nativeCapable
    ? '渲染模式：原生 SVG 背板（仅表示语法探测通过；像素结果取决于浏览器合成器）'
    : '渲染模式：CSS 兜底（原生折射/高光参数已禁用；饱和度、涂层、描边强度、模糊仍可用）';
  cancelAnimationFrame(previewRaf);
  previewRaf = 0;
  // 先释放旧预览里的 lens/observer/动画，再断开 DOM；不能只清 textContent。
  disposeComponentTree(previewHost);
  previewHost.textContent = '';
  previewHost.append(SAMPLES[activeSurface]());
  // 页面直接写的玻璃面（顶栏/侧栏/模态/菜单/提示条）要扫一遍才挂得上。
  // 首次插入前元素可能尚未连接，lens 自己会区分“未插入”和“挂载后移除”。
  mountGlassSurfaces(previewHost);
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    mountGlassSurfaces(previewHost);
  });
}

const PARAMS = GLASS_PARAM_DEFS;

const fmtParam = (d, v) => `${Number(v).toFixed(d.digits)}${d.unit || ''}`;

const paramHost = h('div', { class: 'tune-params' });
const paramSliders = new Map();

/* Acrylic 的三个旋钮：导航栏不是液态玻璃，不该出现折射 / 色散 / 涂层这些项 */
const ACRYLIC_PARAMS = [
  { k: 'tint', label: '浓度', min: 0.2, max: 1, step: 0.01, digits: 2, unit: '', hint: '染色层的不透明度' },
  { k: 'blur', label: '模糊', min: 0, max: 60, step: 1, digits: 0, unit: 'px', hint: '背景模糊半径' },
  { k: 'sat', label: '饱和度', min: 0, max: 2.5, step: 0.05, digits: 2, unit: '×', hint: '提饱和倍数，acrylic 的关键' },
];

function renderAcrylicParams() {
  const raw = theme.acrylic;
  for (const d of ACRYLIC_PARAMS) {
    const out = tuneOut(`${Number(raw[d.k]).toFixed(d.digits)}${d.unit}`);
    const sl = Slider({
      min: d.min, max: d.max, step: d.step, value: raw[d.k],
      onInput: (v) => {
        theme.setAcrylic({ [d.k]: v });
        out.textContent = `${Number(v).toFixed(d.digits)}${d.unit}`;
      },
    });
    paramSliders.set(d.k, { sl, out, d, available: true });
    paramHost.append(h('div', { class: 'tune-row', title: d.hint },
      h('div', { class: 'tune-row__label' }, d.label),
      sl,
      out));
  }
}

function renderParams() {
  // 清空参数区前先释放 slider 的 RO/RAF/lens；参数值仍在 theme 里，不会被 dispose。
  disposeComponentTree(paramHost);
  paramHost.textContent = '';
  paramSliders.clear();
  if (activeSurface === 'panel') {
    renderAcrylicParams();
    return;
  }
  const raw = theme.getOpticsRaw(activeSurface);
  for (const d of PARAMS) {
    const available = nativeCapable || !NATIVE_ONLY_PARAMS.has(d.k);
    const out = tuneOut(fmtParam(d, raw[d.k]));
    // JSON 可以合法导入超出推荐 UI 范围但仍在存储范围内的值；控件要能如实显示它。
    const rangeMin = Math.min(d.min, raw[d.k]);
    const rangeMax = Math.max(d.max, raw[d.k]);
    const sl = Slider({
      min: rangeMin, max: rangeMax, step: d.step, value: raw[d.k],
      onInput: (v) => {
        if (!available) return;
        theme.setOptics(activeSurface, { [d.k]: v });
        out.textContent = fmtParam(d, v);
      },
    });
    const row = h('div', {
      class: 'tune-row',
      dataset: { unavailable: available ? null : '1' },
      title: available ? d.hint : `${d.hint} · 当前 CSS 兜底路径无法真实消费此项`,
    },
      h('div', { class: 'tune-row__label' }, d.label),
      sl,
      out);
    if (!available) {
      const focusable = sl.input || sl;
      focusable.tabIndex = -1;
      focusable.setAttribute('aria-disabled', 'true');
      sl.style.opacity = '0.45';
      sl.style.pointerEvents = 'none';
    }
    paramSliders.set(d.k, { sl, out, d, available });
    paramHost.append(row);
  }
}

const resetBtn = Button({
  label: '恢复此面默认', size: 'sm', variant: 'plain', icon: 'rotate',
  onClick: () => {
    if (activeSurface === 'panel') theme.resetAcrylic();
    else theme.resetOptics(activeSurface);
    renderParams();
    toast('已恢复此面默认', { icon: 'check' });
  },
});

const applyAllBtn = Button({
  label: '完整复制到全部', size: 'sm', variant: 'tonal', icon: 'layers',
  onClick: () => {
    theme.applyOpticsToAll(activeSurface);
    toast('已完整复制 raw 参数（含本地 px，不按尺寸缩放）', { icon: 'check', duration: 2600 });
  },
});

const resetAllBtn = Button({
  label: '重置七面光学', size: 'sm', variant: 'plain', icon: 'rotate',
  onClick: () => {
    theme.resetOptics();
    toast('七个玻璃面已重置；外观全局量未改动', { icon: 'check', duration: 2400 });
  },
});

// hero：标题 + 玻璃面选择 + 预览，全压在渐变上
opticsContent.insertBefore(
  h('div', { class: 'tune-hero' },
    tuneHead('参数', '光学参数以 DeskCanvas 的 LiquidGlassParams 为准，七块玻璃各存一套。拖下面的滑块，这块预览立刻跟着变。'),
    h('div', { class: 'l-stack l-stack--3' },
      h('div', { class: 'tune-tabs' }, surfaceSeg),
      surfaceNote,
      renderModeNote,
      previewCanvas)),
  opticsContent.firstChild
);

opticsContent.append(tuneSec('参数', '改哪块只影响哪块；「完整复制到全部」会原样复制 raw 参数（含本地 px，不按目标尺寸缩放）。',
  h('div', { class: 'l-stack l-stack--5' },
    paramHost,
    h('div', { class: 'tune-foot' }, resetBtn, applyAllBtn, h('div', { class: 'tune-foot__spacer' }), resetAllBtn)
  )));

// 外观放在参数后面：先调材质，再调全局
opticsContent.append(appearanceSec);

/* —— C. 导出：完整 JSON 存档 + 有限的 CSS 附加导出 —— */
const jsonEl = h('textarea', {
  class: 'tune-json tune-json--readonly',
  readOnly: true,
  spellcheck: 'false',
  'aria-label': '完整主题 JSON',
});
const importEl = h('textarea', {
  class: 'tune-json',
  spellcheck: 'false',
  placeholder: '把导出的完整 JSON 粘贴到这里，再点“导入 JSON”。导入不会清空旧存档；非法配置会整体拒绝。',
  'aria-label': '导入主题 JSON',
});
const exportEl = h('pre', { class: 'tune-out' });
const refreshExport = () => {
  jsonEl.value = theme.exportJson();
  exportEl.textContent = theme.exportCss();
};

const copyText = async (text, okMessage) => {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage, { icon: 'check' });
  } catch {
    toast('浏览器不让写剪贴板；可手动选中文本复制', { icon: 'x-circle', tone: 'danger', duration: 2800 });
  }
};

const copyJsonBtn = Button({
  label: '复制 JSON', size: 'sm', variant: 'tonal', icon: 'copy',
  onClick: () => copyText(theme.exportJson(), '完整 JSON 已复制'),
});

const copyCssBtn = Button({
  label: '复制 CSS 附加导出', size: 'sm', variant: 'plain', icon: 'copy',
  onClick: () => copyText(theme.exportCss(), 'CSS 附加导出已复制'),
});

const importBtn = Button({
  label: '导入 JSON', size: 'sm', variant: 'primary', icon: 'download',
  onClick: () => {
    const text = importEl.value.trim();
    if (!text) {
      toast('先粘贴一份完整 JSON', { icon: 'info', duration: 2200 });
      return;
    }
    try {
      theme.importJson(text);
      importEl.value = '';
      // 导入可能带入超出推荐范围的值，重建一次以让轨道范围如实覆盖。
      renderParams();
      toast('配置已完整导入', { icon: 'check' });
    } catch (error) {
      toast(`导入失败：${error.message}`, { icon: 'x-circle', tone: 'danger', duration: 3600 });
    }
  },
});

opticsContent.append(tuneSec(
  '导出与导入',
  'JSON 保存七面 raw 与全局外观，可在新配置完整恢复。下面的 CSS 是 effective 值的有限兜底附加导出，不能重建原生 SVG 材质，也不是完整备份。',
  h('div', { class: 'l-stack l-stack--5' },
    h('div', { class: 'tune-export-title' }, '完整主题 JSON'),
    jsonEl,
    h('div', { class: 'l-row l-row--3' }, copyJsonBtn),
    h('div', { class: 'tune-export-title' }, '导入完整 JSON'),
    importEl,
    h('div', { class: 'l-row l-row--3' }, importBtn),
    h('div', { class: 'tune-export-title' }, 'CSS 附加导出（effective · 有限）'),
    h('div', { class: 'l-row l-row--3' }, copyCssBtn),
    exportEl)));

function syncGlobalControls(s) {
  topModeSeg?.set(s.mode);
  appearanceDemo?.set(s.mode);
  modeSeg.set(s.mode);
  accentDemo.set(s.accent);
  const glassValue = Math.round(s.glass * 100);
  const shadowValue = Math.round(s.shadow * 100);
  const strokeValue = Number(s.stroke.toFixed(2));
  if (glassSliderTune.value() !== glassValue) glassSliderTune.set(glassValue);
  if (shadowSliderTune.value() !== shadowValue) shadowSliderTune.set(shadowValue);
  if (strokeSliderTune.value() !== strokeValue) strokeSliderTune.set(strokeValue);
  if (strokeSliderDemo.value() !== strokeValue) strokeSliderDemo.set(strokeValue);
  if (shadowSliderDemo.value() !== shadowValue) shadowSliderDemo.set(shadowValue);
  glassOut.textContent = `${glassValue}%`;
  shadowOut.textContent = `${shadowValue}%`;
  strokeOut.textContent = `${strokeValue.toFixed(2)}px`;
  strokeDemoOut.textContent = `${strokeValue.toFixed(2)}px`;
  shadowDemoOut.textContent = `${shadowValue}%`;
}

function syncParamControls() {
  const raw = theme.getOpticsRaw(activeSurface);
  for (const [key, entry] of paramSliders) {
    if (entry.sl.value() !== raw[key]) entry.sl.set(raw[key]);
    entry.out.textContent = fmtParam(entry.d, raw[key]);
  }
}

theme.subscribe((s) => {
  syncGlobalControls(s);
  syncParamControls();
  refreshExport();
});
refreshExport();
renderPreview();
renderParams();
syncGlobalControls({
  mode: theme.mode,
  accent: theme.accent,
  glass: theme.glass,
  shadow: theme.shadow,
  stroke: theme.stroke,
});

// 支持 ?surface=menu 直接落在某一块（截图核对用）
const _surf = params.get('surface');
if (_surf && GLASS_SURFACES.some((s) => s.id === _surf)) {
  activeSurface = _surf;
  surfaceSeg.set(_surf);
  renderPreview();
  renderParams();
}

// 交给分页控制器。参数页是一整页，不分节
PAGES[1].sections = [];
PAGES[1].stage = opticsStage;
pageEls.get('optics').append(opticsStage);

/* ---------------- 组装 ---------------- */
pageEls.get('components').append(content);

sideEl = NavColumn({
  // 头部只留红绿灯那一行的高度；红绿灯本身在 .l-chrome 里，不跟着导航栏走
  children: navHost,
  foot: sideFoot,
  className: 'demo-side',
});

/* 悬浮导航栏：和侧边栏同一份 PAGES，只是换成圆钮 + 浮在内容上 */
dockNav = NavDock({
  edge: 'left',
  label: '页面',
  children: PAGES.map((p) =>
    NavDockItem({
      icon: p.icon,
      label: p.label,
      selected: p.id === activePage,
      onClick: () => activatePage(p.id),
    })
  ),
  foot: NavDockItem({
    icon: 'arrow-up',
    label: '回到顶部',
    onClick: () => PAGES.find((p) => p.id === activePage)?.stage?.scrollTo({ top: 0, behavior: 'smooth' }),
  }),
});

app.append(
  sideEl,
  dockNav,
  // 顶栏是窗口的一部分，不是内容列的一部分 —— 它挂在 .l-app 上，
  // 宽度永远整窗，所以收起/展开导航栏时它不需要跟着内容列重排。
  toolbar,
  h('div', { class: 'l-main demo-main' }, pagesHost, wave, TopVeil())
);

syncNav();

// 滚动时浮现滚动条（Golden Gate 覆盖层行为）
PAGES[0].stage = content;

/* —— 每页各自绑定：滚动条、末尾预留、波浪条联动 —— */
// 最后几节永远滚不到视口顶部，如果只靠「谁在顶部」判定，它们就永远选不中。
// 与其在滚到底时强行选最后一个（那样倒数第二个又选不中），
// 不如在内容末尾预留一段空间，让每一节都能滚到阈值线以上，各有一条自己的判定带。
const reserveTail = (page) => {
  const lastId = page.sections[page.sections.length - 1]?.id;
  const lastEl = lastId && document.getElementById(`sec-${lastId}`);
  if (!lastEl) return;
  page.stage.style.paddingBottom = '70px';
  const maxScroll = page.stage.scrollHeight - page.stage.clientHeight;
  // 滚到底时让最后一节的顶边停在 24px —— 它就有了自己的判定带
  const need = Math.max(0, lastEl.offsetTop - 24 - maxScroll);
  if (need > 0) page.stage.style.paddingBottom = `${70 + need}px`;
};

const bindPage = (page) => {
  revealOnScroll(page.stage);
  reserveTail(page);
  if (typeof ResizeObserver !== 'undefined') {
    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => reserveTail(page));
    }).observe(page.stage);
  }

  page.stage.addEventListener('scroll', () => {
    // 只在当前页联动；程序化滚动期间由点击结果说了算
    if (activePage !== page.id) return;
    if (performance.now() < navLockUntil) return;
    wave.setCurrent(pickIndex(page));
  }, { passive: true });

  // 用户一动手就交还控制权：滚轮、按下、键盘都算接管
  for (const t of ['wheel', 'pointerdown', 'keydown']) {
    page.stage.addEventListener(t, () => { navLockUntil = 0; }, { passive: true });
  }
};

for (const page of PAGES) bindPage(page);

// 页面直接写的玻璃面（顶栏 / 侧栏 / 模态 / 菜单）统一挂渲染层；
// 胶囊、菜单、提示条、滑块拇指由各自的工厂自己挂
mountGlassSurfaces(document);

// 起在第一页
activatePage(PAGES[0].id);

// 演示：进度条自己走
let p = 34;
setInterval(() => {
  p = (p + 7) % 100;
  prog.set(p);
}, 1400);

// 支持 ?toast=1 / ?toast=danger 直接弹一条提示，方便截图核对材质
const toastParam = params.get('toast');
if (toastParam) {
  setTimeout(() => {
    if (toastParam === 'danger') {
      toast('无法读取该文件', { icon: 'x-circle', tone: 'danger', duration: 60000 });
    } else {
      toast('已加入收藏', { icon: 'heart', duration: 60000 });
    }
  }, 400);
}

// 支持 ?y=像素 直接滚到指定位置（用于截图核对）
const _y = Number(new URLSearchParams(location.search).get('y') || 0);
if (_y) requestAnimationFrame(() => { PAGES[0].stage.scrollTop = _y; });

// 支持 ?page=optics 直接落在第二页
const _page = params.get('page');
if (_page && PAGES.some((p) => p.id === _page)) activatePage(_page);
