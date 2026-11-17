// ============================================================
// Lumina · 照片页引擎
// 「全部照片 / 收藏 / 相册」三页共享的浏览逻辑：
// 工具行（双搜索 + 排序 + 视图）、窗口化网格、选择模型、右键菜单、多选工具条。
// 页面只提供数据源与差异化的按钮。
// ============================================================

import { h, fill } from '../../core/dom.js';
import { disposeComponentTree } from '../../ui/_shared/lifecycle.js';
import { Badge } from '../../ui/content/badge.js';
import { Empty } from '../../ui/content/states.js';
import { Button, IconButton } from '../../ui/controls/button.js';
import { Segmented } from '../../ui/controls/segmented.js';
import { SearchField } from '../../ui/forms/search-field.js';
import { Select } from '../../ui/forms/select.js';
import { Capsule } from '../../ui/navigation/toolbar.js';
import { openMenu } from '../../ui/overlays/menu.js';
import { revealOnScroll } from '../../core/scrollbar.js';
import { S } from '../state.js';
import { parseQuery, hits } from '../search.js';
import { setDragKeys } from '../util.js';
import * as api from '../api.js';
import * as actions from '../actions.js';
import * as shell from '../shell.js';
import * as router from '../router.js';
import { openLightbox } from '../lightbox.js';
import { createGrid } from '../grid.js';
import { getPrefs } from '../prefs.js';
import { on, emit } from '../bus.js';

const SORT_OPTIONS = [
  { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' },
  { value: 'date-desc', label: '最新优先' },
  { value: 'date-asc', label: '最旧优先' },
];

/** 缩略图在网格里的显示宽度（请求分辨率仍用 thumbnail_size） */
export const gridThumbWidth = (settings) =>
  Math.max(96, Math.min(260, Math.round((settings.thumbnail_size ?? 400) * 0.45)));

/** 过滤 + 排序 */
export function filterAndSort(items, { q, ex, sortBy }) {
  const pq = parseQuery(q);
  const pe = parseQuery(ex);

  let out = items;
  if (pq) out = out.filter((it) => hits(pq, it.displayName || it.name));
  if (pe) out = out.filter((it) => !pe.match(it.displayName || it.name));

  const byName = (a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'zh');
  const byDate = (a, b) => (a.date || 0) - (b.date || 0);

  const sorted = [...out];
  switch (sortBy) {
    case 'name-desc':
      sorted.sort((a, b) => byName(b, a));
      break;
    case 'date-desc':
      sorted.sort((a, b) => byDate(b, a));
      break;
    case 'date-asc':
      sorted.sort(byDate);
      break;
    default:
      sorted.sort(byName);
  }
  return sorted;
}

/* ==========================================================================
   多选工具条
   ========================================================================== */

function createMultiBar(actionsList) {
  const count = h('span', null, '已选 0 张');
  const buttons = actionsList.map((a) =>
    Button({
      label: a.label,
      icon: a.icon,
      // 胶囊里的文字按钮必须是平底的，否则会变成「胶囊里套胶囊」
      variant: a.variant || 'plain',
      onClick: () => a.onClick([...S.selection]),
    })
  );

  // 分离式：计数一颗胶囊、动作一颗胶囊，各自一层液态玻璃
  const el = h(
    'div',
    { class: 'app-multibar' },
    Capsule({ text: true, children: [count] }),
    Capsule({ children: buttons })
  );
  el.style.display = 'none';

  return {
    el,
    update() {
      const n = S.selection.size;
      el.style.display = S.selectionMode ? '' : 'none';
      count.textContent = `已选 ${n} 张`;
    },
    destroy() {
      disposeComponentTree(el);
      el.remove();
    },
  };
}

/* ==========================================================================
   右键菜单
   ========================================================================== */

export function openImageMenu(img, { x, y, extra = [] } = {}) {
  const fav = S.favoriteSet.has(img.key);
  const items = [
    { label: '打开', icon: 'eye', onClick: () => openLightbox(S.viewItems || [img], (S.viewItems || [img]).indexOf(img)) },
    { sep: true },
    {
      label: fav ? '取消收藏' : '收藏',
      icon: fav ? 'star-off' : 'star',
      onClick: () => actions.toggleFavorite(img),
    },
    { label: '重命名…', icon: 'square-pen', onClick: () => actions.renameImage(img) },
  ];

  if (img.folder) {
    items.push({ label: '设为相册封面', icon: 'image', onClick: () => actions.setAlbumCover(img) });
  }

  items.push(
    { sep: true },
    { label: '移动到…', icon: 'move', onClick: () => actions.moveImages([img]) },
    { label: '在资源管理器中打开', icon: 'external-link', onClick: () => actions.revealImage(img) },
    { sep: true },
    ...extra,
    { label: '移到回收站', icon: 'trash', danger: true, onClick: () => actions.moveToTrash([img]) }
  );

  openMenu({ x, y, items });
}

/* ==========================================================================
   页面
   ========================================================================== */

/**
 * @param {object} ctx { stage, main }
 * @param {object} cfg
 * @param {string} cfg.title 页面名
 * @param {() => Array} cfg.getItems 数据源
 * @param {() => string} [cfg.subtitle]
 * @param {object} [cfg.empty] Empty 配置
 * @param {Array} [cfg.pills] 追加的顶栏胶囊
 * @param {Array} [cfg.moreItems] 「更多」菜单追加项
 * @param {Array} [cfg.multibar] 多选工具条按钮
 * @param {boolean} [cfg.showSearch=true]
 * @param {boolean} [cfg.showSort=true]
 * @param {boolean} [cfg.showView=true]
 * @param {() => void} [cfg.onMounted] 挂载完成回调（相册页插头部用）
 */
export function mountPhotoPage(ctx, cfg) {
  const {
    title,
    getItems,
    subtitle,
    empty = {},
    pills: extraPills = [],
    moreItems = [],
    multibar: multiActions,
    showSearch = true,
    showSort = true,
    showView = true,
  } = cfg;

  S.selection.clear();
  S.selectionMode = false;
  let viewItems = [];
  let anchorIndex = -1;
  let destroyed = false;

  /* ---- 顶栏 ---- */

  const segView = Segmented({
    value: S.settings.view_mode === 'list' ? 'list' : 'grid',
    options: [
      { value: 'grid', icon: 'grid-2x2', title: '网格' },
      { value: 'list', icon: 'list', title: '列表' },
    ],
    onChange: (v) => setViewMode(v),
  });

  const moreBtn = IconButton({ icon: 'more', label: '更多' });

  const topbar = shell.pageTopbar({
    title,
    subtitle: subtitle ? subtitle() : '',
    nav: router.navState(),
    pills: [
      ...(showView ? [Capsule({ children: [segView] })] : []),
      ...extraPills,
      Capsule({ round: true, children: moreBtn }),
    ],
  });
  const subEl = topbar.subEl;

  moreBtn.addEventListener('click', () => {
    openMenu({
      anchor: moreBtn,
      items: [
        { label: '全选', icon: 'square-check', key: '⌘A', onClick: () => selectAll() },
        { label: '反选', icon: 'square-dashed', onClick: () => invertSelection() },
        { label: '取消选择', icon: 'x', onClick: () => clearSelection() },
        { sep: true },
        { label: '重新扫描图库', icon: 'refresh-cw', onClick: () => actions.rescan() },
        { label: '新建相册…', icon: 'folder-plus', onClick: () => actions.createAlbum('') },
        { label: '生成缩略图缓存', icon: 'layers', onClick: () => router.go({ page: 'settings' }) },
        { label: '打开图库位置', icon: 'folder-open', onClick: () => actions.openInExplorer(S.profileFolder) },
        ...moreItems,
      ],
    });
  });

  /* ---- 工具行 ---- */

  const qField = SearchField({
    placeholder: '搜索文件名',
    value: S.query.q,
    width: 200,
    onInput: (v) => {
      S.query.q = v;
      scheduleRender();
      updateIndicator();
    },
  });

  const exField = SearchField({
    placeholder: '排除关键词',
    value: S.query.ex,
    width: 160,
    onInput: (v) => {
      S.query.ex = v;
      scheduleRender();
      updateIndicator();
    },
  });

  const sortSelect = Select({
    options: SORT_OPTIONS,
    value: S.settings.sort_by || 'name-asc',
    width: '128px',
    label: '排序方式',
    onChange: (v) => {
      S.settings.sort_by = v;
      api.settings.save(S.profileId, { sort_by: v }).catch(() => {});
      render();
    },
  });

  const countBadge = Badge({ label: '0 张' });
  const indicator = h('div', { class: 'c-subtitle' });
  indicator.style.display = 'none';

  for (const f of [qField, exField]) {
    f.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      f.set('');
      if (f === qField) S.query.q = '';
      else S.query.ex = '';
      updateIndicator();
      render();
    });
  }

  const searchWrap = h(
    'div',
    { class: 'app-tools' },
    showSearch ? qField : null,
    showSearch && S.settings.reverse_search_enabled ? exField : null,
    h('div', { class: 'app-tools__seps' }),
    countBadge,
    showSort ? sortSelect : null
  );

  const page = h(
    'div',
    { class: 'app-page app-page--flush' },
    showSearch || showSort ? searchWrap : null,
    indicator
  );
  ctx.stage.append(page);
  const detachScroll = revealOnScroll(ctx.stage);

  /* ---- 网格 ---- */

  const grid = createGrid({
    scroller: ctx.stage,
    items: [],
    viewMode: S.settings.view_mode === 'list' ? 'list' : 'grid',
    thumbSize: S.settings.thumbnail_size ?? 400,
    thumbW: gridThumbWidth(S.settings),
    listColumns: S.settings.list_columns ?? 3,
    columns: getPrefs().gridColumns,
    gap: getPrefs().gridGap,
    selection: S.selection,
    multi: S.selectionMode,
    onClick: (i, e) => onItemClick(i, e),
    onOpen: (i) => openLightbox(viewItems, i),
    onLongPress: (i) => enterSelection(i),
    // 拖到侧栏相册 / 相册卡上就是「移动到这里」
    onDragStart: (i, e) => {
      const img = viewItems[i];
      if (!img) return;
      const keys = S.selection.has(img.key) && S.selection.size ? [...S.selection] : [img.key];
      setDragKeys(e, keys);
    },
    onMenu: (i, e) => {
      const img = viewItems[i];
      if (!img) return;
      if (!S.selection.has(img.key)) {
        S.selectionMode = true;
        S.selection.clear();
        S.selection.add(img.key);
        anchorIndex = i;
        syncSelection();
      }
      openImageMenu(img, { x: e.clientX, y: e.clientY });
    },
  });
  page.append(grid.el);

  /* ---- 空状态 ---- */

  const emptyEl = h('div', { class: 'app-empty' });
  emptyEl.style.display = 'none';
  page.append(emptyEl);

  function renderEmpty(filtered) {
    const hasQuery = !!(S.query.q || S.query.ex);
    if (filtered.length) {
      emptyEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = '';
    fill(emptyEl);
    if (hasQuery) {
      emptyEl.append(
        Empty({
          icon: 'folder-search',
          title: '没有匹配的照片',
          desc: `当前筛选：${[S.query.q && `包含「${S.query.q}」`, S.query.ex && `排除「${S.query.ex}」`]
            .filter(Boolean)
            .join('，')}`,
          action: Button({
            label: '清除筛选',
            variant: 'primary',
            onClick: () => {
              S.query.q = '';
              S.query.ex = '';
              qField.set('');
              exField.set('');
              updateIndicator();
              render();
            },
          }),
        })
      );
      return;
    }
    emptyEl.append(
      Empty({
        icon: empty.icon || 'images',
        title: empty.title || '还没有照片',
        desc: empty.desc || '把图片放进图库文件夹，然后重新扫描。',
        action: empty.action
          ? empty.action()
          : Button({
              label: empty.actionLabel || '重新扫描',
              variant: 'primary',
              icon: 'refresh-cw',
              onClick: () => actions.rescan(),
            }),
      })
    );
  }

  /* ---- 选择 ---- */

  function syncSelection() {
    grid.setSelection(S.selection, S.selectionMode);
    multiBar.update();
  }

  /** 退出选择模式（清空选中） */
  function clearSelection() {
    S.selectionMode = false;
    S.selection.clear();
    syncSelection();
  }

  /** 长按：进入选择模式并选中当前这张 */
  function enterSelection(index) {
    const img = viewItems[index];
    if (!img) return;
    S.selectionMode = true;
    if (!S.selection.has(img.key)) S.selection.add(img.key);
    anchorIndex = index;
    syncSelection();
  }

  function selectAll() {
    S.selectionMode = true;
    S.selection.clear();
    for (const it of viewItems) S.selection.add(it.key);
    syncSelection();
  }

  function invertSelection() {
    S.selectionMode = true;
    const next = new Set();
    for (const it of viewItems) if (!S.selection.has(it.key)) next.add(it.key);
    S.selection = next;
    syncSelection();
  }

  function onItemClick(index, e) {
    const img = viewItems[index];
    if (!img) return;

    // Ctrl / Cmd / Shift 是键盘用户的选择手势，不必长按
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      S.selectionMode = true;
      if (e.shiftKey && anchorIndex >= 0) {
        const [a, b] = [Math.min(anchorIndex, index), Math.max(anchorIndex, index)];
        if (!(e.metaKey || e.ctrlKey)) S.selection.clear();
        for (let i = a; i <= b; i += 1) S.selection.add(viewItems[i].key);
      } else if (S.selection.has(img.key)) {
        S.selection.delete(img.key);
      } else {
        S.selection.add(img.key);
      }
      anchorIndex = index;
      syncSelection();
      return;
    }

    // 选择模式：单击 = 选中 / 取消
    if (S.selectionMode) {
      if (S.selection.has(img.key)) S.selection.delete(img.key);
      else S.selection.add(img.key);
      anchorIndex = index;
      syncSelection();
      return;
    }

    // 普通模式：单击直接打开（双击同样走这里）
    openLightbox(viewItems, index);
  }

  /* ---- 多选工具条 ---- */

  const multiBar = createMultiBar(
    multiActions || [
      {
        label: '收藏',
        icon: 'star',
        onClick: (keys) => actions.setFavoriteMany(pick(keys), true),
      },
      {
        label: '移动',
        icon: 'move',
        onClick: (keys) => actions.moveImages(pick(keys)),
      },
      {
        label: '删除',
        icon: 'trash',
        variant: 'danger',
        onClick: (keys) => actions.moveToTrash(pick(keys)),
      },
      { label: '取消', icon: 'x', onClick: () => clearSelection() },
    ]
  );
  document.body.append(multiBar.el);

  function pick(keys) {
    const set = new Set(keys);
    return viewItems.filter((it) => set.has(it.key));
  }

  /* ---- 渲染 ---- */

  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  }

  function updateIndicator() {
    const parts = [];
    if (S.query.q) {
      const p = parseQuery(S.query.q);
      if (p) parts.push(p.describe());
    }
    if (S.query.ex) {
      const p = parseQuery(S.query.ex);
      if (p) parts.push(`[排除] ${p.describe()}`);
    }
    indicator.textContent = parts.join('   ');
    indicator.style.display = parts.length ? '' : 'none';
  }

  function setViewMode(v) {
    S.settings.view_mode = v;
    segView.set(v);
    api.settings.save(S.profileId, { view_mode: v }).catch(() => {});
    grid.update({ viewMode: v });
    // 相册页的子相册要跟着在「卡片 / 行」之间切换
    emit('viewmode', v);
  }

  function render() {
    if (destroyed) return;
    const source = getItems();
    viewItems = filterAndSort(source, {
      q: S.query.q,
      ex: S.query.ex,
      sortBy: S.settings.sort_by,
    });

    // 选择集里已不存在的键清掉（删除/移动/切页之后）
    const alive = new Set(viewItems.map((it) => it.key));
    for (const k of [...S.selection]) if (!alive.has(k)) S.selection.delete(k);

    const prefs = getPrefs();
    grid.update({
      items: viewItems,
      thumbSize: S.settings.thumbnail_size ?? 400,
      thumbW: gridThumbWidth(S.settings),
      listColumns: S.settings.list_columns ?? 3,
      columns: prefs.gridColumns,
      gap: prefs.gridGap,
    });
    grid.setSelection(S.selection);
    S.viewItems = viewItems;

    countBadge.replaceChildren(document.createTextNode(`${viewItems.length.toLocaleString('zh-CN')} 张`));
    if (subEl && subtitle) subEl.textContent = subtitle();
    renderEmpty(viewItems);
    multiBar.update();
  }

  // 点空白处退出选择模式
  page.addEventListener('click', (e) => {
    if (!S.selectionMode) return;
    if (e.target.closest('.c-thumb, .c-row')) return;
    clearSelection();
  });

  /* ---- 键盘 ---- */

  const onKey = (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) invertSelection();
      else selectAll();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      qField.input?.focus();
      qField.input?.select();
      return;
    }
    if (typing) return;

    if (e.key === ' ' && !S.selection.size) {
      e.preventDefault();
      qField.input?.focus();
      qField.input?.select();
      return;
    }

    if (e.key === 'Escape' && (S.selectionMode || S.selection.size)) {
      e.preventDefault();
      clearSelection();
    } else if (e.key === 'Enter' && S.selection.size) {
      e.preventDefault();
      const idx = viewItems.findIndex((it) => S.selection.has(it.key));
      if (idx >= 0) openLightbox(viewItems, idx);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selection.size) {
      e.preventDefault();
      actions.moveToTrash(pick([...S.selection]));
    }
  };
  document.addEventListener('keydown', onKey);

  /* ---- 数据变化 ---- */

  const offs = [
    on('images', () => render()),
    on('favorites', () => render()),
    // 设置页改了「每行图片数 / 间距」：不用重挂页面，直接重排
    on('ui', () => render()),
    on('reload', () => render()),
  ];

  render();
  updateIndicator();
  if (subEl && subtitle) subEl.textContent = subtitle();

  return {
    render,
    setViewMode,
    clearSelection,
    /** 页面容器：相册页要在工具行上面插头部 */
    page,
    destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', onKey);
      offs.forEach((off) => off());
      detachScroll();
      multiBar.destroy();
      grid.destroy();
    },
  };
}

